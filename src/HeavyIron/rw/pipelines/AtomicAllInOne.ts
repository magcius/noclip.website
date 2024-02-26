import { DeviceProgram } from "../../../Program.js";
import { makeStaticDataBuffer } from "../../../gfx/helpers/BufferHelpers.js";
import { filterDegenerateTriangleIndexBuffer, convertToTriangleIndexBuffer, GfxTopology } from "../../../gfx/helpers/TopologyHelpers.js";
import { fillColor, fillMatrix4x4, fillVec3v, fillVec4 } from "../../../gfx/helpers/UniformBufferHelpers.js";
import { GfxIndexBufferDescriptor, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxMegaStateDescriptor, GfxCompareMode, GfxBlendFactor, GfxCullMode } from "../../../gfx/platform/GfxPlatform.js";
import { GfxFormat } from "../../../gfx/platform/GfxPlatformFormat.js";
import { GfxBuffer, GfxProgram, GfxInputLayout } from "../../../gfx/platform/GfxPlatformImpl.js";
import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { OpaqueBlack, TransparentBlack, White, colorCopy, colorNewCopy } from "../../../Color.js";
import { mat4, vec3 } from "gl-matrix";
import { RwBlendFunction, RwCullMode, RwEngine } from "../rwcore.js";
import { RpMaterial, RpAtomic, RpGeometryFlag, RpLightType, RpAtomicPipeline, RpGeometry, RpLight, RpLightFlag } from "../rpworld.js";
import { nArray } from "../../../util.js";
import { getMatrixAxisZ } from "../../../MathHelpers.js";
import { makeMegaState } from "../../../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForCompareMode } from "../../../gfx/helpers/ReversedDepthHelpers.js";

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

    public static readonly ub_AtomicParams_SIZE = 16*3 + 4*MAX_DIRECTIONAL_LIGHTS*2 + 4*3;
    public static readonly ub_MeshParams_SIZE = 4*2;

    public override both = `
precision mediump float;

#define MAX_DIRECTIONAL_LIGHTS ${MAX_DIRECTIONAL_LIGHTS}

struct DirectionalLight {
    vec4 direction;
    vec4 color;
};

layout(std140) uniform ub_AtomicParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
    Mat4x4 u_ModelMatrix;
    DirectionalLight u_DirectionalLights[MAX_DIRECTIONAL_LIGHTS];
    vec4 u_AmbientColor;
    vec4 u_FogColor;
    vec4 u_AtomicMisc;
};

#define u_FarPlane (u_AtomicMisc.x)
#define u_FogPlane (u_AtomicMisc.y)
#define u_AlphaRef (u_AtomicMisc.z)
#define u_AtomicFlags (int(u_AtomicMisc.w))

#define u_EnablePrelit ((u_AtomicFlags & 0x1) != 0)
#define u_EnableLight ((u_AtomicFlags & 0x2) != 0)

layout(std140) uniform ub_MeshParams {
    vec4 u_MaterialColor;
    vec4 u_MeshMisc;
};

#define u_AmbientMult (u_MeshMisc.x)
#define u_DiffuseMult (u_MeshMisc.y)
#define u_MeshFlags (int(u_MeshMisc.z))

#define u_EnableTexture ((u_MeshFlags & 0x1) != 0)

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
    gl_Position = Mul(u_Projection, Mul(u_ViewMatrix, Mul(u_ModelMatrix, vec4(a_Position, 1.0))));

    vec3 t_Normal = normalize(Mul(u_ModelMatrix, vec4(a_Normal, 0.0)).xyz);

    vec4 t_Color = u_EnablePrelit ? a_Color : (u_EnableLight ? vec4(0, 0, 0, 1) : vec4(1.0));

    if (u_EnableLight) {
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
    if (u_EnableTexture)
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

    public render(atomic: RpAtomic, pipeline: AtomicAllInOnePipeline, rw: RwEngine) {
        const geom = atomic.geometry;

        if (rw.camera.nearPlane !== rw.viewerInput.camera.near &&
            rw.camera.farPlane !== rw.viewerInput.camera.far) {
            rw.viewerInput.camera.setClipPlanes(rw.camera.nearPlane, rw.camera.farPlane);
        }

        const template = rw.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(pipeline.megaStateFlags);

        let offs = template.allocateUniformBuffer(AtomicProgram.ub_AtomicParams, AtomicProgram.ub_AtomicParams_SIZE);
        const mapped = template.mapUniformBufferF32(AtomicProgram.ub_AtomicParams);

        offs += fillMatrix4x4(mapped, offs, rw.viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(mapped, offs, rw.camera.viewMatrix);
        offs += fillMatrix4x4(mapped, offs, atomic.frame.matrix);

        if (geom.flags & RpGeometryFlag.LIGHT) {
            for (let i = 0; i < MAX_DIRECTIONAL_LIGHTS; i++) {
                offs += fillVec3v(mapped, offs, pipeline.directionalLightDirections[i]);
                offs += fillColor(mapped, offs, pipeline.directionalLightColors[i]);
            }
            offs += fillColor(mapped, offs, pipeline.ambientLightColor);
        } else {
            for (let i = 0; i < MAX_DIRECTIONAL_LIGHTS; i++) {
                offs += fillVec4(mapped, offs, 0);
                offs += fillVec4(mapped, offs, 0);
            }
            offs += fillVec4(mapped, offs, 0);
        }

        const fogColor = rw.renderState.fogEnable ? rw.renderState.fogColor : TransparentBlack;
        offs += fillColor(mapped, offs, fogColor);

        const farPlane = rw.camera.farPlane;
        const fogPlane = rw.camera.fogPlane;
        const alphaRef = rw.renderState.alphaTestFunctionRef;
        
        let atomicFlags = 0;
        if (atomic.geometry.flags & RpGeometryFlag.PRELIT) atomicFlags |= 0x1;
        if (atomic.geometry.flags & RpGeometryFlag.LIGHT) atomicFlags |= 0x2;

        offs += fillVec4(mapped, offs, farPlane, fogPlane, alphaRef, atomicFlags);

        for (const mesh of this.meshes) {
            const renderInst = rw.renderHelper.renderInstManager.newRenderInst();

            let offs = renderInst.allocateUniformBuffer(AtomicProgram.ub_MeshParams, AtomicProgram.ub_MeshParams_SIZE);
            const mapped = renderInst.mapUniformBufferF32(AtomicProgram.ub_MeshParams);

            const materialColor = (geom.flags & RpGeometryFlag.MODULATEMATERIALCOLOR) ? mesh.material.color : White;
            offs += fillColor(mapped, offs, materialColor);

            const ambientMult = mesh.material.ambient;
            const diffuseMult = mesh.material.diffuse;

            let meshFlags = 0;
            if (mesh.material.texture) meshFlags |= 0x1;

            offs += fillVec4(mapped, offs, ambientMult, diffuseMult, meshFlags);

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

function convertRwBlendFunction(blend: RwBlendFunction): GfxBlendFactor {
    switch (blend) {
    case RwBlendFunction.NABLEND:      return GfxBlendFactor.Zero;
    case RwBlendFunction.ZERO:         return GfxBlendFactor.Zero;
    case RwBlendFunction.ONE:          return GfxBlendFactor.One;
    case RwBlendFunction.SRCCOLOR:     return GfxBlendFactor.Src;
    case RwBlendFunction.INVSRCCOLOR:  return GfxBlendFactor.OneMinusSrc;
    case RwBlendFunction.SRCALPHA:     return GfxBlendFactor.SrcAlpha;
    case RwBlendFunction.INVSRCALPHA:  return GfxBlendFactor.OneMinusSrcAlpha;
    case RwBlendFunction.DESTALPHA:    return GfxBlendFactor.DstAlpha;
    case RwBlendFunction.INVDESTALPHA: return GfxBlendFactor.OneMinusDstAlpha;
    case RwBlendFunction.DESTCOLOR:    return GfxBlendFactor.Dst;
    case RwBlendFunction.INVDESTCOLOR: return GfxBlendFactor.OneMinusDst;
    case RwBlendFunction.SRCALPHASAT:  return GfxBlendFactor.SrcAlpha; // unsupported
    }
}

function convertRwCullMode(cull: RwCullMode): GfxCullMode {
    switch (cull) {
    case RwCullMode.NONE:  return GfxCullMode.None;
    case RwCullMode.BACK:  return GfxCullMode.Back;
    case RwCullMode.FRONT: return GfxCullMode.Front;
    }
}

export class AtomicAllInOnePipeline implements RpAtomicPipeline {
    private gfxProgram?: GfxProgram;

    public megaStateFlags: Partial<GfxMegaStateDescriptor> = makeMegaState();

    public ambientLightColor = colorNewCopy(OpaqueBlack);
    public directionalLightDirections = nArray(MAX_DIRECTIONAL_LIGHTS, () => vec3.create());
    public directionalLightColors = nArray(MAX_DIRECTIONAL_LIGHTS, () => colorNewCopy(OpaqueBlack));

    private enabledLights = new Set<RpLight>();

    public instance(atomic: RpAtomic, rw: RwEngine) {
        if (!this.gfxProgram) {
            this.gfxProgram = rw.renderHelper.renderCache.createProgram(new AtomicProgram());
        }
        
        if (!atomic.geometry.instanceData) {
            atomic.geometry.instanceData = new InstanceData(atomic.geometry, this.gfxProgram, rw);
        }

        this.updateRenderState(rw);
        this.updateLights(rw);
        
        (atomic.geometry.instanceData as InstanceData).render(atomic, this, rw);
    }

    public destroy(atomic: RpAtomic, rw: RwEngine) {
        (atomic.geometry.instanceData as InstanceData)?.destroy(atomic, rw);
        atomic.geometry.instanceData = undefined;
    }

    private updateRenderState(rw: RwEngine) {
        this.megaStateFlags.depthCompare = reverseDepthForCompareMode(rw.renderState.zTestEnable ? GfxCompareMode.LessEqual : GfxCompareMode.Always);
        this.megaStateFlags.depthWrite = rw.renderState.zWriteEnable;
        this.megaStateFlags.cullMode = convertRwCullMode(rw.renderState.cullMode);
        
        const attachmentState = this.megaStateFlags.attachmentsState![0];

        const srcBlend = convertRwBlendFunction(rw.renderState.srcBlend);
        attachmentState.rgbBlendState.blendSrcFactor = srcBlend;
        attachmentState.alphaBlendState.blendSrcFactor = srcBlend;

        const dstBlend = convertRwBlendFunction(rw.renderState.destBlend);
        attachmentState.rgbBlendState.blendDstFactor = dstBlend;
        attachmentState.alphaBlendState.blendDstFactor = dstBlend;

        attachmentState.channelWriteMask = rw.renderState.channelWriteMask;
    }

    private updateLights(rw: RwEngine) {
        // TODO: We should eventually check if any lights were modified (moved, changed color, etc.),
        //       but that's not needed right now
        let dirty = false;
        for (const light of rw.world.lights) {
            if (light.flags & RpLightFlag.LIGHTATOMICS) {
                if (!this.enabledLights.has(light)) {
                    dirty = true;
                    this.enabledLights.add(light);
                }
            } else {
                if (this.enabledLights.has(light)) {
                    dirty = true;
                    this.enabledLights.delete(light);
                }
            }
        }
        for (const light of this.enabledLights) {
            if (!(light.flags & RpLightFlag.LIGHTATOMICS) || !rw.world.lights.has(light)) {
                dirty = true;
                this.enabledLights.delete(light);
            }
        }

        if (dirty) {
            colorCopy(this.ambientLightColor, OpaqueBlack);

            let directionalLightCount = 0;
            for (const light of this.enabledLights) {
                if (light.type === RpLightType.DIRECTIONAL) {
                    if (directionalLightCount < MAX_DIRECTIONAL_LIGHTS) {
                        const dir = this.directionalLightDirections[directionalLightCount];
                        getMatrixAxisZ(dir, light.frame.matrix);
                        vec3.normalize(dir, dir);
    
                        const color = this.directionalLightColors[directionalLightCount];
                        color.r = light.color.r * light.color.a;
                        color.g = light.color.g * light.color.a;
                        color.b = light.color.b * light.color.a;
    
                        directionalLightCount++;
                    }
                } else if (light.type === RpLightType.AMBIENT) {
                    this.ambientLightColor.r += light.color.r * light.color.a;
                    this.ambientLightColor.g += light.color.g * light.color.a;
                    this.ambientLightColor.b += light.color.b * light.color.a;
                }
            }
            for (let i = directionalLightCount; i < MAX_DIRECTIONAL_LIGHTS; i++) {
                vec3.set(this.directionalLightDirections[i], 0, 0, 0);
                colorCopy(this.directionalLightColors[i], TransparentBlack);
            }
        }        
    }
}