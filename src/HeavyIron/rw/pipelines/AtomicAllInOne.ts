import { DeviceProgram } from "../../../Program.js";
import { makeStaticDataBuffer } from "../../../gfx/helpers/BufferHelpers.js";
import { filterDegenerateTriangleIndexBuffer, convertToTriangleIndexBuffer, GfxTopology } from "../../../gfx/helpers/TopologyHelpers.js";
import { fillColor, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from "../../../gfx/helpers/UniformBufferHelpers.js";
import { GfxIndexBufferDescriptor, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBlendFactor, GfxMegaStateDescriptor, GfxCompareMode } from "../../../gfx/platform/GfxPlatform.js";
import { GfxFormat } from "../../../gfx/platform/GfxPlatformFormat.js";
import { GfxBuffer, GfxProgram, GfxInputLayout } from "../../../gfx/platform/GfxPlatformImpl.js";
import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { OpaqueBlack, White, colorCopy, colorNewCopy } from "../../../Color.js";
import { vec3, vec4 } from "gl-matrix";
import { RwEngine } from "../rwcore.js";
import { RpMaterial, RpAtomic, RpGeometryFlag, RpLightType, RpAtomicPipeline } from "../rpworld.js";

const MAX_DIRECTIONAL_LIGHTS = 8;

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 }
];

// TODO: support flat shading
// TODO: support all alpha test functions (only GREATER supported atm)
class AtomicProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public static ub_AtomicParams = 0;
    public static ub_MeshParams = 1;

    public static readonly ub_AtomicParams_SIZE = 16*3 + 4*2*MAX_DIRECTIONAL_LIGHTS + 4*2;
    public static readonly ub_MeshParams_SIZE = 4*2;

    public override both = `
precision mediump float;

#define MAX_DIRECTIONAL_LIGHTS ${MAX_DIRECTIONAL_LIGHTS}

struct DirectionalLight {
    vec4 Color;
    vec4 Direction;
};

layout(std140) uniform ub_AtomicParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
    Mat4x4 u_ModelMatrix;
    DirectionalLight u_DirectionalLights[MAX_DIRECTIONAL_LIGHTS];
    vec4 u_FogColor;
    vec4 u_Misc;
};

layout(std140) uniform ub_MeshParams {
    vec4 u_MaterialColor;
    vec4 u_AmbientColor;
};

#define u_NearPlane (u_Misc.x)
#define u_FarPlane (u_Misc.y)
#define u_FogPlane (u_Misc.z)
#define u_AlphaRef (u_Misc.w)

uniform sampler2D u_Texture;

varying vec3 v_Position;
varying vec4 v_Color;
varying vec2 v_TexCoord;
varying float v_Depth;
`;

    public override vert = `
layout(location = ${AtomicProgram.a_Position}) in vec3 a_Position;
layout(location = ${AtomicProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${AtomicProgram.a_Color}) in vec4 a_Color;
layout(location = ${AtomicProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(u_ViewMatrix, Mul(u_ModelMatrix, vec4(a_Position, 1.0))));

    v_Position = a_Position;
    v_Color = a_Color * u_MaterialColor;

    vec3 t_Normal = normalize(Mul(u_ModelMatrix, vec4(a_Normal, 0.0)).xyz);

    // Ambient lighting
    v_Color.rgb *= u_AmbientColor.rgb * u_AmbientColor.a;
    
    // Directional lighting
    vec3 t_LightColor = vec3(0.0);
    for (int i = 0; i < MAX_DIRECTIONAL_LIGHTS; i++) {
        DirectionalLight light = u_DirectionalLights[i];
        t_LightColor += max(dot(t_Normal, light.Direction.xyz), 0.0) * light.Color.rgb * light.Color.a;
    }
    t_LightColor = min(t_LightColor, vec3(1.0));

    v_Color.rgb += t_LightColor;

    v_TexCoord = a_TexCoord;
    v_Depth = gl_Position.w;
}
`;

    public override frag = `
${GfxShaderLibrary.invlerp}
${GfxShaderLibrary.saturate}

void main() {
    vec4 t_Color = v_Color;

#ifdef USE_TEXTURE
    // Texture
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

    // Alpha Test
    if (!(t_Color.a > u_AlphaRef)) discard;

    // Fog
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, saturate(invlerp(u_FogPlane, u_FarPlane, v_Depth) * u_FogColor.a));

    gl_FragColor = t_Color;
}
`;
}

interface MeshData {
    indexBuffer: GfxBuffer;
    indexBufferDescriptor: GfxIndexBufferDescriptor;
    indexCount: number;
    gfxProgram: GfxProgram;
    material: RpMaterial;
}

const scratchVec3 = vec3.create();
const scratchVec4 = vec4.create();
const scratchColor = colorNewCopy(White);

class InstanceData {
    public vertexBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public inputLayout: GfxInputLayout;
    public meshes: MeshData[] = [];

    constructor(atomic: RpAtomic, rw: RwEngine) {
        const geom = atomic.geometry;
        const mt = geom.morphTargets[0];

        const attrCount = 3 + 3 + 4 + 2; // Position + Normal + Color + TexCoord
        const vertexData = new Float32Array(attrCount * geom.numVertices);

        let offs = 0, voff = 0, noff = 0, coff = 0, toff = 0;
        for (let i = 0; i < geom.numVertices; i++) {
            vertexData[offs++] = mt.verts![voff++];
            vertexData[offs++] = mt.verts![voff++];
            vertexData[offs++] = mt.verts![voff++];
            if (geom.flags & RpGeometryFlag.NORMALS) {
                vertexData[offs++] = mt.normals![noff++];
                vertexData[offs++] = mt.normals![noff++];
                vertexData[offs++] = mt.normals![noff++];
            } else {
                vertexData[offs++] = 0.0;
                vertexData[offs++] = 0.0;
                vertexData[offs++] = 0.0;
            }
            if (geom.flags & RpGeometryFlag.PRELIT) {
                vertexData[offs++] = geom.preLitLum[coff++];
                vertexData[offs++] = geom.preLitLum[coff++];
                vertexData[offs++] = geom.preLitLum[coff++];
                vertexData[offs++] = geom.preLitLum[coff++];
            } else {
                vertexData[offs++] = 1.0;
                vertexData[offs++] = 1.0;
                vertexData[offs++] = 1.0;
                vertexData[offs++] = 1.0;
            }
            if (geom.flags & RpGeometryFlag.TEXTURED) {
                vertexData[offs++] = geom.texCoords[toff++];
                vertexData[offs++] = geom.texCoords[toff++];
            } else {
                vertexData[offs++] = 0.0;
                vertexData[offs++] = 0.0;
            }
        }

        this.vertexBuffer = makeStaticDataBuffer(rw.renderHelper.device, GfxBufferUsage.Vertex, vertexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: AtomicProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04 },
            { location: AtomicProgram.a_Normal,   bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 3*0x04 },
            { location: AtomicProgram.a_Color,    bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04 },
            { location: AtomicProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 10*0x04 },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: attrCount*0x04, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = rw.renderHelper.renderCache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const program = new AtomicProgram();

        for (const mesh of geom.mesh.meshes) {
            const indexData = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(GfxTopology.TriStrips, mesh.indices));
            const indexBuffer = makeStaticDataBuffer(rw.renderHelper.device, GfxBufferUsage.Index, indexData.buffer);
            const indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0 };
            const indexCount = indexData.length;
            const material = geom.materials[mesh.matIndex];

            program.setDefineBool('USE_TEXTURE', material.texture !== undefined);

            const gfxProgram = rw.renderHelper.renderCache.createProgram(program);

            this.meshes.push({ indexBuffer, indexBufferDescriptor, indexCount, gfxProgram, material });
        }
    }

    public destroy(atomic: RpAtomic, rw: RwEngine) {
        for (const mesh of this.meshes) {
            rw.renderHelper.device.destroyBuffer(mesh.indexBuffer);
        }
        rw.renderHelper.device.destroyBuffer(this.vertexBuffer);
    }

    public render(atomic: RpAtomic, rw: RwEngine) {
        if (rw.camera.nearPlane !== rw.viewerInput.camera.near &&
            rw.camera.farPlane !== rw.viewerInput.camera.far) {
            rw.viewerInput.camera.setClipPlanes(rw.camera.nearPlane, rw.camera.farPlane);
        }

        const template = rw.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(rw.renderState.megaStateFlags);

        let offs = template.allocateUniformBuffer(AtomicProgram.ub_AtomicParams, AtomicProgram.ub_AtomicParams_SIZE);
        const mapped = template.mapUniformBufferF32(AtomicProgram.ub_AtomicParams);
        offs += fillMatrix4x4(mapped, offs, rw.viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(mapped, offs, rw.camera.viewMatrix);
        offs += fillMatrix4x4(mapped, offs, atomic.frame.matrix);

        let ambientColor = scratchColor;
        let directionalLightCount = 0;
        if (rw.world.lights.size > 0 && (atomic.geometry.flags & RpGeometryFlag.LIGHT)) {
            colorCopy(ambientColor, OpaqueBlack);
            for (const light of rw.world.lights) {
                if (light.type === RpLightType.AMBIENT) {
                    ambientColor.r += light.color.r * light.color.a;
                    ambientColor.g += light.color.g * light.color.a;
                    ambientColor.b += light.color.b * light.color.a;
                } else if (light.type === RpLightType.DIRECTIONAL) {
                    if (directionalLightCount < MAX_DIRECTIONAL_LIGHTS) {
                        offs += fillColor(mapped, offs, light.color);

                        const mat = light.frame.matrix;
                        const dir = scratchVec3;
                        vec3.set(dir, mat[8], mat[9], mat[10]);
                        vec3.normalize(dir, dir);
                        offs += fillVec3v(mapped, offs, dir);

                        directionalLightCount++;
                    }
                }
            }
        } else {
            colorCopy(ambientColor, White);
        }

        for (let i = directionalLightCount; i < MAX_DIRECTIONAL_LIGHTS; i++) {
            offs += fillVec4(mapped, offs, 0);
            offs += fillVec4(mapped, offs, 0);
        }

        if (rw.renderState.fogEnable) {
            const color = rw.renderState.fogColor;
            vec4.set(scratchVec4, color.r, color.g, color.b, color.a);
            offs += fillVec4v(mapped, offs, scratchVec4);
        } else {
            offs += fillVec4(mapped, offs, 0);
        }

        offs += fillVec4(mapped, offs, rw.camera.nearPlane,
                                       rw.camera.farPlane,
                                       rw.camera.fogPlane,
                                       rw.renderState.alphaTestFunctionRef);

        for (const mesh of this.meshes) {
            const renderInst = rw.renderHelper.renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(AtomicProgram.ub_MeshParams, AtomicProgram.ub_MeshParams_SIZE);
            const mapped = renderInst.mapUniformBufferF32(AtomicProgram.ub_MeshParams);

            offs += fillColor(mapped, offs, mesh.material.color);

            if (atomic.geometry.flags & RpGeometryFlag.LIGHT) {
                ambientColor.a = mesh.material.ambient;
            }
            offs += fillColor(mapped, offs, ambientColor);

            renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, mesh.indexBufferDescriptor);
            renderInst.setDrawCount(mesh.indexCount);
            renderInst.setGfxProgram(mesh.gfxProgram);

            mesh.material.texture?.raster.bind(renderInst);

            rw.renderInstList.submitRenderInst(renderInst);
        }

        rw.renderHelper.renderInstManager.popTemplateRenderInst();
    }
}

export class AtomicAllInOnePipeline implements RpAtomicPipeline {
    private instanceData?: InstanceData;

    public instance(atomic: RpAtomic, rw: RwEngine) {
        if (!this.instanceData) {
            this.instanceData = new InstanceData(atomic, rw);
        }
        this.instanceData.render(atomic, rw);
    }

    public destroy(atomic: RpAtomic, rw: RwEngine) {
        this.instanceData?.destroy(atomic, rw);
    }
}