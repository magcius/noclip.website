import { DeviceProgram } from "../../../Program.js";
import { makeStaticDataBuffer } from "../../../gfx/helpers/BufferHelpers.js";
import { filterDegenerateTriangleIndexBuffer, convertToTriangleIndexBuffer, GfxTopology } from "../../../gfx/helpers/TopologyHelpers.js";
import { fillColor, fillMatrix4x4, fillVec4, fillVec4v } from "../../../gfx/helpers/UniformBufferHelpers.js";
import { GfxIndexBufferDescriptor, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBlendFactor, GfxMegaStateDescriptor, GfxCompareMode } from "../../../gfx/platform/GfxPlatform.js";
import { GfxFormat } from "../../../gfx/platform/GfxPlatformFormat.js";
import { GfxBuffer, GfxProgram, GfxInputLayout } from "../../../gfx/platform/GfxPlatformImpl.js";
import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { OpaqueBlack, TransparentBlack, White, colorCopy, colorFromRGBA, colorNewCopy } from "../../../Color.js";
import { mat4, vec4 } from "gl-matrix";
import { RwEngine } from "../rwcore.js";
import { RpMaterial, RpAtomic, RpGeometryFlag, RpLightType, RpAtomicPipeline, RpGeometry } from "../rpworld.js";

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

    public static readonly ub_AtomicParams_SIZE = 16*2 + 4*MAX_DIRECTIONAL_LIGHTS*2 + 4*2 + 4;
    public static readonly ub_MeshParams_SIZE = 4 + 4;

    public override both = `
precision mediump float;

#define MAX_DIRECTIONAL_LIGHTS ${MAX_DIRECTIONAL_LIGHTS}

struct DirectionalLight {
    vec4 direction; // in eye space
    vec4 color;
};

layout(std140) uniform ub_AtomicParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
    DirectionalLight u_DirectionalLights[MAX_DIRECTIONAL_LIGHTS];
    vec4 u_AmbientColor;
    vec4 u_FogColor;
    float u_FarPlane;
    float u_FogPlane;
    float u_AlphaRef;
    float u_EnablePrelit;
};

#define u_EnableLight (u_AmbientColor.a)

layout(std140) uniform ub_MeshParams {
    vec4 u_MaterialColor;
    float u_AmbientMult;
    float u_DiffuseMult;
    float u_EnableTexture;
    float u_MeshUnused;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
varying float v_FogAmount;
`;

    public override vert = `
${GfxShaderLibrary.invlerp}
${GfxShaderLibrary.saturate}

layout(location = ${AtomicProgram.a_Position}) in vec3 a_Position;
layout(location = ${AtomicProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${AtomicProgram.a_Color}) in vec4 a_Color;
layout(location = ${AtomicProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position, 1.0)));

    // Normal (in eye space)
    vec3 t_Normal = normalize(Mul(u_ModelView, vec4(a_Normal, 0.0)).xyz);

    vec4 t_Color = u_EnablePrelit != 0.0 ? a_Color : (u_EnableLight != 0.0 ? vec4(0, 0, 0, 1) : vec4(1.0));

    if (u_EnableLight != 0.0) {
        // Ambient lighting
        t_Color.rgb += u_AmbientColor.rgb * u_AmbientMult;

        // Directional lighting
        vec3 t_LightColor = vec3(0.0);
        for (int i = 0; i < MAX_DIRECTIONAL_LIGHTS; i++) {
            DirectionalLight light = u_DirectionalLights[i];
            t_LightColor += max(dot(t_Normal, light.direction.xyz), 0.0) * light.color.rgb;
        }
        t_LightColor = min(t_LightColor, vec3(1.0));
        t_Color.rgb += t_LightColor * u_DiffuseMult;
    }

    t_Color *= u_MaterialColor;

    v_Color = t_Color;
    v_TexCoord = a_TexCoord;

    v_FogAmount = saturate(invlerp(u_FogPlane, u_FarPlane, gl_Position.w) * u_FogColor.a);
}
`;

    public override frag = `
void main() {
    vec4 t_Color = v_Color;

    // Texture
    if (u_EnableTexture != 0.0)
        t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);

    // Alpha Test
    if (!(t_Color.a > u_AlphaRef)) discard;

    // Fog
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, v_FogAmount);

    gl_FragColor = t_Color;
}
`;
}

interface MeshData {
    indexBuffer: GfxBuffer;
    indexBufferDescriptor: GfxIndexBufferDescriptor;
    indexCount: number;
    material: RpMaterial;
}

const scratchVec4 = vec4.create();
const scratchMat4 = mat4.create();
const scratchColor = colorNewCopy(OpaqueBlack);
const scratchColor2 = colorNewCopy(OpaqueBlack);

class InstanceData {
    public vertexBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public inputLayout: GfxInputLayout;
    public meshes: MeshData[] = [];
    
    constructor(geom: RpGeometry, public gfxProgram: GfxProgram, rw: RwEngine) {
        const mt = geom.morphTargets[0];

        const attrCount = 3 + 3 + 4 + 2; // Position + Normal + Color + TexCoord
        const vertexData = new Float32Array(attrCount * geom.numVertices);

        let offs = 0, voff = 0, noff = 0, coff = 0, toff = 0;
        for (let i = 0; i < geom.numVertices; i++) {
            vertexData[offs++] = mt.verts![voff++];
            vertexData[offs++] = mt.verts![voff++];
            vertexData[offs++] = mt.verts![voff++];
            if (mt.normals) {
                vertexData[offs++] = mt.normals[noff++];
                vertexData[offs++] = mt.normals[noff++];
                vertexData[offs++] = mt.normals[noff++];
            } else {
                vertexData[offs++] = 0.0;
                vertexData[offs++] = 0.0;
                vertexData[offs++] = 0.0;
            }
            if (geom.preLitLum) {
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
            if (geom.texCoords) {
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

        for (const mesh of geom.mesh.meshes) {
            const indexData = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(GfxTopology.TriStrips, mesh.indices));
            const indexBuffer = makeStaticDataBuffer(rw.renderHelper.device, GfxBufferUsage.Index, indexData.buffer);
            const indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0 };
            const indexCount = indexData.length;
            const material = geom.materials[mesh.matIndex];

            this.meshes.push({ indexBuffer, indexBufferDescriptor, indexCount, material });
        }
    }

    public destroy(atomic: RpAtomic, rw: RwEngine) {
        for (const mesh of this.meshes) {
            rw.renderHelper.device.destroyBuffer(mesh.indexBuffer);
        }
        rw.renderHelper.device.destroyBuffer(this.vertexBuffer);
    }

    public render(atomic: RpAtomic, rw: RwEngine) {
        const geom = atomic.geometry;

        if (rw.camera.nearPlane !== rw.viewerInput.camera.near &&
            rw.camera.farPlane !== rw.viewerInput.camera.far) {
            rw.viewerInput.camera.setClipPlanes(rw.camera.nearPlane, rw.camera.farPlane);
        }

        const template = rw.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(rw.renderState.megaStateFlags);

        let offs = template.allocateUniformBuffer(AtomicProgram.ub_AtomicParams, AtomicProgram.ub_AtomicParams_SIZE);
        const mapped = template.mapUniformBufferF32(AtomicProgram.ub_AtomicParams);

        const projection = rw.viewerInput.camera.projectionMatrix;
        offs += fillMatrix4x4(mapped, offs, projection);

        const modelView = scratchMat4;
        mat4.mul(modelView, rw.camera.viewMatrix, atomic.frame.matrix);
        offs += fillMatrix4x4(mapped, offs, modelView);

        const directionalColor = scratchColor;
        const ambientColor = scratchColor2;

        colorCopy(directionalColor, OpaqueBlack);
        colorFromRGBA(ambientColor, 0, 0, 0, (geom.flags & RpGeometryFlag.LIGHT) ? 1.0 : 0.0);

        let lightCount = 0;
        if (atomic.geometry.flags & RpGeometryFlag.LIGHT) {
            for (const light of rw.world.lights) {
                if (light.type === RpLightType.DIRECTIONAL) {
                    if (lightCount < MAX_DIRECTIONAL_LIGHTS) {
                        const mat = scratchMat4;
                        mat4.mul(mat, rw.camera.viewMatrix, light.frame.matrix);

                        const dir = scratchVec4;
                        vec4.set(dir, mat[8], mat[9], mat[10], 0);
                        vec4.normalize(dir, dir);

                        offs += fillVec4v(mapped, offs, dir);

                        directionalColor.r = light.color.r * light.color.a;
                        directionalColor.g = light.color.g * light.color.a;
                        directionalColor.b = light.color.b * light.color.a;

                        offs += fillColor(mapped, offs, directionalColor);

                        lightCount++;
                    }
                } else if (light.type === RpLightType.AMBIENT) {
                    ambientColor.r += light.color.r * light.color.a;
                    ambientColor.g += light.color.g * light.color.a;
                    ambientColor.b += light.color.b * light.color.a;
                }
            }
        }
        for (let i = lightCount; i < MAX_DIRECTIONAL_LIGHTS; i++) {
            offs += fillVec4(mapped, offs, 0);
            offs += fillVec4(mapped, offs, 0);
        }

        offs += fillColor(mapped, offs, ambientColor);

        const fogColor = rw.renderState.fogEnable ? rw.renderState.fogColor : TransparentBlack;
        offs += fillColor(mapped, offs, fogColor);

        const farPlane = rw.camera.farPlane;
        const fogPlane = rw.camera.fogPlane;
        const alphaRef = rw.renderState.alphaTestFunctionRef;
        const enablePrelit = (atomic.geometry.flags & RpGeometryFlag.PRELIT) ? 1.0 : 0.0;
        offs += fillVec4(mapped, offs, farPlane, fogPlane, alphaRef, enablePrelit);

        for (const mesh of this.meshes) {
            const renderInst = rw.renderHelper.renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(AtomicProgram.ub_MeshParams, AtomicProgram.ub_MeshParams_SIZE);
            const mapped = renderInst.mapUniformBufferF32(AtomicProgram.ub_MeshParams);

            const materialColor = (geom.flags & RpGeometryFlag.MODULATEMATERIALCOLOR) ? mesh.material.color : White;
            offs += fillColor(mapped, offs, materialColor);

            const ambientMult = mesh.material.ambient;
            const diffuseMult = mesh.material.diffuse;
            const enableTexture = mesh.material.texture ? 1.0 : 0.0;

            offs += fillVec4(mapped, offs, ambientMult, diffuseMult, enableTexture);

            if (mesh.material.texture) {
                mesh.material.texture.raster.bind(renderInst, mesh.material.texture.getGfxSampler(rw));
            }

            renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, mesh.indexBufferDescriptor);
            renderInst.setDrawCount(mesh.indexCount);
            renderInst.setGfxProgram(this.gfxProgram);

            rw.renderInstList.submitRenderInst(renderInst);
        }

        rw.renderHelper.renderInstManager.popTemplateRenderInst();
    }
}

export class AtomicAllInOnePipeline implements RpAtomicPipeline {
    private gfxProgram?: GfxProgram;

    public instance(atomic: RpAtomic, rw: RwEngine) {
        if (!this.gfxProgram) {
            this.gfxProgram = rw.renderHelper.renderCache.createProgram(new AtomicProgram());
        }
        
        if (!atomic.geometry.instanceData) {
            atomic.geometry.instanceData = new InstanceData(atomic.geometry, this.gfxProgram, rw);
        }

        (atomic.geometry.instanceData as InstanceData).render(atomic, rw);
    }

    public destroy(atomic: RpAtomic, rw: RwEngine) {
        (atomic.geometry.instanceData as InstanceData)?.destroy(atomic, rw);
        atomic.geometry.instanceData = undefined;
    }
}