
import { FLVER, VertexInputSemantic, Material, Primitive, Batch, VertexAttribute } from "./flver";
import { GfxDevice, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { coalesceBuffer, GfxCoalescedBuffer } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { makeSortKey, GfxRendererLayer, setSortKeyDepth, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { DDSTextureHolder } from "./dds";
import { nArray, assert, assertExists, leftPad } from "../util";
import { TextureMapping } from "../TextureHolder";
import { mat4, ReadonlyMat4, vec2, vec3, vec4 } from "gl-matrix";
import * as Viewer from "../viewer";
import { Camera, computeViewSpaceDepthFromWorldSpaceAABB, CameraController } from "../Camera";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v, fillVec4, fillVec3v, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { AABB } from "../Geometry";
import { ModelHolder, MaterialDataHolder, DrawParamBank } from "./scenes";
import { MSB, Part } from "./msb";
import { getMatrixAxisZ, getMatrixTranslation, MathConstants, saturate } from "../MathHelpers";
import { MTD, MTDTexture } from './mtd';
import { interactiveVizSliderSelect } from '../DebugJunk';
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { colorNewCopy, White } from "../Color";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";

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
        return GfxFormat.S16_RG;
    case 22:
        // Two sets of UVs -- four shorts.
        return GfxFormat.S16_RGBA;
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
    public inputState: GfxInputState;
    public primitiveIndexCounts: number[] = [];
    public primitiveIndexStarts: number[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, flverData: FLVERData, public batch: Batch, vertexBuffer: GfxCoalescedBuffer, indexBuffers: GfxCoalescedBuffer[], triangleIndexCounts: number[]) {
        const flverInputState = flverData.flver.inputStates[batch.inputStateIndex];
        const flverInputLayout = flverData.flver.inputLayouts[flverInputState.inputLayoutIndex];
        const buffers: GfxVertexBufferDescriptor[] = [vertexBuffer];

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

        const indexBuffer0 = indexBuffers[0];
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer0);

        for (let j = 0; j < batch.primitiveIndexes.length; j++) {
            const coaIndexBuffer = assertExists(indexBuffers.shift());
            this.primitiveIndexCounts.push(assertExists(triangleIndexCounts.shift()));
            this.primitiveIndexStarts.push((coaIndexBuffer.byteOffset - indexBuffer0.byteOffset) / 2);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
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
                const triangleIndexData = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(GfxTopology.TRISTRIP, primitive.indexData.createTypedArray(Uint16Array)));
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

struct HemisphereLight {
    vec4 ColorU;
    vec4 ColorD;
};

struct PointLight {
    vec4 PositionAttenStart;
    vec4 ColorAttenEnd;
};

struct ToneCorrectParams {
    vec4 BrightnessSaturation;
    vec4 ContrastHue;
};

struct FogParams {
    // BeginZ, EndZ
    vec4 Misc;
    // R, G, B, MaxDensity
    vec4 Color;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_WorldFromLocal[1];
    vec4 u_DiffuseMapColor;
    // Fourth element has g_SpecularPower
    vec4 u_SpecularMapColor;
    vec4 u_EnvDifColor;
    vec4 u_EnvSpcColor;
    HemisphereLight u_HemisphereLight;
    PointLight u_PointLights[1];
    ToneCorrectParams u_ToneCorrectParams;
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

    public both = `
precision mediump float;

${DKSProgram.BindingDefinitions}

varying vec4 v_Color;
varying vec2 v_TexCoord[3];
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;
`;

    public vert = `
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

vec3 MulNormalMatrix(Mat4x3 t_Matrix, vec4 t_Value) {
    // Pull out the squared scaling.
    vec3 t_Col0 = Mat4x3GetCol0(t_Matrix);
    vec3 t_Col1 = Mat4x3GetCol1(t_Matrix);
    vec3 t_Col2 = Mat4x3GetCol2(t_Matrix);
    vec4 t_SqScale = vec4(dot(t_Col0, t_Col0), dot(t_Col1, t_Col1), dot(t_Col2, t_Col2), 1.0);
    return normalize(Mul(t_Matrix, t_Value / t_SqScale));
}

void main() {
    vec4 t_PositionWorld = Mul(_Mat4x4(u_WorldFromLocal[0]), vec4(a_Position, 1.0));
    v_PositionWorld = t_PositionWorld.xyz;
    gl_Position = Mul(u_ProjectionView, t_PositionWorld);

    vec3 t_NormalWorld = MulNormalMatrix(u_WorldFromLocal[0], vec4(UNORM_TO_SNORM(a_Normal.xyz), 0.0));
    vec3 t_TangentSWorld = MulNormalMatrix(u_WorldFromLocal[0], vec4(UNORM_TO_SNORM(a_Tangent.xyz), 0.0));

    t_NormalWorld.x *= -1.0;
    t_TangentSWorld.x *= -1.0;

#ifdef HAS_BITANGENT
    vec3 t_TangentTWorld = MulNormalMatrix(u_WorldFromLocal[0], vec4(UNORM_TO_SNORM(a_Bitangent.xyz), 0.0));
#else
    vec3 t_TangentTWorld = normalize(cross(t_NormalWorld, t_TangentSWorld));
#endif

    v_TangentSpaceBasis0 = t_TangentTWorld * sign(UNORM_TO_SNORM(a_Tangent.w));
    v_TangentSpaceBasis1 = t_TangentSWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_Color = a_Color;
    v_TexCoord[0] = ((a_TexCoord0.xy) / 1024.0) + u_TexScroll0.xy;
    v_TexCoord[1] = ((a_TexCoord0.zw) / 1024.0) + u_TexScroll1.xy;
    v_TexCoord[2] = ((a_TexCoord1.xy) / 1024.0) + u_TexScroll2.xy;
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
        return `texture(SAMPLER_2D(u_Texture${texAssign}), v_TexCoord[${texParam.uvNumber}])`;
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
    vec3 t_NormalDirWorld = CalcNormalWorld(t_NormalTangentSpace, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
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
    if (t_LightmapEnabled)
        t_IncomingDiffuseRadiance *= ${this.buildTexAccess(lightmap)}.rgb;
`;
        } else {
            return '';
        }
    }

    private genAlphaTest(): string {
        const blendMode = getBlendMode(this.mtd);

        if (blendMode === BlendMode.TexEdge) {
            return `
    if (t_Color.a < 0.1)
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

vec3 CalcNormalWorld(in vec3 t_MapNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_MapNormal.xxx * t_Basis0 + t_MapNormal.yyy * t_Basis1 + t_MapNormal.zzz * t_Basis2;
}

// https://gamedev.stackexchange.com/a/59808
vec3 RGBtoHSV(in vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 HSVtoRGB(in vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void CalcToneCorrect(inout vec3 t_Color, in ToneCorrectParams t_Params) {
    vec3  t_Brightness = t_Params.BrightnessSaturation.xyz;
    float t_Saturation = t_Params.BrightnessSaturation.w;
    vec3  t_Contrast   = t_Params.ContrastHue.xyz;
    float t_Hue        = t_Params.ContrastHue.w;

    // Apply Brightness and Contrast
    t_Color.rgb = ((t_Color.rgb * t_Brightness.rgb) - vec3(0.5)) * t_Contrast.rgb + vec3(0.5);

    vec3 t_HSV = RGBtoHSV(t_Color);
    t_HSV.x += (t_Hue / 360.0);
    t_HSV.y *= t_Saturation;
    t_Color = HSVtoRGB(t_HSV);
}

void CalcToneMap(inout vec3 t_Color) {
    // Some form of crummy tone mapping to brighten up the image.
    t_Color = t_Color * vec3(1.2) + vec3(0.05);
}

void CalcFog(inout vec3 t_Color, in FogParams t_FogParams, in vec3 t_PositionWorld) {
    float t_FogBeginZ = t_FogParams.Misc.x;
    float t_FogEndZ = t_FogParams.Misc.y;
    vec3 t_FogColor = t_FogParams.Color.rgb;
    float t_FogMaxDensity = t_FogParams.Color.a;

    float t_DistanceWorld = distance(t_PositionWorld.xyz, u_CameraPosWorld.xyz);
    float t_FogFactor = saturate(invlerp(t_FogBeginZ, t_FogEndZ, t_DistanceWorld));
    t_FogFactor = min(t_FogFactor, t_FogMaxDensity);

    t_FogFactor *= t_FogFactor;

    t_Color.rgb = mix(t_Color.rgb, t_FogColor.rgb, t_FogFactor);
}

vec3 CalcReflection(in vec3 t_NormalWorld, in vec3 t_PositionToEye) {
    return (2.0 * (dot(t_NormalWorld, t_PositionToEye)) * t_NormalWorld) - (dot(t_NormalWorld, t_NormalWorld) * t_PositionToEye);
}

vec3 CalcPointLightDiffuse(in PointLight t_PointLight, in vec3 t_PositionWorld, in vec3 t_NormalWorld) {
    vec3 t_LightPosition = t_PointLight.PositionAttenStart.xyz;
    vec3 t_LightColor = t_PointLight.ColorAttenEnd.rgb;
    float t_AttenStart = t_PointLight.PositionAttenStart.w;
    float t_AttenEnd = t_PointLight.ColorAttenEnd.w;

    vec3 t_Delta = t_LightPosition - t_PositionWorld.xyz;
    float t_DistAtten = saturate(invlerp(t_AttenEnd, t_AttenStart, length(t_Delta)));
    float t_DotAtten = saturate(dot(normalize(t_Delta), t_NormalWorld));

    return t_LightColor * t_DistAtten * t_DotAtten;
}

void main() {
    bool t_DiffuseMapEnabled = true;
    bool t_LightmapEnabled = true;

    vec4 t_Color = vec4(1.0);
    float t_Blend = v_Color.a;

    ${this.genDiffuse()}

#ifdef USE_LIGHTING
    vec3 t_OutgoingLight = vec3(0.0);

    vec3 t_IncomingDiffuseRadiance = vec3(0.0);
    vec3 t_IncomingSpecularRadiance = vec3(0.0);

    ${this.genNormalDir()}
    t_NormalDirWorld *= gl_FrontFacing ? 1.0 : -1.0;

    // Environment light.
    t_IncomingDiffuseRadiance += texture(SAMPLER_Cube(u_TextureEnvDif), t_NormalDirWorld).rgb * u_EnvDifColor.rgb;
    // Light map only applies to the environment light.
    ${this.genLightMap()}

    for (int i = 0; i < 1; i++)
        t_IncomingDiffuseRadiance += CalcPointLightDiffuse(u_PointLights[i], v_PositionWorld.xyz, t_NormalDirWorld.xyz);

    // Hemisphere light for ambient.
    float t_DiffuseIntensity = dot(t_NormalDirWorld, vec3(0.0, 1.0, 0.0));
    t_IncomingDiffuseRadiance += mix(u_HemisphereLight.ColorD.rgb, u_HemisphereLight.ColorU.rgb, t_DiffuseIntensity * 0.5 + 0.5);

    /*
    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    vec3 t_Reflection = CalcReflection(t_NormalDirWorld.xyz, t_WorldDirectionToEye);
    // t_IncomingSpecularRadiance += texture(SAMPLER_Cube(u_TextureEnvSpc), t_NormalDirWorld).rgb * u_

    if (t_DiffuseIntensity > 0.0) {
        vec3 t_ReflectanceDir = CalcReflection(t_NormalDirWorld, vec3(0.0, 1.0, 0.0));
        float t_SpecularIntensity = pow(max(dot(t_ReflectanceDir, t_WorldDirectionToEye), 0.0), u_SpecularPower);
        vec3 t_LightColor = vec3(u_HemisphereLight.ColorU.rgb);
        t_IncomingSpecularRadiance += t_LightColor.rgb * t_SpecularIntensity;
    }
    */

    ${this.genSpecular()}

    t_OutgoingLight += t_Diffuse.rgb * t_IncomingDiffuseRadiance;
    t_OutgoingLight += t_Specular * t_IncomingSpecularRadiance;

    t_Color.rgb *= t_OutgoingLight;
    t_Color.a *= t_Diffuse.a;
#else
    t_Color *= t_Diffuse;
#endif

    t_Color *= v_Color;
    ${this.genAlphaTest()}

    CalcToneCorrect(t_Color.rgb, u_ToneCorrectParams);
    CalcToneMap(t_Color.rgb);
    CalcFog(t_Color.rgb, u_FogParams, v_PositionWorld.xyz);

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
    None,
    HemDirDifSpcx3,
    HemEnvDifSpc,
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

        // If this is a Phong shader, then turn on lighting.
        if (mtd.shaderPath.includes('_Phn_')) {
            const lightingType: LightingType = assertExists(getMaterialParam(mtd, 'g_LightingType'))[0];

            if (lightingType !== LightingType.None)
                this.program.defines.set('USE_LIGHTING', '1');
        } else if (mtd.shaderPath.includes('_Lit')) {
            this.program.defines.set('USE_LIGHTING', '1');
        }

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

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4, materialDrawConfig: MaterialDrawConfig): void {
        if (!this.visible)
            return;

        this.textureMapping[8].gfxTexture = materialDrawConfig.envDifTexture.gfxTexture;
        this.textureMapping[9].gfxTexture = materialDrawConfig.envSpc0Texture.gfxTexture;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);
        template.setInputLayoutAndState(this.batchData.inputLayout, this.batchData.inputState);
        template.setMegaStateFlags(this.megaState);

        let offs = template.allocateUniformBuffer(DKSProgram.ub_MeshFragParams, 12*1 + 4*14);
        const d = template.mapUniformBufferF32(DKSProgram.ub_MeshFragParams);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += fillVec3v(d, offs, this.diffuseMapColor);
        offs += fillVec4v(d, offs, this.specularMapColor);
        offs += fillColor(d, offs, materialDrawConfig.envDifColor);
        offs += fillColor(d, offs, materialDrawConfig.envSpcColor);

        offs += materialDrawConfig.hemisphereLight.fill(d, offs);
        for (let i = 0; i < materialDrawConfig.pointLight.length; i++)
            offs += materialDrawConfig.pointLight[i].fill(d, offs);
        offs += materialDrawConfig.toneCorrectParams.fill(d, offs);
        offs += materialDrawConfig.fogParams.fill(d, offs);

        const scrollTime = viewerInput.time / 240;
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[0][0], scrollTime * this.texScroll[0][1],
            scrollTime * this.texScroll[1][0], scrollTime * this.texScroll[1][1],
        );
        offs += fillVec4(d, offs,
            scrollTime * this.texScroll[2][0], scrollTime * this.texScroll[2][1],
        );

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

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

class HemisphereLight {
    public colorU = colorNewCopy(White);
    public colorD = colorNewCopy(White);

    public fill(d: Float32Array, offs: number): number {
        const baseOffs = offs;
        offs += fillColor(d, offs, this.colorU);
        offs += fillColor(d, offs, this.colorD);
        return offs - baseOffs;
    }
}

class PointLight {
    public attenStart = 0;
    public attenEnd = 0;
    public position = vec3.create();
    public color = colorNewCopy(White);

    public fill(d: Float32Array, offs: number): number {
        const baseOffs = offs;
        offs += fillVec3v(d, offs, this.position, this.attenStart);
        this.color.a = this.attenEnd;
        offs += fillColor(d, offs, this.color);
        return offs - baseOffs;
    }
}

class ToneCorrectParams {
    public brightnessSaturation = vec4.create();
    public contrastHue = vec4.create();

    public fill(d: Float32Array, offs: number): number {
        const baseOffs = offs;
        offs += fillVec4v(d, offs, this.brightnessSaturation);
        offs += fillVec4v(d, offs, this.contrastHue);
        return offs - baseOffs;
    }
}

class FogParams {
    public fogBeginZ = 0;
    public fogEndZ = 0;
    public color = colorNewCopy(White);

    public fill(d: Float32Array, offs: number): number {
        const baseOffs = offs;
        offs += fillVec4(d, offs, this.fogBeginZ, this.fogEndZ);
        offs += fillColor(d, offs, this.color);
        return offs - baseOffs;
    }
}

class MaterialDrawConfig {
    public envDifTexture = new TextureMapping();
    public envSpc0Texture = new TextureMapping();
    public envDifColor = colorNewCopy(White);
    public envSpcColor = colorNewCopy(White);

    public hemisphereLight = new HemisphereLight();
    public pointLight = nArray(1, () => new PointLight());
    public toneCorrectParams = new ToneCorrectParams();
    public fogParams = new FogParams();
}

function drawParamBankCalcConfig(dst: MaterialDrawConfig, part: Part, bank: DrawParamBank, textureHolder: DDSTextureHolder): void {
    const lightBank = bank.lightBank;
    const lightID = part.lightID;

    const envDifTexName = `envdif_${part.areaID}_${leftPad('' + lightBank.getS16(lightID, `envDif`), 3)}`;
    textureHolder.fillTextureMapping(dst.envDifTexture, envDifTexName);
    const envDifColorMul = lightBank.getS16(lightID, 'envDif_colA') / 100;
    dst.envDifColor.r = (lightBank.getS16(lightID, 'envDif_colR') / 255) * envDifColorMul;
    dst.envDifColor.g = (lightBank.getS16(lightID, 'envDif_colG') / 255) * envDifColorMul;
    dst.envDifColor.b = (lightBank.getS16(lightID, 'envDif_colB') / 255) * envDifColorMul;
    const envSpc0TexName = `envspc_${part.areaID}_${leftPad('' + lightBank.getS16(lightID, `envSpc_0`), 3)}`;
    textureHolder.fillTextureMapping(dst.envSpc0Texture, envSpc0TexName);
    const envSpcColorMul = lightBank.getS16(lightID, 'envSpc_colA') / 100;
    dst.envSpcColor.r = (lightBank.getS16(lightID, 'envSpc_colR') / 255) * envSpcColorMul;
    dst.envSpcColor.g = (lightBank.getS16(lightID, 'envSpc_colG') / 255) * envSpcColorMul;
    dst.envSpcColor.b = (lightBank.getS16(lightID, 'envSpc_colB') / 255) * envSpcColorMul;

    const dstHemi = dst.hemisphereLight;
    const colorUMul = lightBank.getS16(lightID, 'colA_u') / 100;
    dstHemi.colorU.r = (lightBank.getS16(lightID, 'colR_u') / 255) * colorUMul;
    dstHemi.colorU.g = (lightBank.getS16(lightID, 'colG_u') / 255) * colorUMul;
    dstHemi.colorU.b = (lightBank.getS16(lightID, 'colB_u') / 255) * colorUMul;
    const colorDMul = lightBank.getS16(lightID, 'colA_d') / 100;
    dstHemi.colorD.r = (lightBank.getS16(lightID, 'colR_d') / 255) * colorDMul;
    dstHemi.colorD.g = (lightBank.getS16(lightID, 'colG_d') / 255) * colorDMul;
    dstHemi.colorD.b = (lightBank.getS16(lightID, 'colB_d') / 255) * colorDMul;

    const toneCorrectBank = bank.toneCorrectBank;
    const toneCorrectID = part.toneCorrectID;
    const dstTone = dst.toneCorrectParams;
    dstTone.brightnessSaturation[0] = toneCorrectBank.getF32(toneCorrectID, 'brightnessR');
    dstTone.brightnessSaturation[1] = toneCorrectBank.getF32(toneCorrectID, 'brightnessG');
    dstTone.brightnessSaturation[2] = toneCorrectBank.getF32(toneCorrectID, 'brightnessB');
    dstTone.brightnessSaturation[3] = toneCorrectBank.getF32(toneCorrectID, 'saturation');
    dstTone.contrastHue[0] = toneCorrectBank.getF32(toneCorrectID, 'contrastR');
    dstTone.contrastHue[1] = toneCorrectBank.getF32(toneCorrectID, 'contrastG');
    dstTone.contrastHue[2] = toneCorrectBank.getF32(toneCorrectID, 'contrastB');
    dstTone.contrastHue[3] = toneCorrectBank.getF32(toneCorrectID, 'hue');

    const fogBank = bank.fogBank;
    const fogID = part.fogID;
    const dstFog = dst.fogParams;
    dstFog.fogBeginZ = fogBank.getS16(fogID, `fogBeginZ`);
    dstFog.fogEndZ = fogBank.getS16(fogID, `fogEndZ`);
    const fogColorMul = fogBank.getS16(fogID, `colA`) / 100;
    dstFog.color.r = (fogBank.getS16(fogID, `colR`) / 255) * fogColorMul;
    dstFog.color.g = (fogBank.getS16(fogID, `colG`) / 255) * fogColorMul;
    dstFog.color.b = (fogBank.getS16(fogID, `colB`) / 255) * fogColorMul;
    dstFog.color.a = saturate(fogBank.getS16(fogID, `degRotW`) / 100);

    const pointLightBank = bank.pointLightBank;
    const lanternID = part.lanternID;
    const dstLantern = dst.pointLight[0];
    dstLantern.attenStart = pointLightBank.getF32(lanternID, `dwindleBegin`);
    dstLantern.attenEnd = pointLightBank.getF32(lanternID, `dwindleEnd`);
    const lanternColorMul = pointLightBank.getS16(lanternID, `colA`) / 100;
    dstLantern.color.r = (pointLightBank.getS16(lanternID, `colR`) / 255) * lanternColorMul;
    dstLantern.color.g = (pointLightBank.getS16(lanternID, `colG`) / 255) * lanternColorMul;
    dstLantern.color.b = (pointLightBank.getS16(lanternID, `colB`) / 255) * lanternColorMul;
}

const bboxScratch = new AABB();
export class PartInstance {
    private batchInstances: BatchInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;
    public materialDrawConfig = new MaterialDrawConfig();

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: DDSTextureHolder, materialDataHolder: MaterialDataHolder, drawParamBank: DrawParamBank, public flverData: FLVERData, public part: Part) {
        drawParamBankCalcConfig(this.materialDrawConfig, this.part, drawParamBank, textureHolder);

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

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        getMatrixTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
        getMatrixAxisZ(scratchVec3b, viewerInput.camera.worldMatrix);
        vec3.scaleAndAdd(this.materialDrawConfig.pointLight[0].position, scratchVec3a, scratchVec3b, -2);

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(renderInstManager, viewerInput, this.modelMatrix, this.materialDrawConfig);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.clipFromWorldMatrix);
    getMatrixTranslation(scratchVec3a, camera.worldMatrix);
    offs += fillVec3v(d, offs, scratchVec3a);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 10 },
];

function modelMatrixFromPart(m: mat4, part: Part): void {
    // Game uses +x = left convention for some reason.
    mat4.scale(m, m, [-1, 1, 1]);

    mat4.translate(m, m, part.translation);
    mat4.rotateX(m, m, part.rotation[0] * MathConstants.DEG_TO_RAD);
    mat4.rotateY(m, m, part.rotation[1] * MathConstants.DEG_TO_RAD);
    mat4.rotateZ(m, m, part.rotation[2] * MathConstants.DEG_TO_RAD);
    mat4.scale(m, m, part.scale);
}

export class MSBRenderer {
    public flverInstances: PartInstance[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, private textureHolder: DDSTextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private drawParamBank: DrawParamBank, private msb: MSB) {
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
            }
        }
    }

    private lodModels: string[] = [];
    public chooseLODModel(): void {
        interactiveVizSliderSelect(this.flverInstances, 'visible', (instance) => {
            this.lodModels.push(instance.name);
            setTimeout(() => { instance.visible = false; }, 2000);

            this.chooseLODModel();
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const offs = template.allocateUniformBuffer(DKSProgram.ub_SceneParams, 16+4);
        const sceneParamsMapped = template.mapUniformBufferF32(DKSProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.modelHolder.destroy(device);
    }
}
