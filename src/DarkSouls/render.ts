
import { ReadonlyMat4, mat4, vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Camera, CameraController, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera.js";
import { Color, Red, TransparentBlack, White, colorCopy, colorFromRGBA, colorNewCopy } from "../Color.js";
import { dfRange, dfShow } from "../DebugFloaters.js";
import { interactiveVizSliderSelect } from '../DebugJunk.js';
import { AABB, Frustum } from "../Geometry.js";
import { MathConstants, Vec3One, getMatrixAxisZ, getMatrixTranslation, saturate } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { SceneContext } from "../SceneBase.js";
import { TextureMapping } from "../TextureHolder.js";
import { GfxCoalescedBuffer, coalesceBuffer } from "../gfx/helpers/BufferHelpers.js";
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { makeBackbufferDescSimple, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxTopology, convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers.js";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxChannelWriteMask, GfxClipSpaceNearZ, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { LayerPanel, Panel } from "../ui.js";
import { assert, assertExists, leftPad, nArray } from "../util.js";
import * as Viewer from "../viewer.js";
import * as BND3 from "./bnd3.js";
import { createTexture, DDS } from "./dds.js";
import { Batch, FLVER, InputLayout, Material, Primitive, VertexAttribute, VertexInputSemantic } from "./flver.js";
import { MSB, Part } from "./msb.js";
import { MTD, MTDTexture } from './mtd.js';
import { ParamFile, parseParamDef } from "./param.js";
import { MaterialDataHolder, ModelHolder, ResourceSystem } from "./scenes.js";
import { TPF } from "./tpf.js";

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
    case VertexInputSemantic.Position:  return MaterialProgram_Base.a_Position;
    case VertexInputSemantic.Color:     return MaterialProgram_Base.a_Color;
    case VertexInputSemantic.UV: {
        if (attr.index === 0)
            return MaterialProgram_Base.a_TexCoord0;
        else if (attr.index === 1)
            return MaterialProgram_Base.a_TexCoord1;
        else
            throw "whoops";
    }
    case VertexInputSemantic.Normal:   return MaterialProgram_Base.a_Normal;
    case VertexInputSemantic.Tangent0: return MaterialProgram_Base.a_Tangent0;
    case VertexInputSemantic.Tangent1: return MaterialProgram_Base.a_Tangent1;
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

class TPFData {
    public gfxTexture: GfxTexture[] = [];

    constructor(device: GfxDevice, private tpf: TPF) {
        for (let i = 0; i < tpf.textures.length; i++)
            this.gfxTexture.push(createTexture(device, tpf.textures[i]));
    }

    public fillTextureMapping(dst: TextureMapping, name: string): boolean {
        const idx = this.tpf.textures.findIndex((dds) => dds.name === name);
        if (idx < 0)
            return false;

        dst.gfxTexture = this.gfxTexture[idx];
        return true;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTexture.length; i++)
            device.destroyTexture(this.gfxTexture[i]);
    }
}

export class TextureHolder {
    public tpf: TPFData[] = [];

    public addTPF(device: GfxDevice, tpf: TPF): void {
        this.tpf.push(new TPFData(device, tpf));
    }

    public fillTextureMapping(dst: TextureMapping, name: string): boolean {
        for (let i = 0; i < this.tpf.length; i++)
            if (this.tpf[i].fillTextureMapping(dst, name))
                return true;
        return false;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.tpf.length; i++)
            this.tpf[i].destroy(device);
    }
}

class BatchData {
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public primitiveIndexCounts: number[] = [];
    public primitiveIndexStarts: number[] = [];

    constructor(cache: GfxRenderCache, flverData: FLVERData, public batch: Batch, zeroBuffer: GfxCoalescedBuffer, vertexBuffer: GfxCoalescedBuffer, indexBuffers: GfxCoalescedBuffer[], triangleIndexCounts: number[]) {
        const flverInputState = flverData.flver.inputStates[batch.inputStateIndex];
        const flverInputLayout = flverData.flver.inputLayouts[flverInputState.inputLayoutIndex];
        this.vertexBufferDescriptors = [vertexBuffer, zeroBuffer];

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        let attribBits = 0;
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

            attribBits |= 1 << location;
        }

        // Go through and fill zeroes with anything we missed.
        for (let i = 0; i <= MaterialProgram_Base.a_AttribMax; i++) {
            if (attribBits & (1 << i))
                continue;

            vertexAttributeDescriptors.push({
                location: i,
                format: GfxFormat.F32_RGBA,
                bufferByteOffset: 0,
                bufferIndex: 1,
            });
        }

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: flverInputState.vertexSize, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 0x00, frequency: GfxVertexBufferFrequency.Constant, },
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
            this.primitiveIndexStarts.push((coaIndexBuffer.byteOffset - (this.indexBufferDescriptor.byteOffset ?? 0)) / 2);
        }
    }
}

export class FLVERData {
    public batchData: BatchData[] = [];
    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    constructor(cache: GfxRenderCache, public flver: FLVER) {
        const vertexBufferDatas: ArrayBufferSlice[] = [];
        const indexBufferDatas: ArrayBufferSlice[] = [];
        vertexBufferDatas.push(new ArrayBufferSlice(new ArrayBuffer(64)));
        for (let i = 0; i < flver.inputStates.length; i++) {
            vertexBufferDatas.push(flver.inputStates[i].vertexData);
            flver.inputStates[i].vertexData = null as unknown as ArrayBufferSlice;
        }
        const vertexBuffers = coalesceBuffer(cache.device, GfxBufferUsage.Vertex, vertexBufferDatas);
        this.vertexBuffer = vertexBuffers[0].buffer;

        const zeroBuffer = vertexBuffers.shift()!;

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
            const batchData = new BatchData(cache, this, batch, zeroBuffer, coaVertexBuffer, indexBuffers, triangleIndexCounts);
            this.batchData.push(batchData);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

enum LightingType {
    Off = -1,
    None = 0,
    HemDirDifSpcx3 = 1,
    HemEnvDifSpc = 3,
}

enum BlendMode {
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

function getMaterialParamF32(mtd: MTD, name: string, index: number = 0): number {
    const param = getMaterialParam(mtd, name);
    if (param !== null)
        return param[index];
    else
        return 0;
}

function getMaterialParamVec2(dst: vec2, mtd: MTD, name: string): boolean {
    const param = getMaterialParam(mtd, name);
    if (param !== null) {
        assert(param.length >= 2);
        vec2.set(dst, param[0], param[1]);
        return true;
    } else {
        vec2.zero(dst);
        return false;
    }
}

function getMaterialParamColor(dst: Color, mtd: MTD, name: string): boolean {
    const param = getMaterialParam(mtd, name);
    if (param !== null) {
        assert(param.length >= 3);
        colorFromRGBA(dst, param[0], param[1], param[2], param.length >= 4 ? param[3] : 1.0);
        return true;
    } else {
        colorCopy(dst, TransparentBlack);
        return false;
    }
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
    assert(lightingType === LightingType.None || lightingType === LightingType.HemDirDifSpcx3 || lightingType === LightingType.HemEnvDifSpc);
    return lightingType;
}

function lookupTextureParameter(material: Material, paramName: string): string | null {
    const param = material.textures.find((param) => param.name === paramName);
    if (param === undefined)
        return null;
    return param.value.split('\\').pop()!.replace(/\.tga|\.psd/, '');
}

function linkTextureParameter(textureMapping: TextureMapping, textureHolder: TextureHolder, material: Material, mtd: MTD, name: string): void {
    const texDef = mtd.textures.find((t) => t.name === name);
    if (texDef === undefined)
        return;

    const textureName = assertExists(lookupTextureParameter(material, name)).toLowerCase();
    textureHolder.fillTextureMapping(textureMapping, textureName);
}

enum LateBindingTexture {
    FramebufferColor = `framebuffer-color`,
    WaterReflection  = `water-reflection`,
    WaterHeight      = `water-height`,
}

class MaterialProgram_Base extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;
    public static a_Normal = 4;
    public static a_Tangent0 = 5;
    public static a_Tangent1 = 6;
    public static a_AttribMax = 6;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public static BindingDefinitions = `
${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld; // DebugMode is in w
};

#define kDebugMode_None     0
#define kDebugMode_Diffuse  1
#define kDebugMode_Specular 2
#define kDebugMode_Normal   3
#define kDebugMode_Lightmap 4

int GetDebugMode() {
    return int(u_CameraPosWorld.w);
}

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
    // SunDirX, SunDirY, SunDirZ, User 1
    vec4 Misc[2];
    // R, G, B, Fog MaxDensity
    vec4 FogColor;
    // R, G, B, LS BlendCoeff
    vec4 SunColor;
    // R, G, B, User 2
    vec4 Reflectance;
};

#define UNORM_TO_SNORM(xyz) ((xyz - 0.5) * 2.0)

vec2 DecodeTexCoord(in vec2 t_RawTexCoord) {
    // The original game uses S16 texture coordinates and divides by 1024 in the shader.
    // We don't have integer attributes, so we map to UNORM instead. 32768/1024 = 32
    return t_RawTexCoord * 32.0f;
}
`;

    public static FragCommon = `
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

vec3 DecodeNormalMap(vec3 t_NormalMapIn) {
    // Decode two-channel normal map
    vec3 t_NormalMap;
    t_NormalMap.xy = t_NormalMapIn.xy * 2.0 - 1.0;
    t_NormalMap.z = sqrt(1.0 - min(dot(t_NormalMap.xy, t_NormalMap.xy), 1.0));
    return normalize(t_NormalMap.xyz);
}

vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec4 t_BasisY, in vec3 t_BasisZ) {
    vec3 t_BasisX = normalize(cross(t_BasisZ.xyz, t_BasisY.xyz) * t_BasisY.w);
    return t_TangentNormal.xxx * t_BasisX.xyz + t_TangentNormal.yyy * t_BasisY.xyz + t_TangentNormal.zzz * t_BasisZ.xyz;
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

vec3 CalcDirLightSpecular(in DirectionalLight t_DirLight, in vec3 t_ReflectionWorld, in float t_SpecularPower) {
    return t_DirLight.Color.rgb * pow(saturate(dot(-t_DirLight.Direction.xyz, t_ReflectionWorld)), t_SpecularPower);
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

vec3 CalcPointLightSpecular(in PointLight t_PointLight, in vec3 t_PositionWorld, in vec3 t_ReflectionWorld, in float t_SpecularPower) {
    vec3 t_LightPosition = t_PointLight.PositionAttenStart.xyz;
    vec3 t_LightColor = t_PointLight.ColorAttenEnd.rgb;

    vec3 t_Delta = t_LightPosition - t_PositionWorld.xyz;
    float t_DistAtten = CalcPointLightDistAtten(t_PointLight, t_PositionWorld);
    float t_DotAtten = pow(saturate(dot(normalize(t_Delta), t_ReflectionWorld)), t_SpecularPower);

    return t_LightColor * t_DistAtten * t_DotAtten;
}
`;

    constructor(protected mtd: MTD) {
        super();
    }

    protected getTexture(name: string): MTDTexture | null {
        const texDef = this.mtd.textures.find((t) => t.name === name);
        if (texDef !== undefined)
            return texDef;
        else
            return null;
    }

    protected hasTexture(name: string): boolean {
        return this.mtd.textures.some((t) => t.name === name);
    }
}

class MaterialProgram_Phn extends MaterialProgram_Base {
    public override both = `
precision highp float;

${MaterialProgram_Base.BindingDefinitions}

layout(std140) uniform ub_MeshFragParams {
    Mat3x4 u_WorldFromLocal[1];
    vec4 u_DiffuseMapColor;
    vec4 u_SpecularMapColor;
    vec4 u_EnvDifColor;
    vec4 u_EnvSpcColor;
    DirectionalLight u_DirectionalLight[3];
    HemisphereLight u_HemisphereLight;
    PointLight u_PointLights[1];
    FogParams u_FogParams;
    vec4 u_Misc[2];
};

#define u_SpecularPower (u_SpecularMapColor.w)
#define u_TexScroll0    (u_Misc[0].xy)
#define u_TexScroll1    (u_Misc[0].zw)
#define u_TexScroll2    (u_Misc[1].xy)

layout(binding = 0) uniform sampler2D u_TextureDiffuse;
layout(binding = 1) uniform sampler2D u_TextureSpecular;
layout(binding = 2) uniform sampler2D u_TextureBumpmap;
layout(binding = 3) uniform sampler2D u_TextureDiffuse2;
layout(binding = 4) uniform sampler2D u_TextureSpecular2;
layout(binding = 5) uniform sampler2D u_TextureBumpmap2;
layout(binding = 6) uniform sampler2D u_TextureLightmap;

layout(binding = 7) uniform samplerCube u_TextureEnvDif;
layout(binding = 8) uniform samplerCube u_TextureEnvSpc;

varying vec4 v_Color;
varying vec2 v_TexCoord0; // Texture0
varying vec2 v_TexCoord1; // Texture1
varying vec2 v_TexCoord2; // Lightmap
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec4 v_TangentSpaceBasisY0;
varying vec3 v_TangentSpaceBasisZ;

#ifdef HAS_TANGENT1
varying vec4 v_TangentSpaceBasisY1;
#endif
`;

    constructor(mtd: MTD) {
        super(mtd);
        this.vert = this.genVert();
        this.frag = this.genFrag();
    }

    private genTexCoord(textureName: string): string {
        const texture = this.getTexture(textureName);
        if (texture !== null) {
            const texCoordIn = [
                `a_TexCoord0.xy`,
                `a_TexCoord0.zw`,
                `a_TexCoord1.xy`,
            ];
            const texCoord = texCoordIn[texture.uvNumber];
            return `DecodeTexCoord(${texCoord})`;
        } else {
            return `vec2(0.0)`;
        }
    }

    private genVert(): string {
        return `
layout(location = ${MaterialProgram_Base.a_Position})  in vec3 a_Position;
layout(location = ${MaterialProgram_Base.a_Color})     in vec4 a_Color;
layout(location = ${MaterialProgram_Base.a_TexCoord0}) in vec4 a_TexCoord0;
layout(location = ${MaterialProgram_Base.a_TexCoord1}) in vec4 a_TexCoord1;
layout(location = ${MaterialProgram_Base.a_Normal})    in vec4 a_Normal;
layout(location = ${MaterialProgram_Base.a_Tangent0})  in vec4 a_Tangent0;

#ifdef HAS_TANGENT1
layout(location = ${MaterialProgram_Base.a_Tangent1})  in vec4 a_Tangent1;
#endif

${GfxShaderLibrary.MulNormalMatrix}

void main() {
    mat4x3 t_WorldFromLocal = UnpackMatrix(u_WorldFromLocal[0]);
    vec3 t_PositionWorld = t_WorldFromLocal * vec4(a_Position, 1.0);
    v_PositionWorld = t_PositionWorld.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);

    vec3 t_NormalWorld = MulNormalMatrix(t_WorldFromLocal, UNORM_TO_SNORM(a_Normal.xyz));
    v_TangentSpaceBasisZ = t_NormalWorld;

    vec3 t_TangentWorld0 = normalize(t_WorldFromLocal * vec4(UNORM_TO_SNORM(a_Tangent0.xyz), 0.0));
    v_TangentSpaceBasisY0 = vec4(t_TangentWorld0, UNORM_TO_SNORM(a_Tangent0.w));

#ifdef HAS_TANGENT1
    vec3 t_TangentWorld1 = normalize(t_WorldFromLocal * vec4(UNORM_TO_SNORM(a_Tangent1.xyz), 0.0));
    v_TangentSpaceBasisY1 = vec4(t_TangentWorld1, UNORM_TO_SNORM(a_Tangent1.w));
#endif

    v_Color = a_Color;
    v_TexCoord0 = ${this.genTexCoord(`g_Diffuse`)} + u_TexScroll0.xy;
    v_TexCoord1 = ${this.genTexCoord(`g_Diffuse_2`)} + u_TexScroll1.xy;
    v_TexCoord2 = ${this.genTexCoord(`g_Lightmap`)} + u_TexScroll2.xy;
}`;
    }

    private genFrag(): string {
        return `
${MaterialProgram_Base.FragCommon}

vec4 CalcTangent(float t_Blend) {
#if defined HAS_TANGENT1
    return mix(v_TangentSpaceBasisY0, v_TangentSpaceBasisY1, t_Blend);
#else
    return v_TangentSpaceBasisY0;
#endif
}

void main() {
    int DebugMode = GetDebugMode();
    vec4 t_DebugColor = vec4(0.0);

    bool enable_Lightmap = ${this.hasTexture(`g_Lightmap`)};

    vec4 t_Color = vec4(1.0);
    float t_Blend = v_Color.a;

    bool enable_Diffuse = ${this.hasTexture(`g_Diffuse`)};
    bool enable_Diffuse_2 = ${this.hasTexture(`g_Diffuse_2`)};
    vec4 t_Diffuse = vec4(1.0);
    if (enable_Diffuse) {
        vec4 t_Diffuse1 = texture(SAMPLER_2D(u_TextureDiffuse), v_TexCoord0);
        if (enable_Diffuse_2) {
            vec4 t_Diffuse2 = texture(SAMPLER_2D(u_TextureDiffuse2), v_TexCoord1);
            t_Diffuse = mix(t_Diffuse1, t_Diffuse2, t_Blend);
        } else {
            t_Diffuse = t_Diffuse1;
        }
    }
    t_Diffuse.rgb *= u_DiffuseMapColor.rgb;

    if (DebugMode == kDebugMode_Diffuse) {
        t_DebugColor.rgba = t_Diffuse.rgba;
    }

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;

    bool enable_Bumpmap = ${this.hasTexture(`g_Bumpmap`)};
    bool enable_Bumpmap_2 = ${this.hasTexture(`g_Bumpmap_2`)};
    vec3 t_NormalDirWorld = vec3(0.0);
    if (enable_Bumpmap) {
        vec3 t_BumpmapSample;
        vec3 t_Bumpmap1 = texture(SAMPLER_2D(u_TextureBumpmap), v_TexCoord0).rgb;
        if (enable_Bumpmap_2) {
            vec3 t_Bumpmap2 = texture(SAMPLER_2D(u_TextureBumpmap2), v_TexCoord1).rgb;
            t_BumpmapSample = mix(t_Bumpmap1, t_Bumpmap2, t_Blend);
        } else {
            t_BumpmapSample = t_Bumpmap1;
        }

        vec3 t_NormalTangentSpace = DecodeNormalMap(t_BumpmapSample.xyz);
        vec4 t_Tangent = CalcTangent(t_Blend);
        t_NormalDirWorld = normalize(CalcTangentToWorld(t_NormalTangentSpace, t_Tangent, v_TangentSpaceBasisZ));
    } else {
        t_NormalDirWorld = v_TangentSpaceBasisZ;
    }

    if (DebugMode == kDebugMode_Normal) {
        t_DebugColor.rgba = vec4(t_NormalDirWorld * 0.25 + 0.5, 1.0);
    }

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
                t_IncomingSpecularRadiance.rgb += CalcDirLightSpecular(u_DirectionalLight[i], t_ReflectionWorld, u_SpecularPower);
            }
        } else if (t_LightingType == 3) {
            // Env
            t_IncomingDiffuseRadiance.rgb += texture(SAMPLER_Cube(u_TextureEnvDif), t_NormalDirWorld).rgb * u_EnvDifColor.rgb;
            t_IncomingSpecularRadiance.rgb += texture(SAMPLER_Cube(u_TextureEnvSpc), t_ReflectionWorld).rgb * u_EnvSpcColor.rgb;
        }

        // Light map (really a baked indirect shadow map...) only applies to environment lighting.
        vec3 t_LightmapSample = texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord2).rgb;
        t_IncomingDiffuseRadiance.rgb += t_LightmapSample;
        t_IncomingSpecularRadiance.rgb += t_LightmapSample;

        if (DebugMode == kDebugMode_Lightmap) {
            t_DebugColor.rgba = vec4(t_LightmapSample.rgb, 1.0);
        }

        for (int i = 0; i < 1; i++) {
            t_IncomingDiffuseRadiance.rgb += CalcPointLightDiffuse(u_PointLights[i], v_PositionWorld.xyz, t_NormalDirWorld.xyz);
            t_IncomingSpecularRadiance.rgb += CalcPointLightSpecular(u_PointLights[i], v_PositionWorld.xyz, t_ReflectionWorld, u_SpecularPower);
        }

        // Hemisphere light for ambient.
        float t_DiffuseIntensity = dot(t_NormalDirWorld, vec3(0.0, 1.0, 0.0));
        t_IncomingDiffuseRadiance += mix(u_HemisphereLight.ColorD.rgb, u_HemisphereLight.ColorU.rgb, t_DiffuseIntensity * 0.5 + 0.5);

        bool enable_Specular = ${this.hasTexture(`g_Specular`)};
        bool enable_Specular_2 = ${this.hasTexture(`g_Specular_2`)};
        vec3 t_Specular = vec3(0.0);
        if (enable_Specular) {
            vec3 t_Specular1 = texture(SAMPLER_2D(u_TextureSpecular), v_TexCoord0).rgb;
            if (enable_Specular_2) {
                vec3 t_Specular2 = texture(SAMPLER_2D(u_TextureSpecular2), v_TexCoord1).rgb;
                t_Specular = mix(t_Specular1, t_Specular2, t_Blend);
            } else {
                t_Specular = t_Specular1;
            }
            t_Specular.rgb *= u_SpecularMapColor.rgb;
        }

        if (DebugMode == kDebugMode_Specular) {
            t_DebugColor.rgba = vec4(t_Specular.rgb, 1.0);
        }

        t_OutgoingLight += t_Diffuse.rgb * t_IncomingDiffuseRadiance;
        t_OutgoingLight += t_Specular * t_IncomingSpecularRadiance;

        t_Color.rgb *= t_OutgoingLight;
        t_Color.a *= t_Diffuse.a;
    }

    t_Color *= v_Color;

    bool enable_AlphaTest = ${getBlendMode(this.mtd) === BlendMode.TexEdge};
    if (enable_AlphaTest) {
        if (t_Color.a < 0.5)
            discard;
    }

    CalcFog(t_Color.rgb, u_FogParams, t_PositionToEye);

    LightScatteringParams t_LightScatteringParams;
    t_LightScatteringParams.BetaRay = u_HemisphereLight.ColorU.w;
    t_LightScatteringParams.BetaMie = u_HemisphereLight.ColorD.w;
    t_LightScatteringParams.HGg = u_FogParams.Misc[0].z;
    t_LightScatteringParams.DistanceMul = u_FogParams.Misc[0].w;
    t_LightScatteringParams.BlendCoeff = u_FogParams.SunColor.w;
    t_LightScatteringParams.SunDirection = u_FogParams.Misc[1].xyz;
    t_LightScatteringParams.SunColor = u_FogParams.SunColor.xyz;
    t_LightScatteringParams.Reflectance = u_FogParams.Reflectance.xyz;
    CalcLightScattering(t_Color.rgb, t_LightScatteringParams, t_PositionToEye);

    t_Color.rgba = mix(t_Color.rgba, vec4(t_DebugColor.rgb, 1.0), t_DebugColor.a);

    gl_FragColor = t_Color;
}
`;
    }
}

function calcBlendMode(dst: Partial<GfxMegaStateDescriptor>, blendMode: BlendMode): boolean {
    let isTranslucent = false;
    if (blendMode === BlendMode.Normal || blendMode === BlendMode.TexEdge) {
        // Default
    } else if (blendMode === BlendMode.Blend || blendMode === BlendMode.Water) {
        dst.depthWrite = false;
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        isTranslucent = true;
    } else if (blendMode === BlendMode.Add) {
        dst.depthWrite = false;
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.One,
        });
        isTranslucent = true;
    } else if (blendMode === BlendMode.Sub) {
        dst.depthWrite = false;
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.ReverseSubtract,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.One,
        });
        isTranslucent = true;
    } else {
        console.warn(`Unknown blend mode ${blendMode}`);
    }
    return isTranslucent;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
class MaterialInstance_Phn {
    private diffuseMapColor = vec3.fromValues(1, 1, 1);
    private specularMapColor = vec4.fromValues(0, 0, 0, 0);
    private texScroll = nArray(3, () => vec2.create());
    private textureMapping = nArray(9, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private gfxProgram: GfxProgram;
    private sortKey: number;

    constructor(cache: GfxRenderCache, private material: Material, private mtd: MTD, textureHolder: TextureHolder, inputLayout: InputLayout) {
        const program = new MaterialProgram_Phn(mtd);

        if (inputLayout.vertexAttributes.some((vertexAttribute) => vertexAttribute.semantic === VertexInputSemantic.Tangent1))
            program.defines.set('HAS_TANGENT1', '1');

        this.gfxProgram = cache.createProgram(program);

        linkTextureParameter(this.textureMapping[0], textureHolder, material, mtd, 'g_Diffuse');
        linkTextureParameter(this.textureMapping[1], textureHolder, material, mtd, 'g_Specular');
        linkTextureParameter(this.textureMapping[2], textureHolder, material, mtd, 'g_Bumpmap');
        linkTextureParameter(this.textureMapping[3], textureHolder, material, mtd, 'g_Diffuse_2');
        linkTextureParameter(this.textureMapping[4], textureHolder, material, mtd, 'g_Specular_2');
        linkTextureParameter(this.textureMapping[5], textureHolder, material, mtd, 'g_Bumpmap_2');
        linkTextureParameter(this.textureMapping[6], textureHolder, material, mtd, 'g_Lightmap');

        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        for (let i = 0; i < this.textureMapping.length; i++)
            this.textureMapping[i].gfxSampler = gfxSampler;

        const diffuseMapColor = getMaterialParam(mtd, 'g_DiffuseMapColor');
        if (diffuseMapColor !== null) {
            const diffuseMapColorPower = getMaterialParamF32(mtd, `g_DiffuseMapColorPower`);
            vec3.set(this.diffuseMapColor, diffuseMapColor[0] * diffuseMapColorPower, diffuseMapColor[1] * diffuseMapColorPower, diffuseMapColor[2] * diffuseMapColorPower);
        }

        const specularMapColor = getMaterialParam(mtd, 'g_SpecularMapColor');
        if (specularMapColor !== null) {
            const specularMapColorPower = getMaterialParamF32(mtd, `g_SpecularMapColorPower`);
            vec4.set(this.specularMapColor, specularMapColor[0] * specularMapColorPower, specularMapColor[1] * specularMapColorPower, specularMapColor[2] * specularMapColorPower, 0);
        }

        this.specularMapColor[3] = getMaterialParamF32(mtd, 'g_SpecularPower');

        for (let i = 0; i < 3; i++) {
            getMaterialParamVec2(this.texScroll[i], mtd, `g_TexScroll_${i}`);
        }

        let blendMode = getBlendMode(mtd);
        if (blendMode === BlendMode.Water)
            blendMode = BlendMode.Normal; // this is likely snow
        const isTranslucent = calcBlendMode(this.megaState, blendMode);

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer, 0);
    }

    public setOnRenderInst(renderContext: RenderContext, modelMatrix: ReadonlyMat4, materialDrawConfig: MaterialDrawConfig, renderInst: GfxRenderInst): void {
        const textureHolder = renderContext.textureHolder;
        textureHolder.fillTextureMapping(this.textureMapping[7], `envdif_${materialDrawConfig.areaID}_${leftPad('' + materialDrawConfig.lightParams.envDifTextureNo, 3)}`)

        const envSpcSlotNo = getMaterialParam(this.mtd, `g_EnvSpcSlotNo`);
        if (envSpcSlotNo !== null)
            textureHolder.fillTextureMapping(this.textureMapping[8], `envspc_${materialDrawConfig.areaID}_${leftPad('' + materialDrawConfig.lightParams.envSpcTextureNo[envSpcSlotNo[0]], 3)}`)

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaState);

        let offs = renderInst.allocateUniformBuffer(MaterialProgram_Phn.ub_MeshFragParams, 12*1 + 4*4 + 4*2*3 + 4*11);
        const d = renderInst.mapUniformBufferF32(MaterialProgram_Phn.ub_MeshFragParams);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += fillVec3v(d, offs, this.diffuseMapColor);
        offs += fillVec4v(d, offs, this.specularMapColor);
        offs += fillColor(d, offs, materialDrawConfig.lightParams.envDifColor);
        offs += fillColor(d, offs, materialDrawConfig.lightParams.envSpcColor);

        for (let i = 0; i < 3; i++)
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

        const scrollTime = renderContext.globalTime / 1000;
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[0][0], scrollTime * this.texScroll[0][1],
            scrollTime * this.texScroll[1][0], scrollTime * this.texScroll[1][1],
        );
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[2][0], scrollTime * this.texScroll[2][1],
        );

        const cameraView = renderContext.cameraView;
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(cameraView.viewFromWorldMatrix, bboxScratch) + bboxScratch.boundingSphereRadius();
        renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
    }

    public submitRenderInst(renderContext: RenderContext, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst): void {
        renderContext.mainList.submitRenderInst(renderInst);
    }
}

class MaterialProgram_WaterHeight extends MaterialProgram_Base {
    public override both = `
precision highp float;

${MaterialProgram_Base.BindingDefinitions}

layout(binding = 8) uniform samplerCube u_TextureDummy;

layout(std140) uniform ub_MeshFragParams {
    Mat3x4 u_WorldFromLocal[1];
    DirectionalLight u_DirectionalLight;
    FogParams u_FogParams;
    vec4 u_Misc[7];
};

#define u_TileScale      (u_Misc[0].xyz)
#define u_TileBlend      (u_Misc[1].xyz)

#define u_TexScroll0     (u_Misc[2].xy)
#define u_TexScroll1     (u_Misc[2].zw)
#define u_TexScroll2     (u_Misc[3].xy)

layout(binding = 0) uniform sampler2D u_TextureBumpmap;

varying vec3 v_PositionWorld;
varying vec2 v_TexCoord0;
varying vec2 v_TexCoord1;
varying vec2 v_TexCoord2;
`;

public override vert = `
layout(location = ${MaterialProgram_Base.a_Position})  in vec3 a_Position;
layout(location = ${MaterialProgram_Base.a_TexCoord0}) in vec4 a_TexCoord0;

void main() {
    mat4x3 t_WorldFromLocal = UnpackMatrix(u_WorldFromLocal[0]);
    vec3 t_PositionWorld = t_WorldFromLocal * vec4(a_Position, 1.0);
    v_PositionWorld = t_PositionWorld.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);

    v_TexCoord0.xy = DecodeTexCoord(a_TexCoord0.xy) * u_TileScale.xx + u_TexScroll0.xy;
    v_TexCoord1.xy = DecodeTexCoord(a_TexCoord0.xy) * u_TileScale.yy + u_TexScroll1.xy;
    v_TexCoord2.xy = DecodeTexCoord(a_TexCoord0.xy) * u_TileScale.zz + u_TexScroll2.xy;
}
`;

public override frag = `
${GfxShaderLibrary.saturate}

void main() {
    float t_Height = 0.0f;
    t_Height += texture(SAMPLER_2D(u_TextureBumpmap), v_TexCoord0.xy).r * u_TileBlend.x;
    t_Height += texture(SAMPLER_2D(u_TextureBumpmap), v_TexCoord1.xy).r * u_TileBlend.y;
    t_Height += texture(SAMPLER_2D(u_TextureBumpmap), v_TexCoord2.xy).r * u_TileBlend.z;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    float t_DistanceToEye = length(t_PositionToEye);

    float t_WaterHeightFadeDist = 100.0f;
    float t_Fade = 1.0f - saturate(t_DistanceToEye / t_WaterHeightFadeDist);
    t_Height *= t_Fade;

    gl_FragColor = vec4(t_Height, 0.0f, 0.0f, 0.0f);
}
`;
}

class MaterialProgram_Water extends MaterialProgram_Base {
    public override both = `
precision highp float;

${MaterialProgram_Base.BindingDefinitions}

layout(binding = 8) uniform samplerCube u_TextureDummy;

layout(std140) uniform ub_MeshFragParams {
    Mat3x4 u_WorldFromLocal[1];
    DirectionalLight u_DirectionalLight;
    FogParams u_FogParams;
    vec4 u_Misc[7];
};

#define u_FresnelPow      (u_Misc[0].w)
#define u_WaterWaveHeight (u_Misc[1].w)

#define u_SpecularPower   (u_Misc[3].z)
#define u_WaterFadeBegin  (u_Misc[3].w)

#define u_FresnelScale    (u_Misc[4].x)
#define u_FresnelBias     (u_Misc[4].y)
#define u_ReflectBand     (u_Misc[4].z)
#define u_RefractBand     (u_Misc[4].w)

#define u_FresnelColor    (u_Misc[5].xyz)

#define u_WaterColor      (u_Misc[6].xyzw)

layout(binding = 0) uniform sampler2D u_TextureBumpmap;
layout(binding = 1) uniform sampler2D u_TextureDeferredHeight;
layout(binding = 2) uniform sampler2D u_TextureRefract;
layout(binding = 3) uniform sampler2D u_TextureReflect;

varying vec4 v_Color;
varying vec2 v_TexCoord0;
varying vec3 v_TexCoordProj;
varying vec3 v_TexCoordProjX;
varying vec3 v_TexCoordProjY;
varying vec3 v_PositionWorld;
varying vec3 v_TangentSpaceBasisX;
varying vec3 v_TangentSpaceBasisY;
varying vec3 v_TangentSpaceBasisZ;
`;

    public override vert = `
layout(location = ${MaterialProgram_Base.a_Position})  in vec3 a_Position;
layout(location = ${MaterialProgram_Base.a_Color})     in vec4 a_Color;
layout(location = ${MaterialProgram_Base.a_TexCoord0}) in vec4 a_TexCoord0;
layout(location = ${MaterialProgram_Base.a_TexCoord1}) in vec4 a_TexCoord1;
layout(location = ${MaterialProgram_Base.a_Normal})    in vec4 a_Normal;
layout(location = ${MaterialProgram_Base.a_Tangent0})  in vec4 a_Tangent0;

#ifdef HAS_TANGENT1
layout(location = ${MaterialProgram_Base.a_Tangent1})  in vec4 a_Tangent1;
#endif

${GfxShaderLibrary.MulNormalMatrix}

void main() {
    mat4x3 t_WorldFromLocal = UnpackMatrix(u_WorldFromLocal[0]);
    vec3 t_PositionWorld = t_WorldFromLocal * vec4(a_Position, 1.0);
    v_PositionWorld = t_PositionWorld.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);

    v_Color = a_Color;
    v_TexCoord0 = a_TexCoord0.xy;
    v_TexCoordProj.xyz = gl_Position.xyw;

    v_TangentSpaceBasisZ = MulNormalMatrix(t_WorldFromLocal, UNORM_TO_SNORM(a_Normal.xyz));
    v_TangentSpaceBasisY = normalize(t_WorldFromLocal * vec4(UNORM_TO_SNORM(a_Tangent0.xyz), 0.0));
    v_TangentSpaceBasisX = normalize(cross(v_TangentSpaceBasisZ, v_TangentSpaceBasisY) * UNORM_TO_SNORM(a_Tangent0.w));

    v_TexCoordProjX = (UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld + v_TangentSpaceBasisX, 1.0)).xyw;
    v_TexCoordProjY = (UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld + v_TangentSpaceBasisY, 1.0)).xyw;
}
`;

    public override frag = `
${MaterialProgram_Base.FragCommon}

float CalcFresnel(float t_DotProduct, float t_FresnelPow) {
    return pow(1.0 - max(0.0, t_DotProduct), t_FresnelPow);
}

vec2 SampleFramebufferCoord(vec2 t_TexCoord) {
#if GFX_VIEWPORT_ORIGIN_TL()
    t_TexCoord.y = 1.0 - t_TexCoord.y;
#endif
    return t_TexCoord;
}

void main() {
    vec4 t_Color = vec4(1.0);
    float t_Blend = v_Color.a;

    vec2 t_TexCoordProj = v_TexCoordProj.xy / v_TexCoordProj.z;
    vec2 t_TexOffsX = (v_TexCoordProjX.xy / v_TexCoordProjX.zz) - t_TexCoordProj;
    vec2 t_TexOffsY = (v_TexCoordProjY.xy / v_TexCoordProjY.zz) - t_TexCoordProj;

    t_TexCoordProj = t_TexCoordProj * 0.5 + 0.5;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    float t_DistanceToEye = length(t_PositionToEye);

    // Scale tangent based on parameters. Not sure exactly what this is doing...
    float t_TangentScaleDist = 1.0 / 2.5;
    float t_TangentScaleMul = 1.0 / 45.0; // 720 / 16
    float t_TangentScale = t_DistanceToEye * t_TangentScaleDist * t_TangentScaleMul;
    t_TexOffsX *= t_TangentScale;
    t_TexOffsY *= t_TangentScale;

    // Compute surface normal from heightmap.

    // DSR has:
    //   v6 = tangent (points downwards on the surface). v_TangentSpaceBasisY
    //   v7 = binormal (computed; points rightwards on the surface). v_TangentSpaceBasisX

    // v6/tangent/Y
    float t_HeightZ0 = texture(SAMPLER_2D(u_TextureDeferredHeight), SampleFramebufferCoord(t_TexCoordProj.xy - t_TexOffsY)).r;
    float t_HeightZ1 = texture(SAMPLER_2D(u_TextureDeferredHeight), SampleFramebufferCoord(t_TexCoordProj.xy + t_TexOffsY)).r;
    vec3 t_TangentZ = v_TangentSpaceBasisY.xyz * t_TangentScale * 2.0;
    float t_HeightZ = (t_HeightZ1 - t_HeightZ0) * u_WaterWaveHeight + t_TangentZ.y;
    vec3 t_NormalZ = normalize(vec3(t_HeightZ, t_TangentZ.z, t_TangentZ.x));

    // v7/binormal/X
    float t_HeightX0 = texture(SAMPLER_2D(u_TextureDeferredHeight), SampleFramebufferCoord(t_TexCoordProj.xy - t_TexOffsX)).r;
    float t_HeightX1 = texture(SAMPLER_2D(u_TextureDeferredHeight), SampleFramebufferCoord(t_TexCoordProj.xy + t_TexOffsX)).r;
    vec3 t_TangentX = v_TangentSpaceBasisX.xyz * t_TangentScale * 2.0;
    float t_HeightX = (t_HeightX1 - t_HeightX0) * u_WaterWaveHeight + t_TangentX.y;
    vec3 t_NormalX = normalize(vec3(t_TangentX.z, t_TangentX.x, t_HeightX));

    // vec3 t_NormalDirWorld = cross(t_NormalX, t_NormalZ);
    // Super weird cross product... seems to match the game though
    vec3 t_NormalDirWorld = (t_NormalZ.yzx * t_NormalX.zxy) - (t_NormalZ.xyz * t_NormalX.xyz);

    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    vec3 t_ReflectionWorld = reflect(-t_WorldDirectionToEye.xyz, t_NormalDirWorld.xyz);

    vec2 t_RefractTexCoord = t_TexCoordProj;
    t_RefractTexCoord += t_NormalDirWorld.xz * u_RefractBand * v_Color.a;
    vec4 t_Refract = texture(SAMPLER_2D(u_TextureRefract), SampleFramebufferCoord(t_RefractTexCoord));

    vec3 t_WaterColor = mix(t_Refract.rgb, u_WaterColor.rgb, u_WaterColor.a * t_Blend);

    vec2 t_ReflectTexCoord = t_TexCoordProj;
    t_ReflectTexCoord += t_NormalDirWorld.xz * u_ReflectBand;
    // TODO(jstpierre): Reflection texture
    // vec3 t_Reflect = texture(SAMPLER_2D(u_TextureReflect), SampleFramebufferCoord(t_ReflectTexCoord));
    vec3 t_Reflect = t_WaterColor;
    t_Reflect.rgb += CalcDirLightSpecular(u_DirectionalLight, t_ReflectionWorld, u_SpecularPower);

    float t_NoV = saturate(dot(t_NormalDirWorld, t_WorldDirectionToEye));
    float t_Fresnel = CalcFresnel(t_NoV, u_FresnelPow);
    t_Fresnel = mix(t_Fresnel, 1.0f, u_FresnelBias);
    t_Fresnel *= u_FresnelScale;

    t_Color.rgb = mix(t_WaterColor.rgb, t_Reflect.rgb, t_Fresnel);

    CalcFog(t_Color.rgb, u_FogParams, t_PositionToEye);

    LightScatteringParams t_LightScatteringParams;
    t_LightScatteringParams.BetaRay = u_DirectionalLight.Direction.w;
    t_LightScatteringParams.BetaMie = u_DirectionalLight.Color.w;
    t_LightScatteringParams.HGg = u_FogParams.Misc[0].z;
    t_LightScatteringParams.DistanceMul = u_FogParams.Misc[0].w;
    t_LightScatteringParams.BlendCoeff = u_FogParams.SunColor.w;
    t_LightScatteringParams.SunDirection = u_FogParams.Misc[1].xyz;
    t_LightScatteringParams.SunColor = u_FogParams.SunColor.xyz;
    t_LightScatteringParams.Reflectance = u_FogParams.Reflectance.xyz;
    CalcLightScattering(t_Color.rgb, t_LightScatteringParams, t_PositionToEye);

    float t_WaterFade = saturate(t_Blend / u_WaterFadeBegin);
    t_Color.rgb = mix(t_WaterColor.rgb, t_Color.rgb, t_WaterFade);

    gl_FragColor = t_Color;
}
`;
}

class MaterialInstance_Water {
    private texScroll = nArray(3, () => vec2.create());
    private tileScale = vec3.create();
    private tileBlend = vec3.create();
    private reflectBand = 0;
    private refractBand = 0;
    private waterColor = colorNewCopy(TransparentBlack);
    private fresnelPow = 0;
    private fresnelBias = 0;
    private fresnelScale = 0;
    private fresnelColor = colorNewCopy(TransparentBlack);
    private waterFadeBegin = 0;
    private waterWaveHeight = 0;
    private specularPower = 0;
    private textureMapping = nArray(4, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private gfxProgramWater: GfxProgram;
    private gfxProgramWaterHeight: GfxProgram;
    private sortKey: number;

    constructor(cache: GfxRenderCache, private material: Material, private mtd: MTD, textureHolder: TextureHolder, inputLayout: InputLayout) {
        for (let i = 0; i < 3; i++) {
            getMaterialParamVec2(this.texScroll[i], mtd, `g_TexScroll_${i}`);
            this.tileScale[i] = getMaterialParamF32(mtd, `g_TileScale_${i}`);
            this.tileBlend[i] = getMaterialParamF32(mtd, `g_TileBlend_${i}`);
        }

        this.reflectBand = getMaterialParamF32(mtd, `g_ReflectBand`);
        this.refractBand = getMaterialParamF32(mtd, `g_RefractBand`);
        this.waterWaveHeight = getMaterialParamF32(mtd, `g_WaterWaveHeight`);
        getMaterialParamColor(this.waterColor, mtd, `g_WaterColor`);
        this.fresnelPow = getMaterialParamF32(mtd, `g_FresnelPow`);
        this.fresnelBias = getMaterialParamF32(mtd, `g_FresnelBias`);
        this.fresnelScale = getMaterialParamF32(mtd, `g_FresnelScale`);
        getMaterialParamColor(this.fresnelColor, mtd, `g_FresnelColor`);
        this.waterFadeBegin = getMaterialParamF32(mtd, `g_WaterFadeBegin`);
        this.specularPower = getMaterialParamF32(mtd, `g_SpecularPower`);

        linkTextureParameter(this.textureMapping[0], textureHolder, material, mtd, 'g_Bumpmap');

        this.textureMapping[1].lateBinding = LateBindingTexture.WaterHeight;
        this.textureMapping[2].lateBinding = LateBindingTexture.FramebufferColor;
        this.textureMapping[3].lateBinding = LateBindingTexture.WaterReflection;

        const wrapSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const clampSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.textureMapping[0].gfxSampler = wrapSampler;
        this.textureMapping[1].gfxSampler = clampSampler;
        this.textureMapping[2].gfxSampler = clampSampler;
        this.textureMapping[3].gfxSampler = clampSampler;

        this.gfxProgramWater = cache.createProgram(new MaterialProgram_Water(mtd));
        this.gfxProgramWaterHeight = cache.createProgram(new MaterialProgram_WaterHeight(mtd));

        const isTranslucent = calcBlendMode(this.megaState, getBlendMode(mtd));

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer, 0);
    }

    public setOnRenderInst(renderContext: RenderContext, modelMatrix: ReadonlyMat4, materialDrawConfig: MaterialDrawConfig, renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(MaterialProgram_Phn.ub_MeshFragParams, 12*1 + 4*5 + 4*2 + 4*7);
        const d = renderInst.mapUniformBufferF32(MaterialProgram_Phn.ub_MeshFragParams);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += materialDrawConfig.lightParams.dirLight[3].fill(d, offs, materialDrawConfig.lightScatteringParams.betaRay, materialDrawConfig.lightScatteringParams.betaMie);

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

        offs += fillVec3v(d, offs, this.tileScale, this.fresnelPow);
        offs += fillVec3v(d, offs, this.tileBlend, this.waterWaveHeight);

        const scrollTime = renderContext.globalTime / 1000;
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[0][0], scrollTime * this.texScroll[0][1],
            scrollTime * this.texScroll[1][0], scrollTime * this.texScroll[1][1],
        );
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[2][0], scrollTime * this.texScroll[2][1],
            this.specularPower, this.waterFadeBegin,
        );

        offs += fillVec4(d, offs, this.fresnelScale, this.fresnelBias, this.reflectBand, this.refractBand);
        offs += fillColor(d, offs, this.fresnelColor);
        offs += fillColor(d, offs, this.waterColor);

        const cameraView = renderContext.cameraView;
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(cameraView.viewFromWorldMatrix, bboxScratch) + bboxScratch.boundingSphereRadius();
        renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
    }

    public submitRenderInst(renderContext: RenderContext, renderInstManager: GfxRenderInstManager, template: GfxRenderInst): void {
        {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.copyFrom(template);
            renderInst.setGfxProgram(this.gfxProgramWaterHeight);
            renderContext.waterHeightList.submitRenderInst(renderInst);
        }

        {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.copyFrom(template);
            renderInst.setGfxProgram(this.gfxProgramWater);
            renderContext.waterList.submitRenderInst(renderInst);
        }
    }
}

class BatchInstance {
    private visible = true;
    private materialInstance: MaterialInstance_Phn | MaterialInstance_Water;

    constructor(cache: GfxRenderCache, private flverData: FLVERData, private batchData: BatchData, textureHolder: TextureHolder, private material: Material, private mtd: MTD) {
        const inputState = flverData.flver.inputStates[batchData.batch.inputStateIndex];
        const inputLayout = flverData.flver.inputLayouts[inputState.inputLayoutIndex];

        if (mtd.shaderPath.includes('_Water_')) {
            this.materialInstance = new MaterialInstance_Water(cache, material, mtd, textureHolder, inputLayout);
        } else {
            this.materialInstance = new MaterialInstance_Phn(cache, material, mtd, textureHolder, inputLayout);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, renderContext: RenderContext, modelMatrix: ReadonlyMat4, materialDrawConfig: MaterialDrawConfig): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplate();
        this.materialInstance.setOnRenderInst(renderContext, modelMatrix, materialDrawConfig, template);

        for (let i = 0; i < this.batchData.batch.primitiveIndexes.length; i++) {
            const primitive = this.flverData.flver.primitives[this.batchData.batch.primitiveIndexes[i]];
            if (!shouldRenderPrimitive(primitive))
                continue;

            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.batchData.inputLayout, this.batchData.vertexBufferDescriptors, this.batchData.indexBufferDescriptor);
            if (primitive.cullMode)
                renderInst.getMegaStateFlags().cullMode = GfxCullMode.Back;
            renderInst.setDrawCount(this.batchData.primitiveIndexCounts[i], this.batchData.primitiveIndexStarts[i]);

            this.materialInstance.submitRenderInst(renderContext, renderInstManager, renderInst);
        }

        renderInstManager.popTemplate();
    }
}

class DirectionalLight {
    public dir = vec3.create();
    public color = colorNewCopy(White);

    public fill(d: Float32Array, offs: number, p1: number = 0, p2: number = 0): number {
        const baseOffs = offs;
        offs += fillVec3v(d, offs, this.dir, p1);
        offs += fillColor(d, offs, this.color, p2);
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

    public dirLight = nArray(4, () => new DirectionalLight());
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

        for (let j = 0; j < 4; j++) {
            const ch = ['0', '1', '2', 's'][j];

            const dstDirLight = this.dirLight[j];
            const rotX = param.get(i, `degRotX_${ch}`) / 255;
            const rotY = param.get(i, `degRotY_${ch}`) / 255;
            calcDirFromRotXY(dstDirLight.dir, rotX, rotY);

            const colorMul = param.get(i, `colA_${ch}`) / 100;
            dstDirLight.color.r = (param.get(i, `colR_${ch}`) / 255) * colorMul;
            dstDirLight.color.g = (param.get(i, `colG_${ch}`) / 255) * colorMul;
            dstDirLight.color.b = (param.get(i, `colB_${ch}`) / 255) * colorMul;
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

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: TextureHolder, materialDataHolder: MaterialDataHolder, drawParamBank: DrawParamBank, public flverData: FLVERData, public part: Part) {
        drawParamBankCalcMaterialDrawConfig(this.materialDrawConfig, this.part, drawParamBank);

        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batchData = this.flverData.batchData[i];
            const batch = batchData.batch;
            const material = this.flverData.flver.materials[batch.materialIndex];

            const mtdFilePath = material.mtdName;
            const mtdName = mtdFilePath.split('\\').pop()!;
            const mtd = materialDataHolder.getMaterial(mtdName);

            this.batchInstances.push(new BatchInstance(cache, flverData, batchData, textureHolder, material, mtd));
        }
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, renderContext: RenderContext): void {
        if (!this.visible)
            return;

        const cameraView = renderContext.cameraView;
        bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
        if (!cameraView.frustum.contains(bboxScratch))
            return;

        getMatrixTranslation(scratchVec3a, cameraView.worldFromViewMatrix);
        getMatrixAxisZ(scratchVec3b, cameraView.worldFromViewMatrix);
        vec3.scaleAndAdd(this.materialDrawConfig.pointLight[0].position, scratchVec3a, scratchVec3b, -2);

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(renderInstManager, renderContext, this.modelMatrix, this.materialDrawConfig);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 9, samplerEntries: [
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

class RenderContext {
    public globalTime = 0.0;
    public cameraView: CameraView;
    public textureHolder = new TextureHolder();

    public mainList = new GfxRenderInstList();
    public waterHeightList = new GfxRenderInstList();
    public waterList = new GfxRenderInstList();
    public debugMode = 0;

    public reset(): void {
        this.mainList.reset();
        this.waterHeightList.reset();
        this.waterList.reset();
    }
}

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

    constructor(device: GfxDevice, cache: GfxRenderCache, private textureHolder: TextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private drawParamBank: DrawParamBank, private msb: MSB) {
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
        this.sceneDrawConfig.toneMapParams = this.drawParamBank.toneMapBank[part.toneMapID];
    }

    private lodModels: string[] = [];
    public chooseLODModel(): void {
        interactiveVizSliderSelect(this.flverInstances, 'visible', (instance) => {
            this.lodModels.push(instance.name);
            setTimeout(() => { instance.visible = false; }, 2000);
            this.chooseLODModel();
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, renderContext: RenderContext): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(MaterialProgram_Phn.ub_SceneParams, 16+4);
        const d = template.mapUniformBufferF32(MaterialProgram_Phn.ub_SceneParams);

        const cameraView = renderContext.cameraView;
        offs += fillMatrix4x4(d, offs, cameraView.clipFromWorldMatrix);
        getMatrixTranslation(scratchVec3a, cameraView.worldFromViewMatrix);
        offs += fillVec3v(d, offs, scratchVec3a, renderContext.debugMode);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(renderInstManager, renderContext);

        renderInstManager.popTemplate();
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
uniform sampler2D u_Texture2;

layout(std140) uniform ub_Params {
    vec4 u_Misc[3];
};
#define u_DispersionSq      (u_Misc[1].w)
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
#define u_UnprojectParams      (u_Misc[0].xyzw)
#define u_NearParam            (u_Misc[1].xyz)
#define u_FarParam             (u_Misc[2].xyz)
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

float UnprojectViewSpaceDepth(float z) {
#if !GFX_CLIPSPACE_NEAR_ZERO()
    z = z * 2.0 - 1.0;
#endif
    vec4 v = u_UnprojectParams;
    return -(z*v.x + v.y) / (z*v.z + v.w);
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
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },
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

        offs += fillVec4(d, offs, UnprojMtxZZ, UnprojMtxZW, UnprojMtxWZ, UnprojMtxWW);
        offs += fillVec4(d, offs, params.nearDofBegin, params.nearDofEnd, params.nearDofMul, params.dispersionSq);
        offs += fillVec4(d, offs, params.farDofBegin, params.farDofEnd, params.farDofMul, 0.0);
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
        renderInst.setDrawCount(3);

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
#define u_UnprojectParams      (u_Misc[0].xyzw)
#define u_NearParam            (u_Misc[1].xyz)
#define u_FarParam             (u_Misc[2].xyz)
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

float UnprojectViewSpaceDepth(float z) {
#if !GFX_CLIPSPACE_NEAR_ZERO()
    z = z * 2.0 - 1.0;
#endif
    vec4 v = u_UnprojectParams;
    return -(z*v.x + v.y) / (z*v.z + v.w);
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
uniform sampler2D u_Texture2;
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

    const float t_Weight[4] = float[4](
        0.3989422804014327,
        0.06049268112978584,
        0.03669066579343498,
        0.013497741628297016
    );

    // Ring 0 (center)
    t_Color += texture(SAMPLER_2D(u_TextureColor), v_TexCoord) * t_Weight[0];

    // Ring 1 (distance 1)
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1,  0)) * t_Weight[1];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0, -1)) * t_Weight[1];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 1,  0)) * t_Weight[1];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0,  1)) * t_Weight[1];

    // Ring 2 (distance sqrt2)
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1, -1)) * t_Weight[2];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 1, -1)) * t_Weight[2];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 1,  1)) * t_Weight[2];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-1,  1)) * t_Weight[2];

    // Ring 3 (distance 2)
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2(-2,  0)) * t_Weight[3];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0, -2)) * t_Weight[3];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 2,  0)) * t_Weight[3];
    t_Color += textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, ivec2( 0,  2)) * t_Weight[3];

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
uniform sampler2D u_Texture2;
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

    vec4 t_Color = vec4(0.0);
    t_Color += t_Weight[0] * texture(SAMPLER_2D(u_TextureColor), v_TexCoord);

#if defined BLUR_X
    #define BLUR_OFFSET(v) ivec2(v, 0)
#elif defined BLUR_Y
    #define BLUR_OFFSET(v) ivec2(0, v)
#endif

    t_Color += t_Weight[1] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-1));
    t_Color += t_Weight[1] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(1));
    t_Color += t_Weight[2] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-2));
    t_Color += t_Weight[2] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(2));
    t_Color += t_Weight[3] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-3));
    t_Color += t_Weight[3] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(3));
    t_Color += t_Weight[4] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-4));
    t_Color += t_Weight[4] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(4));
    t_Color += t_Weight[5] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-5));
    t_Color += t_Weight[5] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(5));
    t_Color += t_Weight[6] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-6));
    t_Color += t_Weight[6] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(6));
    t_Color += t_Weight[7] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(-7));
    t_Color += t_Weight[7] * textureOffset(SAMPLER_2D(u_TextureColor), v_TexCoord, BLUR_OFFSET(7));

    gl_FragColor = t_Color;
}
`;
}

class BloomCombineProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;
uniform sampler2D u_Texture2;

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

        offs += fillVec4(d, offs, UnprojMtxZZ, UnprojMtxZW, UnprojMtxWZ, UnprojMtxWW);
        offs += fillVec4(d, offs, params.bloomBegin, params.bloomMul, params.bloomNearDist, 0.0);
        offs += fillVec4(d, offs, params.bloomBeginFar, params.bloomMulFar, params.bloomFarDist, 0.0);
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
        renderInst.setDrawCount(3);

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
${GfxShaderLibrary.MatrixLibrary}

uniform sampler2D u_TextureColor;
uniform sampler2D u_Texture2;

layout(std140) uniform ub_Params {
    Mat3x4 u_ToneCorrectMatrix;
    vec4 u_Misc[1];
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
    float t_Exposure = u_Misc[0].x;
    t_Color.rgb *= t_Exposure;
    t_Color.rgb /= (t_Color.rgb + vec3(1.0));

    t_Color.rgb = UnpackMatrix(u_ToneCorrectMatrix) * vec4(t_Color.rgb, 1.0);
    gl_FragColor = t_Color;
}
`;
}

class ToneCorrect {
    private toneCorrectProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private exposure = 2;

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
        let offs = renderInst.allocateUniformBuffer(0, 12 + 4);
        const d = renderInst.mapUniformBufferF32(0);

        offs += params.fill(d, offs);
        offs += fillVec4(d, offs, this.exposure);
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, srcColorTargetID: GfxrRenderTargetID, dstColorTargetID: GfxrRenderTargetID, params: ToneCorrectParams): void {
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(postBindingLayouts);
        this.allocateParameterBuffer(renderInst, params);
        renderInst.setDrawCount(3);

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
    public renderContext = new RenderContext();
    private renderHelper: GfxRenderHelper;
    private depthOfField: DepthOfField;
    private bloom: Bloom;
    private toneCorrect: ToneCorrect;
    private cameraView = new CameraView();
    private textureMapping = nArray(1, () => new TextureMapping());

    constructor(sceneContext: SceneContext) {
        this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);

        this.renderContext.cameraView = this.cameraView;

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

    private prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        this.cameraView.setupFromCamera(viewerInput.camera);

        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        for (let i = 0; i < this.msbRenderers.length; i++)
            this.msbRenderers[i].prepareToRender(renderInstManager, this.renderContext);
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const cache = this.renderHelper.renderCache;

        viewerInput.camera.setClipPlanes(0.1);
        this.renderContext.globalTime = viewerInput.time;

        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        mainColorDesc.clearColor = standardFullClearRenderPassDescriptor.clearColor;
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
                this.renderContext.mainList.drawOnPassRenderer(cache, passRenderer);
            });
        });

        const waterHeightDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
        waterHeightDesc.copyDimensions(mainColorDesc);
        waterHeightDesc.clearColor = Red;

        const waterHeightTargetID = builder.createRenderTargetID(waterHeightDesc, 'Water Height');
        builder.pushPass((pass) => {
            pass.setDebugName('Water Height');

            const depthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Water Height Depth');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, waterHeightTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depthTargetID);
            pass.exec((passRenderer) => {
                this.renderContext.waterHeightList.drawOnPassRenderer(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(waterHeightTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Water');

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            const waterHeightResolveTextureID = builder.resolveRenderTarget(waterHeightTargetID);
            pass.attachResolveTexture(waterHeightResolveTextureID);

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer, scope) => {
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                this.renderContext.waterList.resolveLateSamplerBinding(LateBindingTexture.FramebufferColor, this.textureMapping[0]);

                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(waterHeightResolveTextureID);
                this.renderContext.waterList.resolveLateSamplerBinding(LateBindingTexture.WaterHeight, this.textureMapping[0]);

                this.renderContext.waterList.drawOnPassRenderer(cache, passRenderer);
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

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorGammaTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorGammaTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderInstManager.popTemplate();

        this.prepareToRender(viewerInput);
        this.renderHelper.renderGraph.execute(builder);

        this.renderContext.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (let i = 0; i < this.msbRenderers.length; i++)
            this.msbRenderers[i].destroy(device);
        this.renderContext.textureHolder.destroy(device);
    }
}
