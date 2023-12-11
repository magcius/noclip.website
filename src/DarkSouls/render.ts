
import { FLVER, VertexInputSemantic, Material, Primitive, Batch, VertexAttribute } from "./flver.js";
import { GfxDevice, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxFrontFaceMode, GfxClipSpaceNearZ, GfxTextureDimension, GfxSamplerFormatKind, GfxChannelWriteMask } from "../gfx/platform/GfxPlatform.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { coalesceBuffer, GfxCoalescedBuffer } from "../gfx/helpers/BufferHelpers.js";
import { convertToTriangleIndexBuffer, GfxTopology, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers.js";
import { makeSortKey, GfxRendererLayer, setSortKeyDepth, GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { DDSTextureHolder } from "./dds.js";
import { nArray, assert, assertExists, leftPad } from "../util.js";
import { TextureMapping } from "../TextureHolder.js";
import { mat4, ReadonlyMat4, vec2, vec3, vec4 } from "gl-matrix";
import * as Viewer from "../viewer.js";
import { Camera, CameraController, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera.js";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v, fillVec4, fillVec3v, fillColor } from "../gfx/helpers/UniformBufferHelpers.js";
import { AABB, Frustum } from "../Geometry.js";
import { ModelHolder, MaterialDataHolder, ResourceSystem } from "./scenes.js";
import { MSB, Part } from "./msb.js";
import { getMatrixAxisZ, getMatrixTranslation, MathConstants, saturate, Vec3One } from "../MathHelpers.js";
import { MTD, MTDTexture } from './mtd.js';
import { interactiveVizSliderSelect } from '../DebugJunk.js';
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { colorNewCopy, White } from "../Color.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { dfRange, dfShow } from "../DebugFloaters.js";
import { ParamFile, parseParamDef } from "./param.js";
import * as BND3 from "./bnd3.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { LayerPanel, Panel } from "../ui.js";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import { SceneContext } from "../SceneBase.js";

function shouldRenderPrimitive(primitive: Primitive): boolean {
    return primitive.flags === 0;
}

function isLODModel(name: string): boolean {
    // The original game handles LOD models through "draw groups" where when you are on a certain
    // collision mesh, the game will only show models that have any draw group bits in common with the
    // collision triangle. While a reasonable approximation might be to calculate the collision bounds
    // and check if the camera is inside that, parsing collision is too much for us right now. So this
    // is a manual approach.

    const lodModels = [
        // Undead Burg / Parish
        "m2340B1",
        "m2380B1",
        "m2390B1",
        "m2410B1",
        "m2430B1",
        "m2500B1",
        "m3301B1",
        // Anor Londo
        "m8000B1_0000",
        "m8010B1_0000",
        "m8020B1_0000",
        "m8030B1_0000",
    ];

    return lodModels.includes(name);
}

function translateLocation(attr: VertexAttribute): number {
    switch (attr.semantic) {
    case VertexInputSemantic.Position:  return DKSProgram.a_Position;
    case VertexInputSemantic.Color:     return DKSProgram.a_Color;
    case VertexInputSemantic.UV:        {
        if (attr.index === 0)
            return DKSProgram.a_TexCoord0;
        else if (attr.index === 1)
            return DKSProgram.a_TexCoord1;
        else
            throw "whoops";
    }
    case VertexInputSemantic.Normal:    return DKSProgram.a_Normal;
    case VertexInputSemantic.Tangent:   return DKSProgram.a_Tangent;
    case VertexInputSemantic.Bitangent: return DKSProgram.a_Bitangent;
    default: return -1;
    }
}

function translateDataType(dataType: number): GfxFormat {
    switch (dataType) {
    case 17:
        // Bone indices -- four bytes.
        return GfxFormat.U8_RGBA_NORM;
    case 19:
        // Colors and normals -- four bytes.
        return GfxFormat.U8_RGBA_NORM;
    case 21:
        // One set of UVs -- two shorts.
        return GfxFormat.S16_RG_NORM;
    case 22:
        // Two sets of UVs -- four shorts.
        return GfxFormat.S16_RGBA_NORM;
    case 26:
        // Bone weight -- four shorts.
        return GfxFormat.S16_RGBA_NORM;
    case 2:
    case 18:
    case 20:
    case 23:
    case 24:
    case 25:
        // Everything else -- three floats.
        return GfxFormat.F32_RGBA;
    default:
        throw "whoops";
    }
}

class BatchData {
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public primitiveIndexCounts: number[] = [];
    public primitiveIndexStarts: number[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, flverData: FLVERData, public batch: Batch, vertexBuffer: GfxCoalescedBuffer, indexBuffers: GfxCoalescedBuffer[], triangleIndexCounts: number[]) {
        const flverInputState = flverData.flver.inputStates[batch.inputStateIndex];
        const flverInputLayout = flverData.flver.inputLayouts[flverInputState.inputLayoutIndex];
        this.vertexBufferDescriptors = [vertexBuffer];

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        for (let j = 0; j < flverInputLayout.vertexAttributes.length; j++) {
            const vertexAttributes = flverInputLayout.vertexAttributes[j];
            const location = translateLocation(vertexAttributes);
            if (location < 0)
                continue;

            vertexAttributeDescriptors.push({
                location,
                format: translateDataType(vertexAttributes.dataType),
                bufferByteOffset: vertexAttributes.offset,
                bufferIndex: 0,
            });
        }

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: flverInputState.vertexSize, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.indexBufferDescriptor = indexBuffers[0];

        for (let j = 0; j < batch.primitiveIndexes.length; j++) {
            const coaIndexBuffer = assertExists(indexBuffers.shift());
            this.primitiveIndexCounts.push(assertExists(triangleIndexCounts.shift()));
            this.primitiveIndexStarts.push((coaIndexBuffer.byteOffset - this.indexBufferDescriptor.byteOffset) / 2);
        }
    }

    public destroy(device: GfxDevice): void {
    }
}

export class FLVERData {
    public batchData: BatchData[] = [];
    public gfxSampler: GfxSampler;
    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    constructor(cache: GfxRenderCache, public flver: FLVER) {
        const vertexBufferDatas: ArrayBufferSlice[] = [];
        const indexBufferDatas: ArrayBufferSlice[] = [];
        for (let i = 0; i < flver.inputStates.length; i++) {
            vertexBufferDatas.push(flver.inputStates[i].vertexData);
            flver.inputStates[i].vertexData = null as unknown as ArrayBufferSlice;
        }
        const vertexBuffers = coalesceBuffer(cache.device, GfxBufferUsage.Vertex, vertexBufferDatas);
        this.vertexBuffer = vertexBuffers[0].buffer;

        const triangleIndexCounts: number[] = [];

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            for (let j = 0; j < batch.primitiveIndexes.length; j++) {
                const primitive = flver.primitives[batch.primitiveIndexes[j]];
                const triangleIndexData = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(GfxTopology.TriStrips, primitive.indexData.createTypedArray(Uint16Array)));
                const triangleIndexCount = triangleIndexData.byteLength / 2;
                indexBufferDatas.push(new ArrayBufferSlice(triangleIndexData.buffer));
                triangleIndexCounts.push(triangleIndexCount);
                primitive.indexData = null as unknown as ArrayBufferSlice;
            }
        }

        const indexBuffers = coalesceBuffer(cache.device, GfxBufferUsage.Index, indexBufferDatas);
        this.indexBuffer = indexBuffers[0].buffer;

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            const coaVertexBuffer = vertexBuffers[batch.inputStateIndex];
            const batchData = new BatchData(cache.device, cache, this, batch, coaVertexBuffer, indexBuffers, triangleIndexCounts);
            this.batchData.push(batchData);
        }

        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);

        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].destroy(device);
    }
}

function getTexAssign(mtd: MTD, name: string): number {
    return mtd.textures.findIndex((t) => t.name === name);
}

class DKSProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;
    public static a_Normal = 4;
    public static a_Tangent = 5;
    public static a_Bitangent = 6;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public static BindingDefinitions = `
// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
};

struct DirectionalLight {
    vec4 Direction;
    vec4 Color;
};

// Light Scattering is also packed in here
struct HemisphereLight {
    // R, G, B, LS BetaRay
    vec4 ColorU;
    // R, G, B, LS BetaMie
    vec4 ColorD;
};

struct PointLight {
    vec4 PositionAttenStart;
    vec4 ColorAttenEnd;
};

// Light Scattering is also packed in here
struct FogParams {
    // Fog BeginZ, Fog EndZ, LS HGg, LS DistanceMul
    // SunDirX, SunDirY, SunDirZ
    vec4 Misc[2];
    // R, G, B, Fog MaxDensity
    vec4 FogColor;
    // R, G, B, LS BlendCoeff
    vec4 SunColor;
    // R, G, B
    vec4 Reflectance;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_WorldFromLocal[1];
    vec4 u_DiffuseMapColor;
    // Fourth element has g_SpecularPower
    vec4 u_SpecularMapColor;
    vec4 u_EnvDifColor;
    vec4 u_EnvSpcColor;
    DirectionalLight u_DirectionalLight[3];
    HemisphereLight u_HemisphereLight;
    PointLight u_PointLights[1];
    FogParams u_FogParams;
    // g_TexScroll0, g_TexScroll1
    // g_TexScroll2,
    vec4 u_Misc[2];
};

#define u_SpecularPower (u_SpecularMapColor.w)
#define u_TexScroll0    (u_Misc[0].xy)
#define u_TexScroll1    (u_Misc[0].zw)
#define u_TexScroll2    (u_Misc[1].xy)

uniform sampler2D u_Texture0;
uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;
uniform sampler2D u_Texture3;
uniform sampler2D u_Texture4;
uniform sampler2D u_Texture5;
uniform sampler2D u_Texture6;
uniform sampler2D u_Texture7;

uniform samplerCube u_TextureEnvDif;
uniform samplerCube u_TextureEnvSpc;
`;

    public override both = `
precision mediump float;

${DKSProgram.BindingDefinitions}

varying vec4 v_Color;
varying vec2 v_TexCoord0;
varying vec2 v_TexCoord1;
varying vec2 v_TexCoord2;
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;
`;

    public override vert = `
layout(location = ${DKSProgram.a_Position})  in vec3 a_Position;
layout(location = ${DKSProgram.a_Color})     in vec4 a_Color;
layout(location = ${DKSProgram.a_TexCoord0}) in vec4 a_TexCoord0;
layout(location = ${DKSProgram.a_TexCoord1}) in vec4 a_TexCoord1;
layout(location = ${DKSProgram.a_Normal})    in vec4 a_Normal;
layout(location = ${DKSProgram.a_Tangent})   in vec4 a_Tangent;

#ifdef HAS_BITANGENT
layout(location = ${DKSProgram.a_Bitangent}) in vec4 a_Bitangent;
#endif

#define UNORM_TO_SNORM(xyz) ((xyz - 0.5) * 2.0)

${GfxShaderLibrary.MulNormalMatrix}

void main() {
    vec4 t_PositionWorld = Mul(_Mat4x4(u_WorldFromLocal[0]), vec4(a_Position, 1.0));
    v_PositionWorld = t_PositionWorld.xyz;
    gl_Position = Mul(u_ProjectionView, t_PositionWorld);

    vec3 t_NormalWorld = MulNormalMatrix(u_WorldFromLocal[0], UNORM_TO_SNORM(a_Normal.xyz));
    vec3 t_TangentSWorld = MulNormalMatrix(u_WorldFromLocal[0], UNORM_TO_SNORM(a_Tangent.xyz));

#ifdef HAS_BITANGENT
    vec3 t_TangentTWorld = MulNormalMatrix(u_WorldFromLocal[0], UNORM_TO_SNORM(a_Bitangent.xyz));
#else
    vec3 t_TangentTWorld = normalize(cross(t_NormalWorld, t_TangentSWorld));
#endif

    v_TangentSpaceBasis0 = t_TangentTWorld * sign(UNORM_TO_SNORM(a_Tangent.w));
    v_TangentSpaceBasis1 = t_TangentSWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_Color = a_Color;
    v_TexCoord0 = (a_TexCoord0.xy * 32.0) + u_TexScroll0.xy;
    v_TexCoord1 = (a_TexCoord0.zw * 32.0) + u_TexScroll1.xy;
    v_TexCoord2 = (a_TexCoord1.xy * 32.0) + u_TexScroll2.xy;
}
`;

    constructor(private mtd: MTD) {
        super();
        this.frag = this.genFrag();
    }

    private getTexture(name: string): MTDTexture | null {
        const texDef = this.mtd.textures.find((t) => t.name === name);
        if (texDef !== undefined)
            return texDef;
        else
            return null;
    }

    private buildTexAccess(texParam: MTDTexture): string {
        const texAssign = getTexAssign(this.mtd, texParam.name);
        assert(texAssign > -1);
        return `texture(SAMPLER_2D(u_Texture${texAssign}), v_TexCoord${texParam.uvNumber})`;
    }

    private genDiffuse(): string {
        const diffuse1 = this.getTexture('g_Diffuse');
        const diffuse2 = this.getTexture('g_Diffuse_2');

        const diffuseEpi = `
    if (!t_DiffuseMapEnabled)
        t_Diffuse.rgb = vec3(1.0);
    t_Diffuse.rgb *= u_DiffuseMapColor.rgb;
`;

        if (diffuse1 !== null && diffuse2 !== null) {
            return `
    vec4 t_Diffuse1 = ${this.buildTexAccess(diffuse1)};
    vec4 t_Diffuse2 = ${this.buildTexAccess(diffuse2)};
    vec4 t_Diffuse = mix(t_Diffuse1, t_Diffuse2, v_Color.a);
${diffuseEpi}
`;
        } else if (diffuse1 !== null) {
            return `
    vec4 t_Diffuse1 = ${this.buildTexAccess(diffuse1)};
    vec4 t_Diffuse = t_Diffuse1;
${diffuseEpi}
    `;
        } else {
            return `
    vec4 t_Diffuse = vec4(1.0);
${diffuseEpi}
`;
        }
    }

    private genSpecular(): string {
        const specular1 = this.getTexture('g_Specular');
        const specular2 = this.getTexture('g_Specular_2');

        const specularEpi = `
    t_Specular.rgb *= u_SpecularMapColor.rgb;
`;

        if (specular1 !== null && specular2 !== null) {
            return `
    vec3 t_Specular1 = ${this.buildTexAccess(specular1)}.rgb;
    vec3 t_Specular2 = ${this.buildTexAccess(specular2)}.rgb;
    vec3 t_Specular = mix(t_Specular1, t_Specular2, t_Blend);
${specularEpi}
`;
        } else if (specular1 !== null) {
            return `
    vec3 t_Specular1 = ${this.buildTexAccess(specular1)}.rgb;
    vec3 t_Specular = t_Specular1;
${specularEpi}
    `;
        } else {
            return `
    vec3 t_Specular = vec3(0.0);
`;
        }
    }

    private genNormalDir(): string {
        const bumpmap1 = this.getTexture('g_Bumpmap');
        const bumpmap2 = this.getTexture('g_Bumpmap_2');

        const bumpmapEpi = `
    vec3 t_NormalTangentSpace = DecodeNormalMap(t_BumpmapSample.xyz);
    vec3 t_NormalDirWorld = normalize(CalcTangentToWorld(t_NormalTangentSpace, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2));
`;

        if (bumpmap1 !== null && bumpmap2 !== null) {
            return `
    vec3 t_Bumpmap1 = ${this.buildTexAccess(bumpmap1)}.rgb;
    vec3 t_Bumpmap2 = ${this.buildTexAccess(bumpmap2)}.rgb;
    vec3 t_BumpmapSample = mix(t_Bumpmap1, t_Bumpmap2, t_Blend);
${bumpmapEpi}
`;
        } else if (bumpmap1 !== null) {
            return `
    vec3 t_Bumpmap1 = ${this.buildTexAccess(bumpmap1)}.rgb;
    vec3 t_BumpmapSample = t_Bumpmap1;
${bumpmapEpi}
`;
        } else {
            return `
    vec3 t_NormalDirWorld = v_TangentSpaceBasis2;
`;
        }
    }

    private genLightMap(): string {
        const lightmap = this.getTexture('g_Lightmap');

        if (lightmap !== null) {
            return `
    if (t_LightmapEnabled) {
        t_IncomingDiffuseRadiance.rgb *= ${this.buildTexAccess(lightmap)}.rgb;
        t_IncomingSpecularRadiance.rgb *= ${this.buildTexAccess(lightmap)}.rgb;
    }
`;
        } else {
            return '';
        }
    }

    private genAlphaTest(): string {
        const blendMode = getBlendMode(this.mtd);

        if (blendMode === BlendMode.TexEdge) {
            return `
    if (t_Color.a < 0.5)
        discard;
`;
        } else {
            return '';
        }
    }

    private genFrag(): string {
        return `
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

vec3 DecodeNormalMap(vec3 t_NormalMapIn) {
    // Decode two-channel normal map
    vec3 t_NormalMap;
    t_NormalMap.xy = t_NormalMapIn.xy * 2.0 - 1.0;
    t_NormalMap.z = sqrt(1.0 - min(dot(t_NormalMap.xy, t_NormalMap.xy), 1.0));
    return normalize(t_NormalMap.xyz);
}

vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_TangentNormal.xxx * t_Basis0 + t_TangentNormal.yyy * t_Basis1 + t_TangentNormal.zzz * t_Basis2;
}

vec3 HSVtoRGB(in vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void CalcFog(inout vec3 t_Color, in FogParams t_FogParams, in vec3 t_PositionToEye) {
    float t_FogBeginZ = t_FogParams.Misc[0].x;
    float t_FogEndZ = t_FogParams.Misc[0].y;
    vec3 t_FogColor = t_FogParams.FogColor.rgb;
    float t_FogMaxDensity = t_FogParams.FogColor.a;

    float t_FogFactor = saturate(invlerp(t_FogBeginZ, t_FogEndZ, length(t_PositionToEye)));
    t_FogFactor = min(t_FogFactor, t_FogMaxDensity);

    t_FogFactor *= t_FogFactor;

    t_Color.rgb = mix(t_Color.rgb, t_FogColor.rgb, t_FogFactor);
}

const float M_PI = ${Math.PI};
const float M_LOG2E = ${Math.LOG2E};

struct LightScatteringParams {
    float BetaRay;
    float BetaMie;
    float HGg;
    float DistanceMul;
    float BlendCoeff;
    vec3 SunDirection;
    vec3 SunColor;
    vec3 Reflectance;
};

void CalcLightScattering(inout vec3 t_Color, in LightScatteringParams t_LightScatteringParams, in vec3 t_PositionToEye) {
    // https://courses.cs.duke.edu/fall01/cps124/resources/p91-preetham.pdf
    float BetaRay     = t_LightScatteringParams.BetaRay;
    float BetaMie     = t_LightScatteringParams.BetaMie;
    float HGg         = t_LightScatteringParams.HGg;
    float DistanceMul = t_LightScatteringParams.DistanceMul;
    float BlendCoeff  = t_LightScatteringParams.BlendCoeff;
    vec3 SunColor     = t_LightScatteringParams.SunColor;
    vec3 SunDirection = t_LightScatteringParams.SunDirection;
    vec3 Reflectance  = t_LightScatteringParams.Reflectance;

#if 0
    vec3 t_Lambda = vec3(1.0 / 650.0e-9, 1.0 / 570e-9, 1.0 / 475.0e-9);
    vec3 t_Lambda2 = t_Lambda * t_Lambda;
    vec3 t_Lambda4 = t_Lambda2 * t_Lambda2;

    // Rayleigh scattering constants.
    float n = 1.0003;
    float N = 2.545e25;
    float pn = 0.035;
    float t_BetaRayTemp = (M_PI * M_PI) * pow(n * n - 1.0, 2.0) * (6.0 + 3.0 * pn) / (6.0 - 7.0 * pn) / N;
    vec3 t_BetaRay = (8.0f * t_BetaRayTemp * M_PI / 3.0) * t_Lambda4 * BetaRay;
    vec3 t_BetaDashRay = t_BetaRayTemp * 0.5 * t_Lambda4 * BetaRay;

    // Mie scattering constants.
    float T = 2.0;
    float c = (6.544*T - 6.51) * 1e-17;
    float t_BetaMieTemp = 0.434 * c * pow(M_PI * 2.0, 2.0) * 0.5;
    vec3 t_BetaDashMie = t_BetaMieTemp * t_Lambda2 * BetaMie;
    vec3 K = vec3(0.685, 0.679, 0.670);
    float t_BetaMieTemp2 = 0.434 * c * M_PI * pow(M_PI * 2.0, 2.0);
    vec3 t_BetaMie = t_BetaMieTemp2 * K * t_Lambda2 * BetaMie;
#endif

    vec3 t_BetaRayMie = vec3(0.00000695264823003256, 0.000011757209601555067, 0.000024379749829784592) * BetaRay + vec3(0.0057405970869032425, 0.007399685656442677, 0.010514310340700878) * BetaMie;
    vec3 t_BetaDashRay = vec3(4.149556250207996e-7, 7.017067593956183e-7, 0.0000014550591362827545) * BetaRay;
    vec3 t_BetaDashMie = vec3(0.0013337874491672784, 0.0017344573631061092, 0.0024976186028727978) * BetaMie;

    float t_Distance = length(t_PositionToEye) * DistanceMul;
    vec3 t_Extinction = exp(-t_BetaRayMie * t_Distance * M_LOG2E);

    float t_VoL = dot(normalize(t_PositionToEye), SunDirection);
    float t_ViewRay = 1.0f + t_VoL * t_VoL;
    float t_ViewMie = (1.0f - HGg * HGg) / pow((-2.0 * HGg) * t_VoL + HGg + 1.0f, 1.5);

    vec3 t_InscatteringColor = ((t_BetaDashRay * t_ViewRay + t_BetaDashMie * t_ViewMie) * SunColor * (vec3(1.0) - t_Extinction)) / t_BetaRayMie;

    vec3 t_ScatteredColor = t_Color.rgb * Reflectance * t_Extinction + t_InscatteringColor;
    t_Color.rgb = mix(t_Color.rgb, t_ScatteredColor.rgb, BlendCoeff);
}

vec3 CalcDirLightDiffuse(in DirectionalLight t_DirLight, in vec3 t_NormalDirWorld) {
    return t_DirLight.Color.rgb * saturate(dot(-t_DirLight.Direction.xyz, t_NormalDirWorld));
}

vec3 CalcDirLightSpecular(in DirectionalLight t_DirLight, in vec3 t_ReflectionWorld) {
    return t_DirLight.Color.rgb * pow(saturate(dot(-t_DirLight.Direction.xyz, t_ReflectionWorld)), u_SpecularPower);
}

float CalcPointLightDistAtten(in PointLight t_PointLight, in vec3 t_PositionWorld) {
    vec3 t_LightPosition = t_PointLight.PositionAttenStart.xyz;
    float t_AttenStart = t_PointLight.PositionAttenStart.w;
    float t_AttenEnd = t_PointLight.ColorAttenEnd.w;

    vec3 t_Delta = t_LightPosition - t_PositionWorld.xyz;
    return saturate(invlerp(t_AttenEnd, t_AttenStart, length(t_Delta)));
}

vec3 CalcPointLightDiffuse(in PointLight t_PointLight, in vec3 t_PositionWorld, in vec3 t_NormalWorld) {
    vec3 t_LightPosition = t_PointLight.PositionAttenStart.xyz;
    vec3 t_LightColor = t_PointLight.ColorAttenEnd.rgb;

    vec3 t_Delta = t_LightPosition - t_PositionWorld.xyz;
    float t_DistAtten = CalcPointLightDistAtten(t_PointLight, t_PositionWorld);
    float t_DotAtten = saturate(dot(normalize(t_Delta), t_NormalWorld));

    return t_LightColor * t_DistAtten * t_DotAtten;
}

vec3 CalcPointLightSpecular(in PointLight t_PointLight, in vec3 t_PositionWorld, in vec3 t_ReflectionWorld) {
    vec3 t_LightPosition = t_PointLight.PositionAttenStart.xyz;
    vec3 t_LightColor = t_PointLight.ColorAttenEnd.rgb;

    vec3 t_Delta = t_LightPosition - t_PositionWorld.xyz;
    float t_DistAtten = CalcPointLightDistAtten(t_PointLight, t_PositionWorld);
    float t_DotAtten = pow(saturate(dot(normalize(t_Delta), t_ReflectionWorld)), u_SpecularPower);

    return t_LightColor * t_DistAtten * t_DotAtten;
}

void main() {
    bool t_DiffuseMapEnabled = true;
    bool t_LightmapEnabled = true;

    vec4 t_Color = vec4(1.0);
    float t_Blend = v_Color.a;

    ${this.genDiffuse()}

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;

    ${this.genNormalDir()}

    int t_LightingType = ${getLightingType(this.mtd)};

    if (t_LightingType == -1) {
        // Missing, probably a water shader.
        t_Color *= t_Diffuse;
    } else {
        vec3 t_OutgoingLight = vec3(0.0);

        vec3 t_IncomingDiffuseRadiance = vec3(0.0);
        vec3 t_IncomingSpecularRadiance = vec3(0.0);

        vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
        vec3 t_ReflectionWorld = reflect(-t_WorldDirectionToEye.xyz, t_NormalDirWorld.xyz);

        if (t_LightingType == 0) {
            // None
            t_IncomingDiffuseRadiance.rgb = vec3(1.0);
            t_IncomingSpecularRadiance.rgb = vec3(0.0);
        } else if (t_LightingType == 1) {
            // Dir3
            for (int i = 0; i < 3; i++) {
                t_IncomingDiffuseRadiance.rgb += CalcDirLightDiffuse(u_DirectionalLight[i], t_NormalDirWorld);
                t_IncomingSpecularRadiance.rgb += CalcDirLightSpecular(u_DirectionalLight[i], t_ReflectionWorld);
            }
        } else if (t_LightingType == 3) {
            // Env
            t_IncomingDiffuseRadiance.rgb += texture(SAMPLER_Cube(u_TextureEnvDif), t_NormalDirWorld).rgb * u_EnvDifColor.rgb;
            t_IncomingSpecularRadiance.rgb += texture(SAMPLER_Cube(u_TextureEnvSpc), t_ReflectionWorld).rgb * u_EnvSpcColor.rgb;
        }

        // Light map (really a baked indirect shadow map...) only applies to environment lighting.
        ${this.genLightMap()}

        for (int i = 0; i < 1; i++) {
            t_IncomingDiffuseRadiance.rgb += CalcPointLightDiffuse(u_PointLights[i], v_PositionWorld.xyz, t_NormalDirWorld.xyz);
            t_IncomingSpecularRadiance.rgb += CalcPointLightSpecular(u_PointLights[i], v_PositionWorld.xyz, t_ReflectionWorld);
        }

        // Hemisphere light for ambient.
        float t_DiffuseIntensity = dot(t_NormalDirWorld, vec3(0.0, 1.0, 0.0));
        t_IncomingDiffuseRadiance += mix(u_HemisphereLight.ColorD.rgb, u_HemisphereLight.ColorU.rgb, t_DiffuseIntensity * 0.5 + 0.5);

        ${this.genSpecular()}

        t_OutgoingLight += t_Diffuse.rgb * t_IncomingDiffuseRadiance;
        t_OutgoingLight += t_Specular * t_IncomingSpecularRadiance;

        t_Color.rgb *= t_OutgoingLight;
        t_Color.a *= t_Diffuse.a;
    }

    t_Color *= v_Color;
    ${this.genAlphaTest()}

    CalcFog(t_Color.rgb, u_FogParams, t_PositionToEye);

    LightScatteringParams t_LightScatteringParams;
    t_LightScatteringParams.BetaRay = u_HemisphereLight.ColorU.a;
    t_LightScatteringParams.BetaMie = u_HemisphereLight.ColorD.a;
    t_LightScatteringParams.HGg = u_FogParams.Misc[0].z;
    t_LightScatteringParams.DistanceMul = u_FogParams.Misc[0].w;
    t_LightScatteringParams.BlendCoeff = u_FogParams.SunColor.a;
    t_LightScatteringParams.SunDirection = u_FogParams.Misc[1].xyz;
    t_LightScatteringParams.SunColor = u_FogParams.SunColor.rgb;
    t_LightScatteringParams.Reflectance = u_FogParams.Reflectance.rgb;
    CalcLightScattering(t_Color.rgb, t_LightScatteringParams, t_PositionToEye);

    bool t_DebugNormal = false;
    if (t_DebugNormal) {
        t_Color.rgb = vec3(t_NormalDirWorld * 0.25 + 0.5);
    }

    gl_FragColor = t_Color;
}
`;
    }
}

function lookupTextureParameter(material: Material, paramName: string): string | null {
    const param = material.parameters.find((param) => param.name === paramName);
    if (param === undefined)
        return null;
    return param.value.split('\\').pop()!.replace(/\.tga|\.psd/, '');
}

const enum LightingType {
    Off = -1,
    None = 0,
    HemDirDifSpcx3 = 1,
    HemEnvDifSpc = 3,
}

const enum BlendMode {
    Normal,
    TexEdge,
    Blend,
    Water,
    Add,
    Sub,
    Mul,
    AddMul,
    SubMul,
    WaterWave,

    // Below are "linear space" variants, but as far as the community can tell, all lighting is in linear space.
    // It's likely that these were used at some point during development and the values were never removed.
    LSNormal = 0x20,
    LSTexEdge,
    LSBlend,
    LSWater,
    LSAdd,
    LSSub,
    LSMul,
    LSAddMul,
    LSSubMul,
    LSWaterWave,
};

function getMaterialParam(mtd: MTD, name: string): number[] | null {
    const params = mtd.params.find((param) => param.name === name);
    return params !== undefined ? params.value : null;
}

function getBlendMode(mtd: MTD): BlendMode {
    const v = assertExists(getMaterialParam(mtd, 'g_BlendMode'));
    assert(v.length === 1);
    let blendMode: BlendMode = v[0];

    // Remove LS
    if (blendMode >= BlendMode.LSNormal)
        blendMode -= BlendMode.LSNormal;

    return blendMode;
}

function getLightingType(mtd: MTD): LightingType {
    const v = getMaterialParam(mtd, 'g_LightingType');
    if (!v)
        return -1;

    assert(v.length === 1);
    const lightingType = v[0];
    assert(lightingType === 0 || lightingType === 1 || lightingType === 3);
    return lightingType;
}

function linkTextureParameter(textureMapping: TextureMapping[], textureHolder: DDSTextureHolder, name: string, material: Material, mtd: MTD): void {
    const texDef = mtd.textures.find((t) => t.name === name);
    if (texDef === undefined)
        return;

    const textureName = assertExists(lookupTextureParameter(material, name)).toLowerCase();
    if (textureHolder.hasTexture(textureName)) {
        const texAssign = getTexAssign(mtd, name);
        textureHolder.fillTextureMapping(textureMapping[texAssign], textureName);
    } else {
        // TODO(jstpierre): Missing textures?
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
class BatchInstance {
    private visible = true;
    private diffuseMapColor = vec3.fromValues(1, 1, 1);
    private specularMapColor = vec4.fromValues(0, 0, 0, 0);
    private texScroll = nArray(3, () => vec2.create());
    private textureMapping = nArray(10, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor>;
    private program: DKSProgram;
    private gfxProgram: GfxProgram;
    private sortKey: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, private flverData: FLVERData, private batchData: BatchData, textureHolder: DDSTextureHolder, private material: Material, private mtd: MTD) {
        this.program = new DKSProgram(mtd);

        // If this is a Water shader, turn off by default until we RE this.
        if (mtd.shaderPath.includes('_Water_'))
            this.visible = false;

        const inputState = flverData.flver.inputStates[batchData.batch.inputStateIndex];
        const inputLayout = flverData.flver.inputLayouts[inputState.inputLayoutIndex];

        if (inputLayout.vertexAttributes.some((vertexAttribute) => vertexAttribute.semantic === VertexInputSemantic.Bitangent)) {
            // TODO(jstpierre): I don't think this is correct. It doesn't seem like a bitangent, but more like a bent binormal? Needs investigation.
            // this.program.defines.set('HAS_BITANGENT', '1');
        }

        linkTextureParameter(this.textureMapping, textureHolder, 'g_Diffuse',    material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Specular',   material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Bumpmap',    material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Diffuse_2',  material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Specular_2', material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Bumpmap_2',  material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Lightmap',   material, mtd);

        for (let i = 0; i < this.textureMapping.length; i++)
            this.textureMapping[i].gfxSampler = this.flverData.gfxSampler;

        const blendMode = getBlendMode(mtd);
        let isTranslucent = false;
        if (blendMode === BlendMode.Normal) {
            // Default
            this.megaState = {};
        } else if (blendMode === BlendMode.Blend) {
            this.megaState = {
                depthWrite: false,
            };
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            isTranslucent = true;
        } else if (blendMode === BlendMode.Add) {
            this.megaState = {
                depthWrite: false,
            };
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            });
            isTranslucent = true;
        } else if (blendMode === BlendMode.TexEdge) {
            this.megaState = {};
        } else {
            this.megaState = {};
            console.warn(`Unknown blend mode ${blendMode} in material ${material.mtdName}`);
        }

        const diffuseMapColor = getMaterialParam(mtd, 'g_DiffuseMapColor');
        if (diffuseMapColor !== null) {
            const diffuseMapColorPower = assertExists(getMaterialParam(mtd, `g_DiffuseMapColorPower`))[0];
            vec3.set(this.diffuseMapColor, diffuseMapColor[0] * diffuseMapColorPower, diffuseMapColor[1] * diffuseMapColorPower, diffuseMapColor[2] * diffuseMapColorPower);
        }

        const specularMapColor = getMaterialParam(mtd, 'g_SpecularMapColor');
        if (specularMapColor !== null) {
            const specularMapColorPower = assertExists(getMaterialParam(mtd, `g_SpecularMapColorPower`))[0];
            vec4.set(this.specularMapColor, specularMapColor[0] * specularMapColorPower, specularMapColor[1] * specularMapColorPower, specularMapColor[2] * specularMapColorPower, 0);
        }

        const specularPower = getMaterialParam(mtd, 'g_SpecularPower');
        if (specularPower !== null)
            this.specularMapColor[3] = specularPower[0];

        for (let i = 0; i < 3; i++) {
            const param = getMaterialParam(mtd, `g_TexScroll_${i}`);
            if (param)
                vec2.set(this.texScroll[i], param[0], param[1]);
        }

        this.program.ensurePreprocessed(device.queryVendorInfo());
        this.gfxProgram = cache.createProgram(this.program);

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer, 0);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, view: CameraView, modelMatrix: ReadonlyMat4, materialDrawConfig: MaterialDrawConfig, textureHolder: DDSTextureHolder): void {
        if (!this.visible)
            return;

        textureHolder.fillTextureMapping(this.textureMapping[8], `envdif_${materialDrawConfig.areaID}_${leftPad('' + materialDrawConfig.lightParams.envDifTextureNo, 3)}`)

        const envSpcSlotNo = getMaterialParam(this.mtd, `g_EnvSpcSlotNo`);
        if (envSpcSlotNo !== null)
            textureHolder.fillTextureMapping(this.textureMapping[9], `envspc_${materialDrawConfig.areaID}_${leftPad('' + materialDrawConfig.lightParams.envSpcTextureNo[envSpcSlotNo[0]], 3)}`)

        const template = renderInstManager.pushTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);
        template.setVertexInput(this.batchData.inputLayout, this.batchData.vertexBufferDescriptors, this.batchData.indexBufferDescriptor);
        template.setMegaStateFlags(this.megaState);

        let offs = template.allocateUniformBuffer(DKSProgram.ub_MeshFragParams, 12*1 + 4*4 + 4*2*3 + 4*11);
        const d = template.mapUniformBufferF32(DKSProgram.ub_MeshFragParams);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += fillVec3v(d, offs, this.diffuseMapColor);
        offs += fillVec4v(d, offs, this.specularMapColor);
        offs += fillColor(d, offs, materialDrawConfig.lightParams.envDifColor);
        offs += fillColor(d, offs, materialDrawConfig.lightParams.envSpcColor);

        for (let i = 0; i < materialDrawConfig.lightParams.dirLight.length; i++)
            offs += materialDrawConfig.lightParams.dirLight[i].fill(d, offs);

        offs += fillColor(d, offs, materialDrawConfig.lightParams.hemisphereLight.colorU, materialDrawConfig.lightScatteringParams.betaRay);
        offs += fillColor(d, offs, materialDrawConfig.lightParams.hemisphereLight.colorD, materialDrawConfig.lightScatteringParams.betaMie);
        for (let i = 0; i < materialDrawConfig.pointLight.length; i++)
            offs += materialDrawConfig.pointLight[i].fill(d, offs);

        offs += fillVec4(d, offs,
            materialDrawConfig.fogParams.fogBeginZ,
            materialDrawConfig.fogParams.fogEndZ,
            materialDrawConfig.lightScatteringParams.HGg,
            materialDrawConfig.lightScatteringParams.distanceMul,
        );

        calcDirFromRotXY(scratchVec3a, materialDrawConfig.lightScatteringParams.sunRotX, materialDrawConfig.lightScatteringParams.sunRotY);
        offs += fillVec3v(d, offs, scratchVec3a);
        offs += fillColor(d, offs, materialDrawConfig.fogParams.color);
        offs += fillColor(d, offs, materialDrawConfig.lightScatteringParams.sunColor, materialDrawConfig.lightScatteringParams.blendCoeff);
        offs += fillColor(d, offs, materialDrawConfig.lightScatteringParams.groundReflectance);

        const scrollTime = viewerInput.time / 1000;
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[0][0], scrollTime * this.texScroll[0][1],
            scrollTime * this.texScroll[1][0], scrollTime * this.texScroll[1][1],
        );
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[2][0], scrollTime * this.texScroll[2][1],
        );

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(view.viewFromWorldMatrix, bboxScratch);

        for (let j = 0; j < this.batchData.batch.primitiveIndexes.length; j++) {
            const primitive = this.flverData.flver.primitives[this.batchData.batch.primitiveIndexes[j]];
            if (!shouldRenderPrimitive(primitive))
                continue;

            const renderInst = renderInstManager.newRenderInst();
            if (primitive.cullMode)
                renderInst.getMegaStateFlags().cullMode = GfxCullMode.Back;
            renderInst.drawIndexes(this.batchData.primitiveIndexCounts[j], this.batchData.primitiveIndexStarts[j]);
            renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

class DirectionalLight {
    public dir = vec3.create();
    public color = colorNewCopy(White);

    public fill(d: Float32Array, offs: number): number {
        const baseOffs = offs;
        offs += fillVec3v(d, offs, this.dir);
        offs += fillColor(d, offs, this.color);
        return offs - baseOffs;
    }
}

class HemisphereLight {
    public colorU = colorNewCopy(White);
    public colorD = colorNewCopy(White);
}

class PointLightParams {
    public name: string = '';
    public attenStart = 0;
    public attenEnd = 0;
    public color = colorNewCopy(White);

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.attenStart = param.get(i, `dwindleBegin`);
        this.attenEnd = param.get(i, `dwindleEnd`);
        // noclip modification: to aid large-scale exploration, we up the attenEnd quite a bit
        this.attenEnd *= 3;
        const lanternColorMul = param.get(i, `colA`) / 100;
        this.color.r = (param.get(i, `colR`) / 255) * lanternColorMul;
        this.color.g = (param.get(i, `colG`) / 255) * lanternColorMul;
        this.color.b = (param.get(i, `colB`) / 255) * lanternColorMul;
    }
}

class PointLight {
    public position = vec3.create();
    public params: PointLightParams | null = null;

    public fill(d: Float32Array, offs: number): number {
        const params = assertExists(this.params);
        const baseOffs = offs;
        offs += fillVec3v(d, offs, this.position, params.attenStart);
        offs += fillColor(d, offs, params.color, params.attenEnd);
        return offs - baseOffs;
    }
}

class ToneCorrectParams {
    public name: string = '';
    public brightness = vec3.create();
    public contrast = vec3.create();
    public saturation = 1.0;
    public hue = 0.0;

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.brightness[0] = param.get(i, 'brightnessR');
        this.brightness[1] = param.get(i, 'brightnessG');
        this.brightness[2] = param.get(i, 'brightnessB');
        this.saturation = param.get(i, 'saturation');
        this.contrast[0] = param.get(i, 'contrastR');
        this.contrast[1] = param.get(i, 'contrastG');
        this.contrast[2] = param.get(i, 'contrastB');
        this.hue = param.get(i, 'hue');
    }

    public fill(d: Float32Array, offs: number): number {
        const adjustMat = mat4.fromValues(
            this.brightness[0] * this.contrast[0], 0.0, 0.0, 0.0,
            0.0, this.brightness[1] * this.contrast[1], 0.0, 0.0,
            0.0, 0.0, this.brightness[2] * this.contrast[2], 0.0,
            0.5 - 0.5 * this.contrast[0], 0.5 - 0.5 * this.contrast[1], 0.5 - 0.5 * this.contrast[2], 1.0,
        );

        const sat0 = 1.0 - this.saturation;
        const linearR = 0.3086 * sat0, linearG = 0.6094 * sat0, linearB = 0.0820 * sat0;
        const saturation = mat4.fromValues(
            linearR + this.saturation, linearR, linearR, 0.0,
            linearG, linearG + this.saturation, linearG, 0.0,
            linearB, linearB, linearB + this.saturation, 0.0,
            0.0, 0.0, 0.0, 1.0,
        );

        const hue = mat4.create();
        mat4.fromRotation(hue, this.hue * MathConstants.DEG_TO_RAD, Vec3One);

        mat4.mul(adjustMat, saturation, adjustMat);
        mat4.mul(adjustMat, hue, adjustMat);
        return fillMatrix4x3(d, offs, adjustMat);
    }
}

class FogParams {
    public name: string = '';
    public fogBeginZ = 0;
    public fogEndZ = 0;
    public color = colorNewCopy(White);

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.fogBeginZ = param.get(i, `fogBeginZ`);
        this.fogEndZ = param.get(i, `fogEndZ`);
        const fogColorMul = param.get(i, `colA`) / 100;
        this.color.r = (param.get(i, `colR`) / 255) * fogColorMul;
        this.color.g = (param.get(i, `colG`) / 255) * fogColorMul;
        this.color.b = (param.get(i, `colB`) / 255) * fogColorMul;
        this.color.a = saturate(param.get(i, `degRotW`) / 100);
    }
}

class LightParams {
    public name: string = '';
    public envDifColor = colorNewCopy(White);
    public envSpcColor = colorNewCopy(White);
    public envDifTextureNo = 0;
    public envSpcTextureNo = [0, 0, 0, 0];

    public dirLight = nArray(3, () => new DirectionalLight());
    public hemisphereLight = new HemisphereLight();

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.envDifTextureNo = param.get(i, `envDif`);
        const envDifColorMul = param.get(i, 'envDif_colA') / 100;
        this.envDifColor.r = (param.get(i, 'envDif_colR') / 255) * envDifColorMul;
        this.envDifColor.g = (param.get(i, 'envDif_colG') / 255) * envDifColorMul;
        this.envDifColor.b = (param.get(i, 'envDif_colB') / 255) * envDifColorMul;

        this.envSpcTextureNo[0] = param.get(i, `envSpc_0`);
        this.envSpcTextureNo[1] = param.get(i, `envSpc_1`);
        this.envSpcTextureNo[2] = param.get(i, `envSpc_2`);
        this.envSpcTextureNo[3] = param.get(i, `envSpc_3`);

        const envSpcColorMul = param.get(i, 'envSpc_colA') / 100;
        this.envSpcColor.r = (param.get(i, 'envSpc_colR') / 255) * envSpcColorMul;
        this.envSpcColor.g = (param.get(i, 'envSpc_colG') / 255) * envSpcColorMul;
        this.envSpcColor.b = (param.get(i, 'envSpc_colB') / 255) * envSpcColorMul;

        for (let i = 0; i < 3; i++) {
            const dstDirLight = this.dirLight[i];
            const rotX = param.get(i, `degRotX_${i}`) / 255;
            const rotY = param.get(i, `degRotY_${i}`) / 255;
            calcDirFromRotXY(dstDirLight.dir, rotX, rotY);

            const colorMul = param.get(i, `colA_${i}`) / 100;
            dstDirLight.color.r = (param.get(i, `colR_${i}`) / 255) * colorMul;
            dstDirLight.color.g = (param.get(i, `colG_${i}`) / 255) * colorMul;
            dstDirLight.color.b = (param.get(i, `colB_${i}`) / 255) * colorMul;
        }

        const dstHemi = this.hemisphereLight;
        const colorUMul = param.get(i, 'colA_u') / 100;
        dstHemi.colorU.r = (param.get(i, 'colR_u') / 255) * colorUMul;
        dstHemi.colorU.g = (param.get(i, 'colG_u') / 255) * colorUMul;
        dstHemi.colorU.b = (param.get(i, 'colB_u') / 255) * colorUMul;
        const colorDMul = param.get(i, 'colA_d') / 100;
        dstHemi.colorD.r = (param.get(i, 'colR_d') / 255) * colorDMul;
        dstHemi.colorD.g = (param.get(i, 'colG_d') / 255) * colorDMul;
        dstHemi.colorD.b = (param.get(i, 'colB_d') / 255) * colorDMul;
    }
}

class LightScatteringParams {
    public name: string = '';

    @dfShow()
    @dfRange(0, 1)
    public betaRay = 0;
    @dfShow()
    @dfRange(0, 1)
    public betaMie = 0;
    @dfShow()
    @dfRange(-1, 1, 0.01)
    public HGg = 0;
    @dfShow()
    @dfRange(0, 10.0, 0.01)
    public distanceMul = 0;
    @dfShow()
    @dfRange(0, 1)
    public blendCoeff = 0;
    @dfShow()
    @dfRange(-90, 90)
    public sunRotX = 0;
    @dfShow()
    @dfRange(-180, 180)
    public sunRotY = 0;
    @dfShow()
    @dfRange(0, 5)
    public sunColor = colorNewCopy(White);
    @dfShow()
    public groundReflectance = colorNewCopy(White);

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.sunRotX = param.get(i, `sunRotX`);
        this.sunRotY = param.get(i, `sunRotY`);
        this.distanceMul = param.get(i, `distanceMul`) / 100;
        const sunColorMul = param.get(i, `sunA`) / 100;
        this.sunColor.r = (param.get(i, `sunR`) / 255) * sunColorMul;
        this.sunColor.g = (param.get(i, `sunG`) / 255) * sunColorMul;
        this.sunColor.b = (param.get(i, `sunB`) / 255) * sunColorMul;
        this.HGg = param.get(i, `lsHGg`);
        this.betaRay = param.get(i, `lsBetaRay`);
        this.betaMie = param.get(i, `lsBetaMie`);
        this.blendCoeff = param.get(i, `blendCoef`) / 100;
        const reflectanceMul = param.get(i, `reflectanceA`) / 100;
        this.groundReflectance.r = (param.get(i, `reflectanceR`) / 255) * reflectanceMul;
        this.groundReflectance.g = (param.get(i, `reflectanceG`) / 255) * reflectanceMul;
        this.groundReflectance.b = (param.get(i, `reflectanceB`) / 255) * reflectanceMul;
    }
}

class ToneMapParams {
    public name = '';
    public bloomBegin = 0;
    public bloomMul = 0;
    public bloomBeginFar = 0;
    public bloomMulFar = 0;
    public bloomNearDist = 0;
    public bloomFarDist = 0;
    public grayKeyValue = 0;
    public minAdaptedLum = 0;
    public maxAdaptedLum = 0;
    public adaptSpeed = 0;
    public lightShaftBegin = 0;
    public lightShaftPower = 0;
    public lightShaftAttenRate = 0;

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.bloomBegin = param.get(i, 'bloomBegin') / 255;
        this.bloomMul = param.get(i, 'bloomMul') / 100;
        this.bloomBeginFar = param.get(i, 'bloomBeginFar') / 255;
        this.bloomMulFar = param.get(i, 'bloomMulFar') / 100;
        this.bloomNearDist = param.get(i, 'bloomNearDist');
        this.bloomFarDist = param.get(i, 'bloomFarDist');
        this.grayKeyValue = param.get(i, 'grayKeyValue');
        this.minAdaptedLum = param.get(i, 'minAdaptedLum');
        this.maxAdaptedLum = param.get(i, 'maxAdapredLum');
        this.adaptSpeed = param.get(i, 'adaptSpeed');
        this.lightShaftBegin = param.get(i, 'lightShaftBegin');
        this.lightShaftPower = param.get(i, 'lightShaftPower');
        this.lightShaftAttenRate = param.get(i, 'lightShaftAttenRate');
    }
}

class DofParams {
    public name = '';
    public farDofBegin = 0;
    public farDofEnd = 0;
    public farDofMul = 0;
    public nearDofBegin = 0;
    public nearDofEnd = 0;
    public nearDofMul = 0;
    public dispersionSq = 0;

    public parse(param: ParamFile, i: number): void {
        this.name = param.getName(i);

        this.farDofBegin = param.get(i, 'farDofBegin');
        this.farDofEnd = param.get(i, 'farDofEnd');
        this.farDofMul = param.get(i, 'farDofMul') / 100;
        this.nearDofBegin = param.get(i, 'nearDofBegin');
        this.nearDofEnd = param.get(i, 'nearDofEnd');
        this.nearDofMul = param.get(i, 'nearDofMul') / 100;
        this.dispersionSq = param.get(i, 'dispersionSq');
    }
}

interface Parse {
    parse(param: ParamFile, i: number): void;
}

export class DrawParamBank {
    public fogBank: FogParams[];
    public lightBank: LightParams[];
    public lightScatteringBank: LightScatteringParams[];
    public pointLightBank: PointLightParams[];
    public toneCorrectBank: ToneCorrectParams[];
    public toneMapBank: ToneMapParams[];
    public dofBank: DofParams[];

    constructor(resourceSystem: ResourceSystem, areaID: string, bankID: number = 0) {
        const aid = `a${areaID.slice(1, 3)}`;
        const paramdefbnd = BND3.parse(resourceSystem.lookupFile(`paramdef/paramdef.paramdefbnd`)!);
        const drawparambnd = BND3.parse(resourceSystem.lookupFile(`param/DrawParam/${aid}_DrawParam.parambnd`)!);

        let mid = areaID.slice(0, 3);
        if (bankID !== 0)
            mid += `_${bankID}`;

        function createParamFile(name: string): ParamFile {
            const paramdef = parseParamDef(assertExists(paramdefbnd.files.find((file) => file.name.endsWith(`${name}.paramdef`))).data);
            return new ParamFile(assertExists(drawparambnd.files.find((file) => file.name.endsWith(`${mid}_${name}.param`))).data, paramdef);
        }

        this.fogBank = this.createBank(FogParams, createParamFile(`FogBank`));
        this.lightBank = this.createBank(LightParams, createParamFile(`LightBank`));
        this.lightScatteringBank = this.createBank(LightScatteringParams, createParamFile(`LightScatteringBank`));
        this.pointLightBank = this.createBank(PointLightParams, createParamFile(`PointLightBank`));
        this.toneCorrectBank = this.createBank(ToneCorrectParams, createParamFile(`ToneCorrectBank`));
        this.toneMapBank = this.createBank(ToneMapParams, createParamFile(`ToneMapBank`));
        this.dofBank = this.createBank(DofParams, createParamFile(`DofBank`));
    }

    private createBank<T extends Parse>(constructor: new () => T, param: ParamFile): T[] {
        const L: T[] = nArray(param.getNum(), () => new constructor());
        for (let i = 0; i < param.getNum(); i++)
            L[i].parse(param, i);
        return L;
    }

    public static fetchResources(resourceSystem: ResourceSystem, areaID: string): void {
        const aid = `a${areaID.slice(1, 3)}`;
        resourceSystem.fetchLoose(`paramdef/paramdef.paramdefbnd`);
        resourceSystem.fetchLoose(`param/DrawParam/${aid}_DrawParam.parambnd`);
    }
}

class MaterialDrawConfig {
    public areaID: string;
    public fogParams: FogParams;
    public lightParams: LightParams;
    public lightScatteringParams: LightScatteringParams;
    public pointLight = nArray(1, () => new PointLight());
}

class SceneDrawConfig {
    public dofParams: DofParams;
    public toneCorrectParams: ToneCorrectParams;
    public toneMapParams: ToneMapParams;
}

function calcDirFromRotXY(dst: vec3, rotX: number, rotY: number): void {
    const sinX = Math.sin(rotX * MathConstants.DEG_TO_RAD), cosX = Math.cos(rotX * MathConstants.DEG_TO_RAD);
    const sinY = Math.sin(rotY * MathConstants.DEG_TO_RAD), cosY = Math.cos(rotY * MathConstants.DEG_TO_RAD);
    vec3.set(dst, sinY * cosX, -sinX, cosY * cosX);
}

function drawParamBankCalcMaterialDrawConfig(dst: MaterialDrawConfig, part: Part, bank: DrawParamBank): void {
    dst.areaID = part.areaID;
    dst.fogParams = assertExists(bank.fogBank[Math.max(part.fogID, 0)]);
    dst.lightParams = assertExists(bank.lightBank[Math.max(part.lightID, 0)]);
    dst.lightScatteringParams = assertExists(bank.lightScatteringBank[Math.max(part.scatterID, 0)]);
    // This should be from the map collision
    dst.pointLight[0].params = assertExists(bank.pointLightBank[Math.max(part.lanternID, 0)]);
}

const bboxScratch = new AABB();
export class PartInstance {
    private batchInstances: BatchInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;
    public materialDrawConfig = new MaterialDrawConfig();

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: DDSTextureHolder, materialDataHolder: MaterialDataHolder, drawParamBank: DrawParamBank, public flverData: FLVERData, public part: Part) {
        drawParamBankCalcMaterialDrawConfig(this.materialDrawConfig, this.part, drawParamBank);

        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batchData = this.flverData.batchData[i];
            const batch = batchData.batch;
            const material = this.flverData.flver.materials[batch.materialIndex];

            const mtdFilePath = material.mtdName;
            const mtdName = mtdFilePath.split('\\').pop()!;
            const mtd = materialDataHolder.getMaterial(mtdName);

            this.batchInstances.push(new BatchInstance(device, cache, flverData, batchData, textureHolder, material, mtd));
        }
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, view: CameraView, textureHolder: DDSTextureHolder ): void {
        if (!this.visible)
            return;

        bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
        if (!view.frustum.contains(bboxScratch))
            return;

        getMatrixTranslation(scratchVec3a, view.worldFromViewMatrix);
        getMatrixAxisZ(scratchVec3b, view.worldFromViewMatrix);
        vec3.scaleAndAdd(this.materialDrawConfig.pointLight[0].position, scratchVec3a, scratchVec3b, -2);

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(renderInstManager, viewerInput, view, this.modelMatrix, this.materialDrawConfig, textureHolder);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 10, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.Cube, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.Cube, formatKind: GfxSamplerFormatKind.Float, },
    ] },
];

function modelMatrixFromPart(m: mat4, part: Part): void {
    mat4.translate(m, m, part.translation);
    mat4.rotateX(m, m, part.rotation[0] * MathConstants.DEG_TO_RAD);
    mat4.rotateY(m, m, part.rotation[1] * MathConstants.DEG_TO_RAD);
    mat4.rotateZ(m, m, part.rotation[2] * MathConstants.DEG_TO_RAD);
    mat4.scale(m, m, part.scale);
}

const noclipSpaceFromDarkSoulsSpace = mat4.fromValues(
    -1, 0, 0, 0,
    0,  1, 0, 0,
    0,  0, 1, 0,
    0,  0, 0, 1,
);

class CameraView {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    public clipSpaceNearZ: GfxClipSpaceNearZ;

    // The current camera position, in Dark Souls engine world space.
    public cameraPos = vec3.create();

    // Frustum is stored in Dark Souls world space.
    public frustum = new Frustum();

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
        this.frustum.newFrame();
    }

    public setupFromCamera(camera: Camera): void {
        this.clipSpaceNearZ = camera.clipSpaceNearZ;
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromDarkSoulsSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }
}

export class MSBRenderer {
    public flverInstances: PartInstance[] = [];
    public sceneDrawConfig = new SceneDrawConfig();

    constructor(device: GfxDevice, cache: GfxRenderCache, private textureHolder: DDSTextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private drawParamBank: DrawParamBank, private msb: MSB) {
        let sceneDrawConfigSetup = false;

        for (let i = 0; i < msb.parts.length; i++) {
            const part = msb.parts[i];
            if (part.type === 0) {
                const flverData = this.modelHolder.flverData[part.modelIndex];
                if (flverData === undefined)
                    continue;

                const instance = new PartInstance(device, cache, this.textureHolder, this.materialDataHolder, this.drawParamBank, flverData, part);
                instance.visible = !isLODModel(part.name);
                instance.name = part.name;
                modelMatrixFromPart(instance.modelMatrix, part);
                this.flverInstances.push(instance);
            } else if (part.type === 5) {
                // Just take the first part we find.
                if (!sceneDrawConfigSetup) {
                    // Game takes settings for DoF, Tonemap, ToneCorrect, and LensFlare from collision part
                    this.parseSceneDrawConfig(part);
                    sceneDrawConfigSetup = true;
                }
            }
        }
    }

    private parseSceneDrawConfig(part: Part): void {
        this.sceneDrawConfig.dofParams = this.drawParamBank.dofBank[part.dofID];
        this.sceneDrawConfig.toneCorrectParams = this.drawParamBank.toneCorrectBank[part.toneCorrectID];
        this.sceneDrawConfig.toneMapParams = this.drawParamBank.toneMapBank[part.dofID];
    }

    private lodModels: string[] = [];
    public chooseLODModel(): void {
        interactiveVizSliderSelect(this.flverInstances, 'visible', (instance) => {
            this.lodModels.push(instance.name);
            setTimeout(() => { instance.visible = false; }, 2000);
            this.chooseLODModel();
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, cameraView: CameraView, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(DKSProgram.ub_SceneParams, 16+4);
        const d = template.mapUniformBufferF32(DKSProgram.ub_SceneParams);

        offs += fillMatrix4x4(d, offs, cameraView.clipFromWorldMatrix);
        getMatrixTranslation(scratchVec3a, cameraView.worldFromViewMatrix);
        offs += fillVec3v(d, offs, scratchVec3a);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(renderInstManager, viewerInput, cameraView, this.textureHolder);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.modelHolder.destroy(device);
    }
}

class FullscreenBlitProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

class DepthOfFieldBlurProgram extends DeviceProgram {
    constructor(vertical: boolean) {
        super();
        if (vertical)
            this.setDefineBool('BLUR_Y', true);
        else
            this.setDefineBool('BLUR_X', true);
    }

    public static Common = `
uniform sampler2D u_TextureColor;

layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_DispersionSq      (u_Misc[0].x)
`;

    public override vert = `
${DepthOfFieldBlurProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${DepthOfFieldBlurProgram.Common}

in vec2 v_TexCoord;

vec2 CalcOffsWeight(int i) {
    float t_Offset = 1.0 + 2.0 * float(i);
    float t_Weight = exp(-0.5 * pow(t_Offset, 2.0) / pow(u_DispersionSq, 2.0));
    return vec2(t_Offset, t_Weight);
}

void main() {
    vec2 t_Size = vec2(textureSize(TEXTURE(u_TextureColor), 0));

    if (u_DispersionSq < 0.1) {
        gl_FragColor = texture(SAMPLER_2D(u_TextureColor), v_TexCoord);
        return;
    }

    // This could probably be done with erf, but done here for simplicity for now...
    float t_TotalWeight = 0.0;
    int t_NumSamples = 8;
    for (int i = 0; i < t_NumSamples; i++)
        t_TotalWeight += CalcOffsWeight(i).y * 2.0;

    vec4 t_Dst = vec4(0.0);
    for (int i = 0; i < t_NumSamples; i++) {
        vec2 t_OffsWeight = CalcOffsWeight(i);
        float t_Offs = t_OffsWeight.x;
        float t_Weight = t_OffsWeight.y / t_TotalWeight;

        vec2 t_PixelOffs = vec2(0.0, 0.0);
#if defined BLUR_X
        t_PixelOffs.x = t_Offs;
#endif
#if defined BLUR_Y
        t_PixelOffs.y = t_Offs;
#endif

        vec4 t_Pixel0 = texture(SAMPLER_2D(u_TextureColor), v_TexCoord + t_PixelOffs / t_Size);
        vec4 t_Pixel1 = texture(SAMPLER_2D(u_TextureColor), v_TexCoord - t_PixelOffs / t_Size);

        t_Dst += t_Pixel0 * t_Weight;
        t_Dst += t_Pixel1 * t_Weight;
    }

    gl_FragColor = t_Dst;
}
`;
}

class DepthOfFieldCombineProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;
uniform sampler2D u_TextureFramebufferDepth;

layout(std140) uniform ub_Params {
    vec4 u_Misc[3];
};
#define u_NearParam            (u_Misc[1].xyz)
#define u_FarParam             (u_Misc[2].xyz)
#define u_UnprojectParams      vec4(u_Misc[0].zw, u_Misc[1].w, u_Misc[2].w)
`;

    public override vert = `
${DepthOfFieldCombineProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${DepthOfFieldCombineProgram.Common}
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

in vec2 v_TexCoord;

float UnprojectViewSpaceDepth(float t_DepthSample) {
    float Viewport_Z = t_DepthSample;
    float NDC_Z = Viewport_Z * 2.0 - 1.0; // Expand from 0..1 to -1..1

    // To get the view-space depth from NDC depth, we calculate the inverse of the bottom-right quadrant
    // of the projection matrix, and apply it here.
    float UnprojMtxZZ = u_UnprojectParams[0];
    float UnprojMtxZW = u_UnprojectParams[1];
    float UnprojMtxWZ = u_UnprojectParams[2];
    float UnprojMtxWW = u_UnprojectParams[3];

    float ViewSpaceZ = (NDC_Z*UnprojMtxZZ + UnprojMtxZW) / (NDC_Z*UnprojMtxWZ + UnprojMtxWW);
    return -ViewSpaceZ;
}

float GetBlurParam(float t_ViewZ, vec3 t_Param) {
    return saturate(invlerp(t_Param.x, t_Param.y, t_ViewZ)) * t_Param.z;
}

void main() {
    float t_DepthSample = texture(SAMPLER_2D(u_TextureFramebufferDepth), v_TexCoord).r;
    vec4 t_BlurColor = texture(SAMPLER_2D(u_TextureColor), v_TexCoord);
    float t_ViewZ = UnprojectViewSpaceDepth(t_DepthSample);
    float t_BlurStrength = 0.0f;
    t_BlurStrength += GetBlurParam(t_ViewZ, u_NearParam);
    t_BlurStrength += GetBlurParam(t_ViewZ, u_FarParam);
    t_BlurColor.a = saturate(t_BlurStrength);
    gl_FragColor.rgba = t_BlurColor;
}
`;
}

const postBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 2, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Depth, },
    ] },
];

class DepthOfField {
    private blitProgram: GfxProgram;
    private blurHProgram: GfxProgram;
    private blurVProgram: GfxProgram;
    private combineProgram: GfxProgram;
    private textureMapping = nArray(2, () => new TextureMapping());

    private combineMegaState: GfxMegaStateDescriptor = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
    }), fullscreenMegaState);

    constructor(cache: GfxRenderCache) {
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        const nearestSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[1].gfxSampler = nearestSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
        this.blurHProgram = cache.createProgram(new DepthOfFieldBlurProgram(false));
        this.blurVProgram = cache.createProgram(new DepthOfFieldBlurProgram(true));
        this.combineProgram = cache.createProgram(new DepthOfFieldCombineProgram());
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst, params: DofParams, cameraView: CameraView) {
        let offs = renderInst.allocateUniformBuffer(0, 12);
        const d = renderInst.mapUniformBufferF32(0);

        // Take the bottom-right quadrant of the projection matrix, and calculate the inverse.
        const ZZ = cameraView.clipFromViewMatrix[10];
        const ZW = cameraView.clipFromViewMatrix[14];
        const WZ = cameraView.clipFromViewMatrix[11];
        const WW = cameraView.clipFromViewMatrix[15];
        const invdet = 1 / (ZZ*WW - ZW*WZ);
        const UnprojMtxZZ = invdet * WW;
        const UnprojMtxZW = invdet * -ZW;
        const UnprojMtxWZ = invdet * -WZ;
        const UnprojMtxWW = invdet * ZZ;

        offs += fillVec4(d, offs, params.dispersionSq, 0.0, UnprojMtxZZ, UnprojMtxZW);
        offs += fillVec4(d, offs, params.nearDofBegin, params.nearDofEnd, params.nearDofMul, UnprojMtxWZ);
        offs += fillVec4(d, offs, params.farDofBegin, params.farDofEnd, params.farDofMul, UnprojMtxWW);
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, srcColorTargetID: GfxrRenderTargetID, srcDepthTargetID: GfxrRenderTargetID, params: DofParams, cameraView: CameraView): void {
        const srcColorDesc = builder.getRenderTargetDescription(srcColorTargetID);

        const target2Desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        target2Desc.setDimensions(srcColorDesc.width >>> 1, srcColorDesc.height >>> 1, 1);

        const target2ID = builder.createRenderTargetID(target2Desc, 'Depth of Field 1/2');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(postBindingLayouts);
        this.allocateParameterBuffer(renderInst, params, cameraView);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Depth of Field Downsample');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target2ID);

            const srcResolveTextureID = builder.resolveRenderTarget(srcColorTargetID);
            pass.attachResolveTexture(srcResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(srcResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target2ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Depth of Field Blur H');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target2ID);

            const halfResolveTextureID = builder.resolveRenderTarget(target2ID);
            pass.attachResolveTexture(halfResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blurHProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(halfResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target2ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Depth of Field Blur V');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target2ID);

            const halfResolveTextureID = builder.resolveRenderTarget(target2ID);
            pass.attachResolveTexture(halfResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blurVProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(halfResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target2ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Depth of Field Combine');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, srcColorTargetID);

            const halfResolveTextureID = builder.resolveRenderTarget(target2ID);
            pass.attachResolveTexture(halfResolveTextureID);
            const mainDepthResolveTextureID = builder.resolveRenderTarget(srcDepthTargetID);
            pass.attachResolveTexture(mainDepthResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.combineProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(halfResolveTextureID);
                this.textureMapping[1].gfxTexture = scope.getResolveTextureForID(mainDepthResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

class BloomFilterProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;
uniform sampler2D u_TextureFramebufferDepth;

layout(std140) uniform ub_Params {
    vec4 u_Misc[3];
};
#define u_NearParam            (u_Misc[0].xyz)
#define u_FarParam             (u_Misc[1].xyz)
#define u_UnprojectParams      (u_Misc[2].xyzw)
`;

    public override vert = `
${BloomFilterProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${BloomFilterProgram.Common}
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

in vec2 v_TexCoord;

float UnprojectViewSpaceDepth(float t_DepthSample) {
    float Viewport_Z = t_DepthSample;
    float NDC_Z = Viewport_Z * 2.0 - 1.0; // Expand from 0..1 to -1..1

    // To get the view-space depth from NDC depth, we calculate the inverse of the bottom-right quadrant
    // of the projection matrix, and apply it here.
    float UnprojMtxZZ = u_UnprojectParams[0];
    float UnprojMtxZW = u_UnprojectParams[1];
    float UnprojMtxWZ = u_UnprojectParams[2];
    float UnprojMtxWW = u_UnprojectParams[3];

    float ViewSpaceZ = (NDC_Z*UnprojMtxZZ + UnprojMtxZW) / (NDC_Z*UnprojMtxWZ + UnprojMtxWW);
    return -ViewSpaceZ;
}

void main() {
    float t_DepthSample = texture(SAMPLER_2D(u_TextureFramebufferDepth), v_TexCoord).r;
    float t_ViewZ = UnprojectViewSpaceDepth(t_DepthSample);

    vec4 t_Color = texture(SAMPLER_2D(u_TextureColor), v_TexCoord);

    float t_NearFar = saturate(invlerp(u_NearParam.z, u_FarParam.z, t_ViewZ));
    float t_Thresh = mix(u_NearParam.x, u_FarParam.x, t_NearFar);
    t_Color.rgb = saturate(t_Color.rgb - vec3(t_Thresh)) / vec3(1.0 - t_Thresh);

    gl_FragColor.rgba = vec4(t_Color.rgb, t_NearFar);
}
`;
}

class BloomBlur1Program extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;
`;

    public override vert = `
${BloomBlur1Program.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${BloomBlur1Program.Common}
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

in vec2 v_TexCoord;

void main() {
    // Bloom Blur 1 ("Gauss5x5") appears to use a 13-tap 5x5 filter.
    //
    // ..x..
    // .xxx.
    // xxxxx
    // .xxx.
    // ..x..
    //
    vec4 t_Color = vec4(0.0);

#if 0
    float t_TotalWeightInv = ${1.0 / Math.sqrt(MathConstants.TAU)};
    float t_Weight0 = exp(-0.5 * 0.0) * t_TotalWeightInv;
    float t_Weight1 = exp(-0.5 * 1.0) * t_TotalWeightInv * 0.25;
    float t_Weight2 = exp(-0.5 * 2.0) * t_TotalWeightInv * 0.25;
    float t_Weight3 = exp(-0.5 * 4.0) * t_TotalWeightInv * 0.25;
#else
    float t_Weight0 = 0.3989422804014327;
    float t_Weight1 = 0.06049268112978584;
    float t_Weight2 = 0.03669066579343498;
    float t_Weight3 = 0.013497741628297016;
#endif

    // Ring 0 (center)
    t_Color += texture(SAMPLER_2D(u_TextureColor), v_TexCoord) * t_Weight0;

    // Ring 1 (distance 1)
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1,  0)) * t_Weight1;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0, -1)) * t_Weight1;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 1,  0)) * t_Weight1;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0,  1)) * t_Weight1;

    // Ring 1 (distance sqrt2)
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1, -1)) * t_Weight2;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 1, -1)) * t_Weight2;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 1,  1)) * t_Weight2;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1,  1)) * t_Weight2;

    // Ring 2 (distance 2)
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-2,  0)) * t_Weight3;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0, -2)) * t_Weight3;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 2,  0)) * t_Weight3;
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0,  2)) * t_Weight3;

    gl_FragColor = t_Color;
}
`;
}

class BloomBlur2Program extends DeviceProgram {
    constructor(vertical: boolean) {
        super();
        if (vertical)
            this.setDefineBool('BLUR_Y', true);
        else
            this.setDefineBool('BLUR_X', true);
    }

    public static Common = `
uniform sampler2D u_TextureColor;
`;

    public override vert = `
${BloomBlur2Program.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${BloomBlur2Program.Common}
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

in vec2 v_TexCoord;

void main() {
    // Bloom Blur 2 ("Bloom") appears to use a massive 15-tap per pass.
    // It also seems to use a standard deviation of 3 (hardcoded?)

#if 0
    float t_StdDevSq = pow(3.0, 2.0);
    float t_Inv = 1.0 / sqrt(2.0f * M_PI * t_StdDevSq);
    float t_TotalI = 0.0f;

    for (int i = 0; i < 8; i++) {
        float t_Weight = exp(-0.5 * pow(i, 2.0) / t_StdDevSq) * t_Inv;
        print("float t_Weight", i, " = ", t_Weight);
        t_TotalI += t_Weight;
    }
    print("float t_TotalI = ", t_TotalI);
#else
    const float t_Weight[8] = float[8](
        0.1329807601338109,
        0.12579440923099774,
        0.10648266850745075,
        0.0806569081730478,
        0.05467002489199788,
        0.03315904626424957,
        0.017996988837729353,
        0.008740629697903166
    );
#endif

    vec4 t_Color = vec4(0.0);
    t_Color += t_Weight[0] * texture(SAMPLER_2D(u_TextureColor), v_TexCoord);

#if defined BLUR_X
    t_Color += t_Weight[1] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1, 0));
    t_Color += t_Weight[1] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(1, 0));
    t_Color += t_Weight[2] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-2, 0));
    t_Color += t_Weight[2] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(2, 0));
    t_Color += t_Weight[3] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-3, 0));
    t_Color += t_Weight[3] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(3, 0));
    t_Color += t_Weight[4] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-4, 0));
    t_Color += t_Weight[4] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(4, 0));
    t_Color += t_Weight[5] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-5, 0));
    t_Color += t_Weight[5] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(5, 0));
    t_Color += t_Weight[6] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-6, 0));
    t_Color += t_Weight[6] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(6, 0));
    t_Color += t_Weight[7] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-7, 0));
    t_Color += t_Weight[7] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(7, 0));
#elif defined BLUR_Y
    t_Color += t_Weight[1] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -1));
    t_Color += t_Weight[1] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 1));
    t_Color += t_Weight[2] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -2));
    t_Color += t_Weight[2] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 2));
    t_Color += t_Weight[3] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -3));
    t_Color += t_Weight[3] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 3));
    t_Color += t_Weight[4] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -4));
    t_Color += t_Weight[4] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 4));
    t_Color += t_Weight[5] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -5));
    t_Color += t_Weight[5] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 5));
    t_Color += t_Weight[6] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -6));
    t_Color += t_Weight[6] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 6));
    t_Color += t_Weight[7] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, -7));
    t_Color += t_Weight[7] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(0, 7));
#endif

    gl_FragColor = t_Color;
}
`;
}

class BloomCombineProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;

layout(std140) uniform ub_Params {
    vec4 u_Misc[3];
};
#define u_NearParam            (u_Misc[0].xyz)
#define u_FarParam             (u_Misc[1].xyz)
`;

    public override vert = `
${BloomCombineProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${BloomCombineProgram.Common}
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

in vec2 v_TexCoord;

void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_TextureColor), v_TexCoord);
    float t_Mul = mix(u_NearParam.y, u_FarParam.y, t_Color.a);
    gl_FragColor.rgba = vec4(t_Color.rgb * t_Mul, 1.0);
}
`;
}

class Bloom {
    public blitProgram: GfxProgram;
    private filterProgram: GfxProgram;
    private blur1Program: GfxProgram;
    private blur2HProgram: GfxProgram;
    private blur2VProgram: GfxProgram;
    private combineProgram: GfxProgram;
    private textureMapping = nArray(2, () => new TextureMapping());

    private alphaMegaState = makeMegaState(setAttachmentStateSimple({}, {
        channelWriteMask: GfxChannelWriteMask.AllChannels,
    }), fullscreenMegaState);

    private combineMegaState = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.One,
    }), fullscreenMegaState);

    constructor(cache: GfxRenderCache) {
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        const nearestSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[1].gfxSampler = nearestSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
        this.filterProgram = cache.createProgram(new BloomFilterProgram());
        this.blur1Program = cache.createProgram(new BloomBlur1Program());
        this.blur2HProgram = cache.createProgram(new BloomBlur2Program(false));
        this.blur2VProgram = cache.createProgram(new BloomBlur2Program(true));
        this.combineProgram = cache.createProgram(new BloomCombineProgram());
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst, params: ToneMapParams, cameraView: CameraView) {
        let offs = renderInst.allocateUniformBuffer(0, 12);
        const d = renderInst.mapUniformBufferF32(0);

        // Take the bottom-right quadrant of the projection matrix, and calculate the inverse.
        const ZZ = cameraView.clipFromViewMatrix[10];
        const ZW = cameraView.clipFromViewMatrix[14];
        const WZ = cameraView.clipFromViewMatrix[11];
        const WW = cameraView.clipFromViewMatrix[15];
        const invdet = 1 / (ZZ*WW - ZW*WZ);
        const UnprojMtxZZ = invdet * WW;
        const UnprojMtxZW = invdet * -ZW;
        const UnprojMtxWZ = invdet * -WZ;
        const UnprojMtxWW = invdet * ZZ;

        offs += fillVec4(d, offs, params.bloomBegin, params.bloomMul, params.bloomNearDist, 0.0);
        offs += fillVec4(d, offs, params.bloomBeginFar, params.bloomMulFar, params.bloomFarDist, 0.0);
        offs += fillVec4(d, offs, UnprojMtxZZ, UnprojMtxZW, UnprojMtxWZ, UnprojMtxWW);
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, srcColorTargetID: GfxrRenderTargetID, srcDepthTargetID: GfxrRenderTargetID, params: ToneMapParams, cameraView: CameraView): void {
        const srcColorDesc = builder.getRenderTargetDescription(srcColorTargetID);

        const target4Desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        target4Desc.setDimensions(srcColorDesc.width >>> 2, srcColorDesc.height >>> 2, 1);

        const target8Desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        target8Desc.setDimensions(target4Desc.width >>> 1, target4Desc.height >>> 1, 1);

        const target4ID = builder.createRenderTargetID(target4Desc, 'Bloom 1/4');
        const target8ID = builder.createRenderTargetID(target8Desc, 'Bloom 1/8');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(postBindingLayouts);
        this.allocateParameterBuffer(renderInst, params, cameraView);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target4ID);

            const srcResolveTextureID = builder.resolveRenderTarget(srcColorTargetID);
            pass.attachResolveTexture(srcResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(srcResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target4ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Filter');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target4ID);

            const target4ResolveTextureID = builder.resolveRenderTarget(target4ID);
            pass.attachResolveTexture(target4ResolveTextureID);
            const mainDepthResolveTextureID = builder.resolveRenderTarget(srcDepthTargetID);
            pass.attachResolveTexture(mainDepthResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.filterProgram);
                renderInst.setMegaStateFlags(this.alphaMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target4ResolveTextureID);
                this.textureMapping[1].gfxTexture = scope.getResolveTextureForID(mainDepthResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target4ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 1 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target4ID);

            const target4ResolveTextureID = builder.resolveRenderTarget(target4ID);
            pass.attachResolveTexture(target4ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur1Program);
                renderInst.setMegaStateFlags(this.alphaMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target4ResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target4ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/8');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target8ID);

            const target4ResolveTextureID = builder.resolveRenderTarget(target4ID);
            pass.attachResolveTexture(target4ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(this.alphaMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target4ResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target8ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 1 1/8');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target8ID);

            const target8ResolveTextureID = builder.resolveRenderTarget(target8ID);
            pass.attachResolveTexture(target8ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur1Program);
                renderInst.setMegaStateFlags(this.alphaMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target8ResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target8ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 2 H');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target8ID);

            const target8ResolveTextureID = builder.resolveRenderTarget(target8ID);
            pass.attachResolveTexture(target8ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur2HProgram);
                renderInst.setMegaStateFlags(this.alphaMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target8ResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target8ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 2 V');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, target8ID);

            const target8ResolveTextureID = builder.resolveRenderTarget(target8ID);
            pass.attachResolveTexture(target8ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur2VProgram);
                renderInst.setMegaStateFlags(this.alphaMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target8ResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(target8ID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Combine');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, srcColorTargetID);

            const target8ResolveTextureID = builder.resolveRenderTarget(target8ID);
            pass.attachResolveTexture(target8ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.combineProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(target8ResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

class ToneCorrectProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;

layout(std140) uniform ub_Params {
    Mat4x3 u_ToneCorrectMatrix;
};
`;

    public override vert = `
${ToneCorrectProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${ToneCorrectProgram.Common}

in vec2 v_TexCoord;

void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_TextureColor), v_TexCoord);

    // TODO(jstpierre): auto-exposure measurement
    float t_Exposure = 5.0;
    t_Color.rgb *= t_Exposure;
    t_Color.rgb /= (t_Color.rgb + vec3(1.0));

    t_Color.rgb = Mul(_Mat4x4(u_ToneCorrectMatrix), vec4(t_Color.rgb, 1.0)).rgb;
    gl_FragColor = t_Color;
}
`;
}

class ToneCorrect {
    private toneCorrectProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());

    constructor(cache: GfxRenderCache) {
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.toneCorrectProgram = cache.createProgram(new ToneCorrectProgram());
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst, params: ToneCorrectParams) {
        let offs = renderInst.allocateUniformBuffer(0, 12);
        const d = renderInst.mapUniformBufferF32(0);

        offs += params.fill(d, offs);
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, srcColorTargetID: GfxrRenderTargetID, dstColorTargetID: GfxrRenderTargetID, params: ToneCorrectParams): void {
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(postBindingLayouts);
        this.allocateParameterBuffer(renderInst, params);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Tone Correct');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, dstColorTargetID);

            const srcResolveTextureID = builder.resolveRenderTarget(srcColorTargetID);
            pass.attachResolveTexture(srcResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.toneCorrectProgram);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(srcResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

export class DarkSoulsRenderer implements Viewer.SceneGfx {
    public msbRenderers: MSBRenderer[] = [];
    private renderHelper: GfxRenderHelper;
    private depthOfField: DepthOfField;
    private bloom: Bloom;
    private toneCorrect: ToneCorrect;
    private cameraView = new CameraView();

    constructor(sceneContext: SceneContext, public textureHolder: DDSTextureHolder) {
        this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);

        const cache = this.renderHelper.renderCache;
        this.depthOfField = new DepthOfField(cache);
        this.bloom = new Bloom(cache);
        this.toneCorrect = new ToneCorrect(cache);
    }

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderCache;
    }

    public createPanels(): Panel[] {
        const layerPanel = new LayerPanel(this.msbRenderers[0].flverInstances);
        return [layerPanel];
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1/100);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.cameraView.setupFromCamera(viewerInput.camera);

        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        for (let i = 0; i < this.msbRenderers.length; i++)
            this.msbRenderers[i].prepareToRender(renderInstManager, this.cameraView, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(0.1);

        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        mainColorDesc.colorClearColor = standardFullClearRenderPassDescriptor.colorClearColor;
        setBackbufferDescSimple(mainColorDesc, viewerInput);

        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.renderHelper.pushTemplateRenderInst();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });

        const sceneDrawConfig = this.msbRenderers[0].sceneDrawConfig;
        this.depthOfField.pushPasses(builder, renderInstManager, mainColorTargetID, mainDepthTargetID, sceneDrawConfig.dofParams, this.cameraView);
        this.bloom.pushPasses(builder, renderInstManager, mainColorTargetID, mainDepthTargetID, sceneDrawConfig.toneMapParams, this.cameraView);

        const mainColorGammaDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
        mainColorGammaDesc.copyDimensions(mainColorDesc);
        const mainColorGammaTargetID = builder.createRenderTargetID(mainColorGammaDesc, 'Main Color (Gamma)');
        this.toneCorrect.pushPasses(builder, renderInstManager, mainColorTargetID, mainColorGammaTargetID, sceneDrawConfig.toneCorrectParams);

        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorGammaTargetID, viewerInput.mouseLocation);

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorGammaTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorGammaTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderInstManager.popTemplateRenderInst();

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (let i = 0; i < this.msbRenderers.length; i++)
            this.msbRenderers[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}
