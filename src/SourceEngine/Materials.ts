
import { VMT, parseVMT, vmtParseVector, VKFParamMap } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { nArray, assert, assertExists, nullify } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCullMode, GfxCompareMode, GfxTextureDimension, GfxTextureUsage, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3, ReadonlyMat4, ReadonlyVec3, vec2, vec4 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v, fillMatrix4x2, fillColor, fillVec3v, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceRenderContext, SourceFileSystem, SourceEngineView, BSPRenderer, SourceEngineViewType } from "./Main";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { SurfaceLightmapData, LightmapPacker, LightmapPackerPage, Cubemap, BSPFile, AmbientCube, WorldLight, WorldLightType, BSPLeaf, WorldLightFlags } from "./BSPFile";
import { MathConstants, invlerp, lerp, clamp, Vec3Zero, Vec3UnitX, Vec3NegX, Vec3UnitY, Vec3NegY, Vec3UnitZ, Vec3NegZ, scaleMatrix, saturate } from "../MathHelpers";
import { colorNewCopy, White, Color, colorCopy, colorScaleAndAdd, colorFromRGBA, colorNewFromRGBA, TransparentBlack, colorScale, OpaqueBlack } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/GfxShaderLibrary";
import { IS_DEPTH_REVERSED } from "../gfx/helpers/ReversedDepthHelpers";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { dfRange, dfShow } from "../DebugFloaters";
import { AABB } from "../Geometry";
import { GfxrResolveTextureID } from "../gfx/render/GfxRenderGraph";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers";
import { UberShaderInstanceBasic, UberShaderTemplateBasic } from "./UberShader";
import { makeSolidColorTexture2D } from "../gfx/helpers/TextureHelpers";
import { ParticleSystemCache } from "./ParticleSystem";
import { HitInfo } from "../SuperMarioGalaxy/Collision";

//#region Base Classes
const scratchColor = colorNewCopy(White);
const textureMappings = nArray(15, () => new TextureMapping());

const RGBM_SCALE = 6.0;

function resetTextureMappings(m: TextureMapping[]): void {
    for (let i = 0; i < m.length; i++)
        m[i].reset();
}

export const enum StaticLightingMode {
    None,
    StudioVertexLighting,
    StudioVertexLighting3,
    StudioAmbientCube,
}

export const enum SkinningMode {
    None,
    Rigid,
    Smooth,
};

export const enum LateBindingTexture {
    Camera              = `camera`,
    FramebufferColor    = `framebuffer-color`,
    FramebufferDepth    = `framebuffer-depth`,
    WaterReflection     = `water-reflection`,
    ProjectedLightDepth = `projected-light-depth`,
}

// https://github.com/ValveSoftware/source-sdk-2013/blob/master/sp/src/public/const.h#L340-L387
export const enum RenderMode {
    Normal = 0,
    TransColor,
    TransTexture,
    Glow,
    TransAlpha,
    TransAdd,
    Environmental,
    TransAddFrameBlend,
    TransAddAlphaAdd,
    WorldGlow,
    None,
}

export class FogParams {
    public color: Color;
    public start: number = 0;
    public end: number = 0;
    public maxdensity: number = 0;

    constructor(color: Color = White) {
        this.color = colorNewCopy(color);
    }

    public copy(o: FogParams): void {
        colorCopy(this.color, o.color);
        this.start = o.start;
        this.end = o.end;
        this.maxdensity = o.maxdensity;
    }
}

export class MaterialShaderTemplateBase extends UberShaderTemplateBasic {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TangentS = 2;
    public static a_TexCoord01 = 4;
    public static a_Color = 5;
    public static a_StaticVertexLighting0 = 6;
    public static a_StaticVertexLighting1 = 7;
    public static a_StaticVertexLighting2 = 8;
    public static a_BoneWeights = 9;
    public static a_BoneIDs = 10;

    public static ub_SceneParams = 0;
    public static ub_SkinningParams = 1;

    public static MaxSkinningParamsBoneMatrix = 53;

    public static Common = `
// Debug utilities.
// #define DEBUG_DIFFUSEONLY 1
// #define DEBUG_FULLBRIGHT 1

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_SceneMisc[3];
};

layout(std140) uniform ub_SkinningParams {
#if SKINNING_MODE == ${SkinningMode.Smooth}
    Mat4x3 u_BoneMatrix[${MaterialShaderTemplateBase.MaxSkinningParamsBoneMatrix}];
#else
    Mat4x3 u_ModelMatrix;
#endif
};

#define u_CameraPosWorld (u_SceneMisc[0].xyz)
#define u_ToneMapScale   (u_SceneMisc[0].w)

#define u_FogColor       (u_SceneMisc[1].xyz)

#define u_FogStart       (u_SceneMisc[2].x)
#define u_FogEnd         (u_SceneMisc[2].y)
#define u_FogMaxDensity  (u_SceneMisc[2].z)

// NOTE(jstpierre): This appears to be 16.0 in the original engine, because they used to use a 4.12
// 16-bit 4.12 fixed point format for environment maps. When encountering an R16G16B16A16F texture,
// it will effectively divide by 16.0 when loading the texture. We don't do that, so we don't need
// any scale here. If we ever encounter an integer texture, we might need to do that...
const float g_EnvmapScale = 1.0;

// Utilities.
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}
${GfxShaderLibrary.CalcScaleBias}

vec3 CalcReflection(in vec3 t_NormalWorld, in vec3 t_PositionToEye) {
    return (2.0 * (dot(t_NormalWorld, t_PositionToEye)) * t_NormalWorld) - (dot(t_NormalWorld, t_NormalWorld) * t_PositionToEye);
}

vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_TangentNormal.xxx * t_Basis0 + t_TangentNormal.yyy * t_Basis1 + t_TangentNormal.zzz * t_Basis2;
}

vec3 CalcWorldToTangent(in vec3 t_WorldNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return vec3(dot(t_WorldNormal.xyz, t_Basis0), dot(t_WorldNormal.xyz, t_Basis1), dot(t_WorldNormal.xyz, t_Basis2));
}

float CalcFresnelTerm5(float t_DotProduct) {
    return pow(1.0 - max(0.0, t_DotProduct), 5.0);
}

float CalcFresnelTerm4(float t_DotProduct) {
    return pow(1.0 - max(0.0, t_DotProduct), 4.0);
}

float CalcFresnelTerm2(float t_DotProduct) {
    return pow(1.0 - max(0.0, t_DotProduct), 2.0);
}

float CalcFresnelTerm2Ranges(float t_DotProduct, in vec3 t_Ranges) {
    // CalcFresnelTermRanges uses exponent 2.0, rather than Shlicke's 5.0.
    float t_Fresnel = CalcFresnelTerm2(t_DotProduct);
    if (t_Fresnel <= 0.5)
        return mix(t_Ranges.x, t_Ranges.y, invlerp(0.0, 0.5, t_Fresnel));
    else
        return mix(t_Ranges.y, t_Ranges.z, invlerp(0.5, 1.0, t_Fresnel));
}

vec4 UnpackUnsignedNormalMap(in vec4 t_NormalMapSample) {
    t_NormalMapSample.rgb = t_NormalMapSample.rgb * 2.0 - 1.0;
    return t_NormalMapSample;
}

// For vertex colors and other places without native sRGB data.
vec3 GammaToLinear(in vec3 t_Color) {
    return pow(t_Color, vec3(2.2));
}

void CalcFog(inout vec4 t_Color, in vec3 t_PositionWorld) {
#if defined USE_FOG
    float t_DistanceWorld = distance(t_PositionWorld.xyz, u_CameraPosWorld.xyz);
    float t_FogFactor = saturate(invlerp(u_FogStart, u_FogEnd, t_DistanceWorld));
    t_FogFactor = min(t_FogFactor, u_FogMaxDensity);

    // Square the fog factor to better approximate fixed-function HW (which happens all in clip space)
    t_FogFactor *= t_FogFactor;

    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, t_FogFactor);
#endif
}

vec4 DebugColorTexture(in vec4 t_TextureSample) {
#if defined DEBUG_DIFFUSEONLY
    t_TextureSample.rgb = vec3(0.5);
#endif

    return t_TextureSample;
}

vec3 SampleLightmapTexture(in vec4 t_TextureSample) {
#if defined DEBUG_FULLBRIGHT
    return vec3(1.0);
#endif

    return t_TextureSample.rgb * t_TextureSample.a * ${glslGenerateFloat(RGBM_SCALE)};
}

#if defined VERT
layout(location = ${MaterialShaderTemplateBase.a_Position}) in vec3 a_Position;
layout(location = ${MaterialShaderTemplateBase.a_Normal}) in vec4 a_Normal;
layout(location = ${MaterialShaderTemplateBase.a_TangentS}) in vec4 a_TangentS;
layout(location = ${MaterialShaderTemplateBase.a_TexCoord01}) in vec4 a_TexCoord01;
#if defined USE_VERTEX_COLOR
layout(location = ${MaterialShaderTemplateBase.a_Color}) in vec4 a_Color;
#endif
#if defined USE_STATIC_VERTEX_LIGHTING
layout(location = ${MaterialShaderTemplateBase.a_StaticVertexLighting0}) in vec3 a_StaticVertexLighting0;
#if defined USE_STATIC_VERTEX_LIGHTING_3
layout(location = ${MaterialShaderTemplateBase.a_StaticVertexLighting1}) in vec3 a_StaticVertexLighting1;
layout(location = ${MaterialShaderTemplateBase.a_StaticVertexLighting2}) in vec3 a_StaticVertexLighting2;
#endif
#endif
#if SKINNING_MODE == ${SkinningMode.Smooth}
layout(location = ${MaterialShaderTemplateBase.a_BoneWeights}) in vec4 a_BoneWeights;
layout(location = ${MaterialShaderTemplateBase.a_BoneIDs}) in vec4 a_BoneIndices;
#endif

Mat4x3 CalcWorldFromLocalMatrix() {
#if SKINNING_MODE == ${SkinningMode.Smooth}
    // Calculate our per-vertex position.
    Mat4x3 t_WorldFromLocalMatrix = _Mat4x3(0.0);

    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.x)], a_BoneWeights.x);
    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.y)], a_BoneWeights.y);
    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.z)], a_BoneWeights.z);
    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.w)], a_BoneWeights.w);

    return t_WorldFromLocalMatrix;
#else
    return u_ModelMatrix;
#endif
}
#endif

#if defined FRAG
layout(location = 0) out vec4 o_Color0;

void OutputLinearColor(in vec4 t_Color) {
    // Simple tone mapping.
    t_Color.rgb *= u_ToneMapScale;

    o_Color0.rgba = t_Color.rgba;
}
#endif
`;
}

export class ToneMapParams {
    @dfShow()
    @dfRange(0.0, 16.0)
    public toneMapScale = 1.0;

    public autoExposureMin = 0.5;
    public autoExposureMax = 2.0;
    public percentBrightPixels = 0.02;
    public percentTarget = 0.60;
    public minAvgLum = 0.03;
    public adjustRate = 1.0;
    public accelerateDownRate = 3.0;
    public bloomScale = 1.0;
    public bloomTint = colorNewFromRGBA(0.3, 0.59, 0.11);
    public bloomExp = 2.2;

    public copySettings(o: ToneMapParams): void {
        this.autoExposureMin = o.autoExposureMin;
        this.autoExposureMax = o.autoExposureMax;
        this.percentBrightPixels = o.percentBrightPixels;
        this.percentTarget = o.percentTarget;
        this.minAvgLum = o.minAvgLum;
        this.adjustRate = o.adjustRate;
        this.accelerateDownRate = o.accelerateDownRate;
        this.bloomScale = o.bloomScale;
    }
}

function fillSceneParams(d: Float32Array, offs: number, view: Readonly<SourceEngineView>, toneMapParams: Readonly<ToneMapParams>, fogParams: Readonly<FogParams>): number {
    const baseOffs = offs;
    offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);
    offs += fillVec3v(d, offs, view.cameraPos, toneMapParams.toneMapScale);
    offs += fillGammaColor(d, offs, fogParams.color);
    offs += fillVec4(d, offs, fogParams.start, fogParams.end, fogParams.maxdensity);
    return offs - baseOffs;
}

function fillScaleBias(d: Float32Array, offs: number, m: ReadonlyMat4): number {
    // Make sure there's no rotation. We should definitely handle this eventually, though.
    assert(m[1] === 0.0 && m[2] === 0.0);
    const scaleS = m[0];
    const scaleT = m[5];
    const transS = m[12];
    const transT = m[13];
    return fillVec4(d, offs, scaleS, scaleT, transS, transT);
}

export function fillSceneParamsOnRenderInst(renderInst: GfxRenderInst, view: Readonly<SourceEngineView>, toneMapParams: Readonly<ToneMapParams>, fogParams: Readonly<FogParams> = view.fogParams): void {
    let offs = renderInst.allocateUniformBuffer(MaterialShaderTemplateBase.ub_SceneParams, 28);
    const d = renderInst.mapUniformBufferF32(MaterialShaderTemplateBase.ub_SceneParams);
    fillSceneParams(d, offs, view, toneMapParams, fogParams);
}

interface Parameter {
    parse(S: string): void;
    index(i: number): Parameter | null;
    set(param: Parameter): void;
}

class ParameterTexture {
    public texture: VTF | null = null;

    constructor(public isSRGB: boolean = false, public isEnvmap: boolean = false, public ref: string | null = null) {
    }

    public parse(S: string): void {
        this.ref = S;
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }

    public async fetch(materialCache: MaterialCache, entityParams: EntityMaterialParameters | null): Promise<void> {
        if (this.ref !== null) {
            // Special case env_cubemap if we have a local override.
            let filename = this.ref;

            if (this.isEnvmap) {
                // Dynamic cubemaps.
                if (filename.toLowerCase() === 'env_cubemap' && entityParams !== null && entityParams.lightCache !== null && entityParams.lightCache.envCubemap !== null) {
                    filename = entityParams.lightCache.envCubemap.filename;
                } else if (materialCache.isUsingHDR()) {
                    const hdrFilename = `${filename}.hdr`;
                    if (materialCache.checkVTFExists(hdrFilename))
                        filename = hdrFilename;
                    else if (!materialCache.checkVTFExists(filename))
                        debugger;
                }
            }

            this.texture = await materialCache.fetchVTF(filename, this.isSRGB);
        }
    }

    public fillTextureMapping(m: TextureMapping, frame: number): boolean {
        if (this.texture !== null) {
            this.texture.fillTextureMapping(m, frame);
            return true;
        } else {
            return false;
        }
    }
}

class ParameterString {
    constructor(public value: string = '') {
    }

    public parse(S: string): void {
        this.value = S;
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }
}

class ParameterNumber {
    constructor(public value: number, private dynamic: boolean = true) {
    }

    public parse(S: string): void {
        // Numbers and vectors are the same thing inside the Source engine, where numbers just are the first value in a vector.
        const v = vmtParseVector(S);
        this.value = v[0];
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        assert(param instanceof ParameterNumber);
        assert(this.dynamic);
        this.value = param.value;
    }
}

class ParameterBoolean extends ParameterNumber {
    constructor(value: boolean, dynamic: boolean = true) {
        super(value ? 1 : 0, dynamic);
    }

    public getBool(): boolean {
        return !!this.value;
    }
}

function findall(haystack: string, needle: RegExp): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    while (true) {
        const result = needle.exec(haystack);
        if (!result)
            break;
        results.push(result);
    }
    return results;
}

const scratchMat4a = mat4.create();
class ParameterMatrix {
    public matrix = mat4.create();

    public setMatrix(cx: number, cy: number, sx: number, sy: number, r: number, tx: number, ty: number): void {
        mat4.identity(this.matrix);
        this.matrix[12] = -cx;
        this.matrix[13] = -cy;
        this.matrix[0] = sx;
        this.matrix[5] = sy;
        mat4.fromZRotation(scratchMat4a, MathConstants.DEG_TO_RAD * r);
        mat4.mul(this.matrix, scratchMat4a, this.matrix);
        mat4.identity(scratchMat4a);
        scratchMat4a[12] = cx + tx;
        scratchMat4a[13] = cy + ty;
        mat4.mul(this.matrix, scratchMat4a, this.matrix);
    }

    public parse(S: string): void {
        // "center {} {} scale {} {} rotate {} translate {} {}"
        const sections = findall(S, /([a-z]+) ([^a-z]+)/g);

        let cx = 0, cy = 0, sx = 1, sy = 1, r = 0, tx = 0, ty = 0;
        sections.forEach(([str, mode, items]) => {
            let values = items.split(' ').map((v) => parseFloat(v));
            if (values[1] === undefined)
                values[1] = values[0];

            if (mode === 'center') {
                cx = values[0];
                cy = values[1];
            } else if (mode === 'scale') {
                sx = values[0];
                sy = values[1];
            } else if (mode === 'rotate') {
                r = values[0];
            } else if (mode === 'translate') {
                tx = values[0];
                ty = values[1];
            }
        });

        this.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        throw "whoops";
    }
}

class ParameterVector {
    public internal: ParameterNumber[];

    constructor(length: number, values: number[] | null = null) {
        this.internal = nArray(length, (i) => new ParameterNumber(values !== null ? values[i] : 0));
    }

    public setArray(v: readonly number[] | Float32Array): void {
        assert(this.internal.length === v.length);
        for (let i = 0; i < this.internal.length; i++)
            this.internal[i].value = v[i];
    }

    public parse(S: string): void {
        const numbers = vmtParseVector(S);
        if (this.internal.length === 0)
            this.internal.length = numbers.length;
        for (let i = 0; i < this.internal.length; i++)
            this.internal[i] = new ParameterNumber(i > numbers.length - 1 ? numbers[0] : numbers[i]);
    }

    public index(i: number): ParameterNumber | null {
        return nullify(this.internal[i]);
    }

    public set(param: Parameter): void {
        if (param instanceof ParameterVector) {
            this.internal[0].value = param.internal[0].value;
            this.internal[1].value = param.internal[1].value;
            this.internal[2].value = param.internal[2].value;
        } else if (param instanceof ParameterNumber) {
            this.internal[0].value = param.value;
            this.internal[1].value = param.value;
            this.internal[2].value = param.value;
        } else {
            throw "whoops";
        }
    }

    public fillColor(c: Color, a: number): void {
        colorFromRGBA(c, this.internal[0].value, this.internal[1].value, this.internal[2].value, a);
    }

    public setFromColor(c: Color): void {
        this.internal[0].value = c.r;
        this.internal[1].value = c.g;
        this.internal[2].value = c.b;
    }

    public mulColor(c: Color): void {
        assert(this.internal.length === 3);
        c.r *= this.internal[0].value;
        c.g *= this.internal[1].value;
        c.b *= this.internal[2].value;
    }

    public get(i: number): number {
        return this.internal[i].value;
    }
}

class ParameterColor extends ParameterVector {
    constructor(r: number, g: number = r, b: number = r) {
        super(3);
        this.internal[0].value = r;
        this.internal[1].value = g;
        this.internal[2].value = b;
    }
}

function createParameterAuto(value: any): Parameter | null {
    if (typeof value === 'string') {
        const S = value;
        const n = Number(S);
        if (!Number.isNaN(n))
            return new ParameterNumber(n);

        // Try Vector
        if (S.startsWith('[') || S.startsWith('{')) {
            const v = new ParameterVector(0);
            v.parse(S);
            return v;
        }

        if (S.startsWith('center')) {
            const v = new ParameterMatrix();
            v.parse(S);
            return v;
        }

        const v = new ParameterString();
        v.parse(S);
        return v;
    }

    return null;
}

function parseKey(key: string, defines: string[]): string | null {
    const question = key.indexOf('?');
    if (question >= 0) {
        let define = key.slice(0, question);

        let negate = false;
        if (key.charAt(0) === '!') {
            define = define.slice(1);
            negate = true;
        }

        let isValid = defines.includes(define);
        if (negate)
            isValid = !isValid;

        if (!isValid)
            return null;

        key = key.slice(question + 1);
    }

    return key;
}

function setupParametersFromVMT(param: ParameterMap, vmt: VMT, defines: string[]): void {
    for (const vmtKey in vmt) {
        const destKey = parseKey(vmtKey, defines);
        if (destKey === null)
            continue;
        if (!destKey.startsWith('$'))
            continue;

        const value = vmt[vmtKey];
        if (destKey in param) {
            // Easy case -- existing parameter.
            param[destKey].parse(value as string);
        } else {
            // Hard case -- auto-detect type from string.
            const p = createParameterAuto(value);
            if (p !== null) {
                param[destKey] = p;
            } else {
                console.warn("Could not parse parameter", destKey, value);
            }
        }
    }
}

export class EntityMaterialParameters {
    public position = vec3.create();
    public animationStartTime = 0;
    public textureFrameIndex = 0;
    public blendColor = colorNewCopy(White);
    public lightCache: LightCache | null = null;
    public randomNumber = Math.random();
}

const enum AlphaBlendMode {
    None, Blend, Add, Glow,
}

function fillGammaColor(d: Float32Array, offs: number, c: Color, a: number = c.a): number {
    d[offs++] = gammaToLinear(c.r);
    d[offs++] = gammaToLinear(c.g);
    d[offs++] = gammaToLinear(c.b);
    d[offs++] = a;
    return 4;
}

const blackFogParams = new FogParams(TransparentBlack);
const noToneMapParams = new ToneMapParams();

export abstract class BaseMaterial {
    private visible = true;
    public hasVertexColorInput = true;
    public wantsLightmap = false;
    public wantsBumpmappedLightmap = false;
    public wantsTexCoord0Scale = false;
    public isTranslucent = false;
    public isIndirect = false;
    public isToolMaterial = false;
    public param: ParameterMap = {};
    public entityParams: EntityMaterialParameters | null = null;
    public skinningMode = SkinningMode.None;
    public representativeTexture: VTF | null = null;

    protected loaded = false;
    protected proxyDriver: MaterialProxyDriver | null = null;
    protected texCoord0Scale = vec2.create();
    protected isAdditive = false;
    protected isToneMapped = true;

    constructor(public vmt: VMT) {
        this.initParameters();
    }

    public async init(renderContext: SourceRenderContext) {
        this.setupParametersFromVMT(renderContext);
        if (this.vmt.proxies !== undefined)
            this.proxyDriver = renderContext.materialProxySystem.createProxyDriver(this, this.vmt.proxies);

        this.initStaticBeforeResourceFetch();
        await this.fetchResources(renderContext.materialCache);
        this.initStatic(renderContext.materialCache);
    }

    public isMaterialLoaded(): boolean {
        return this.loaded;
    }

    public isMaterialVisible(renderContext: SourceRenderContext): boolean {
        if (!this.visible)
            return false;

        if (!this.isMaterialLoaded())
            return false;

        if (this.isToolMaterial && !renderContext.showToolMaterials)
            return false;

        if (this.paramGetBoolean('$decal') && !renderContext.showDecalMaterials)
            return false;

        if (renderContext.currentView.viewType === SourceEngineViewType.ShadowMap) {
            if (this.isTranslucent)
                return false;
        }

        return true;
    }

    public setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        // Nothing by default.
    }

    public paramSetColor(name: string, c: Color): void {
        (this.param[name] as ParameterColor).setFromColor(c);
    }

    public paramSetNumber(name: string, v: number): void {
        (this.param[name] as ParameterNumber).value = v;
    }

    public getNumFrames(): number {
        if (this.representativeTexture !== null)
            return this.representativeTexture.numFrames;
        else
            return 1;
    }

    private findFallbackBlock(shaderTypeName: string, materialDefines: string[]): any | null {
        for (let i = 0; i < materialDefines.length; i++) {
            const suffix = materialDefines[i];
            let block: any;

            block = this.vmt[suffix];
            if (block !== undefined)
                return block;

            block = this.vmt[`${shaderTypeName}_${suffix}`];
            if (block !== undefined)
                return block;
        }

        return null;
    }

    private setupParametersFromVMT(renderContext: SourceRenderContext): void {
        const materialDefines = renderContext.materialCache.materialDefines;

        setupParametersFromVMT(this.param, this.vmt, materialDefines);

        const shaderTypeName = this.vmt._Root.toLowerCase();
        const fallback = this.findFallbackBlock(shaderTypeName, materialDefines);
        if (fallback !== null)
            setupParametersFromVMT(this.param, fallback, materialDefines);
    }

    public paramGetString(name: string): string {
        return (this.param[name] as ParameterString).value;
    }

    protected paramGetTexture(name: string): ParameterTexture {
        return (this.param[name] as ParameterTexture);
    }

    protected paramGetVTF(name: string): VTF | null {
        return this.paramGetTexture(name).texture;
    }

    protected paramGetBoolean(name: string): boolean {
        return (this.param[name] as ParameterBoolean).getBool();
    }

    protected paramGetNumber(name: string): number {
        return (this.param[name] as ParameterNumber).value;
    }

    public paramGetInt(name: string): number {
        return this.paramGetNumber(name) | 0;
    }

    public paramGetVector(name: string): ParameterVector {
        return (this.param[name] as ParameterVector);
    }

    protected paramGetMatrix(name: string): ReadonlyMat4 {
        return (this.param[name] as ParameterMatrix).matrix;
    }

    protected paramGetFlipY(renderContext: SourceRenderContext, name: string): boolean {
        if (!renderContext.materialCache.deviceNeedsFlipY)
            return false;

        const vtf = this.paramGetVTF(name);
        if (vtf === null)
            return false;

        return vtf.lateBinding !== null;
    }

    protected paramFillVector4(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterVector).internal;
        assert(m.length === 4);
        return fillVec4(d, offs, m[0].value, m[1].value, m[2].value, m[3].value);
    }

    protected paramFillScaleBias(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        // Make sure there's no rotation. We should definitely handle this eventually, though.
        assert(m[1] === 0.0 && m[2] === 0.0);
        let scaleS = m[0] * this.texCoord0Scale[0];
        let scaleT = m[5] * this.texCoord0Scale[1];
        const transS = m[12];
        const transT = m[13];
        return fillVec4(d, offs, scaleS, scaleT, transS, transT);
    }

    protected paramFillTextureMatrix(d: Float32Array, offs: number, name: string, flipY: boolean = false, extraScale: number = 1.0): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        mat4.copy(scratchMat4a, m);
        if (extraScale !== 1.0)
            scaleMatrix(scratchMat4a, scratchMat4a, extraScale);
        scaleMatrix(scratchMat4a, scratchMat4a, this.texCoord0Scale[0], this.texCoord0Scale[1]);
        if (flipY) {
            scratchMat4a[5] *= -1;
            scratchMat4a[13] += 2;
        }
        return fillMatrix4x2(d, offs, scratchMat4a);
    }

    protected paramFillGammaColor(d: Float32Array, offs: number, name: string, alpha: number = 1.0): number {
        this.paramGetVector(name).fillColor(scratchColor, alpha);
        return fillGammaColor(d, offs, scratchColor);
    }

    protected paramFillColor(d: Float32Array, offs: number, name: string, alpha: number = 1.0): number {
        this.paramGetVector(name).fillColor(scratchColor, alpha);
        return fillColor(d, offs, scratchColor);
    }

    protected vtfIsIndirect(vtf: VTF): boolean {
        // These bindings only get resolved in indirect passes...
        if (vtf.lateBinding === LateBindingTexture.FramebufferColor)
            return true;
        if (vtf.lateBinding === LateBindingTexture.FramebufferDepth)
            return true;
        if (vtf.lateBinding === LateBindingTexture.WaterReflection)
            return true;

        return false;
    }

    protected textureIsIndirect(name: string): boolean {
        const vtf = this.paramGetVTF(name);

        if (vtf !== null && this.vtfIsIndirect(vtf))
            return true;

        return false;
    }

    protected textureIsTranslucent(name: string): boolean {
        const texture = this.paramGetVTF(name);

        if (texture === null)
            return false;

        if (texture === this.paramGetVTF('$basetexture')) {
            // Special consideration.
            if (this.paramGetBoolean('$opaquetexture'))
                return false;
            if (this.paramGetBoolean('$selfillum') || this.paramGetBoolean('$basealphaenvmapmask'))
                return false;
            if (!(this.paramGetBoolean('$translucent') || this.paramGetBoolean('$alphatest')))
                return false;
        }

        return texture.isTranslucent();
    }

    protected setSkinningMode(p: UberShaderInstanceBasic): void {
        p.setDefineString('SKINNING_MODE', '' + this.skinningMode);
    }

    protected setFogMode(p: UberShaderInstanceBasic): void {
        p.setDefineBool('USE_FOG', !this.paramGetBoolean('$nofog'));
    }

    protected setCullMode(megaStateFlags: Partial<GfxMegaStateDescriptor>): void {
        megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.paramGetBoolean('$nocull'))
            megaStateFlags.cullMode = GfxCullMode.None;
    }

    protected setAlphaBlendMode(megaStateFlags: Partial<GfxMegaStateDescriptor>, alphaBlendMode: AlphaBlendMode): void {
        if (alphaBlendMode === AlphaBlendMode.Glow) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            });
            megaStateFlags.depthWrite = false;
            this.isAdditive = true;
            this.isTranslucent = true;
        } else if (alphaBlendMode === AlphaBlendMode.Blend) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            megaStateFlags.depthWrite = false;
            this.isTranslucent = true;
        } else if (alphaBlendMode === AlphaBlendMode.Add) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.One,
            });
            megaStateFlags.depthWrite = false;
            this.isAdditive = true;
            this.isTranslucent = true;
        } else if (alphaBlendMode === AlphaBlendMode.None) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero,
            });
            megaStateFlags.depthWrite = true;
            this.isTranslucent = false;
        } else {
            throw "whoops";
        }
    }

    protected getAlphaBlendMode(isTextureTranslucent: boolean): AlphaBlendMode {
        let isTranslucent = isTextureTranslucent;

        if (this.paramGetBoolean('$vertexalpha'))
            isTranslucent = true;

        if (isTranslucent && this.paramGetBoolean('$additive'))
            return AlphaBlendMode.Glow;
        else if (this.paramGetBoolean('$additive'))
            return AlphaBlendMode.Add;
        else if (isTranslucent)
            return AlphaBlendMode.Blend;
        else
            return AlphaBlendMode.None;
    }

    protected initParameters(): void {
        const p = this.param;

        // Material vars
        p['$selfillum']                    = new ParameterBoolean(false, false);
        p['$additive']                     = new ParameterBoolean(false, false);
        p['$alphatest']                    = new ParameterBoolean(false, false);
        p['$translucent']                  = new ParameterBoolean(false, false);
        p['$basealphaenvmapmask']          = new ParameterBoolean(false, false);
        p['$normalmapalphaenvmapmask']     = new ParameterBoolean(false, false);
        p['$opaquetexture']                = new ParameterBoolean(false, false);
        p['$vertexcolor']                  = new ParameterBoolean(false, false);
        p['$vertexalpha']                  = new ParameterBoolean(false, false);
        p['$nocull']                       = new ParameterBoolean(false, false);
        p['$nofog']                        = new ParameterBoolean(false, false);
        p['$decal']                        = new ParameterBoolean(false, false);
        p['$model']                        = new ParameterBoolean(false, false);

        // Base parameters
        p['$basetexture']                  = new ParameterTexture(true);
        p['$basetexturetransform']         = new ParameterMatrix();
        p['$frame']                        = new ParameterNumber(0);
        p['$color']                        = new ParameterColor(1, 1, 1);
        p['$color2']                       = new ParameterColor(1, 1, 1);
        p['$alpha']                        = new ParameterNumber(1);

        // Data passed from entity system.
        p['$rendermode']                   = new ParameterNumber(0, false);
    }

    protected async fetchResources(materialCache: MaterialCache) {
        // Load all the texture parameters we have.
        const promises: Promise<void>[] = [];
        for (const k in this.param) {
            const v = this.param[k];
            if (v instanceof ParameterTexture)
                promises.push(v.fetch(materialCache, this.entityParams));
        }
        await Promise.all(promises);
        this.loaded = true;
    }

    protected initStaticBeforeResourceFetch(): void {
    }

    private paramGetVTFPossiblyMissing(name: string): VTF | null {
        if (this.param[name] === undefined || !(this.param[name] instanceof ParameterTexture))
            return null;
        return this.paramGetVTF(name);
    }

    private vtfIsRepresentative(vtf: VTF | null): boolean {
        if (vtf === null)
            return false;

        if (this.vtfIsIndirect(vtf))
            return false;

        return true;
    }

    private calcRepresentativeTexture(): VTF | null {
        let vtf: VTF | null = null;

        vtf = this.paramGetVTFPossiblyMissing('$basetexture');
        if (this.vtfIsRepresentative(vtf))
            return vtf;

        vtf = this.paramGetVTFPossiblyMissing('$envmapmask');
        if (this.vtfIsRepresentative(vtf))
            return vtf;

        vtf = this.paramGetVTFPossiblyMissing('$bumpmap');
        if (this.vtfIsRepresentative(vtf))
            return vtf;

        vtf = this.paramGetVTFPossiblyMissing('$normalmap');
        if (this.vtfIsRepresentative(vtf))
            return vtf;

        return null;
    }

    private calcTexCoord0Scale(): void {
        let w: number, h: number;
        if (!this.wantsTexCoord0Scale) {
            w = h = 1;
        } else if (this.representativeTexture === null) {
            w = h = 64;
        } else {
            w = this.representativeTexture.width;
            h = this.representativeTexture.height;
        }

        vec2.set(this.texCoord0Scale, 1 / w, 1 / h);
    }

    protected initStatic(materialCache: MaterialCache) {
        if (this.representativeTexture === null)
            this.representativeTexture = this.calcRepresentativeTexture();

        this.calcTexCoord0Scale();
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || !this.isMaterialLoaded())
            return;

        if (this.entityParams !== null) {
            // Update our color/alpha based on entity params.
            const color = assertExists(this.paramGetVector('$color'));
            color.setFromColor(this.entityParams.blendColor);

            const alpha = assertExists(this.param['$alpha']) as ParameterNumber;
            alpha.value = this.entityParams.blendColor.a;
        }

        if (this.proxyDriver !== null)
            this.proxyDriver.update(renderContext, this.entityParams);
    }

    protected setupOverrideSceneParams(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        const fogParams = this.isAdditive ? blackFogParams : renderContext.currentView.fogParams;
        const toneMapParams = this.isToneMapped ? renderContext.toneMapParams : noToneMapParams;

        if (fogParams !== renderContext.currentView.fogParams || toneMapParams !== renderContext.toneMapParams)
            fillSceneParamsOnRenderInst(renderInst, renderContext.currentView, toneMapParams, blackFogParams);
    }

    public abstract setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, lightmapPageIndex?: number): void;

    public setOnRenderInstModelMatrix(renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        if (this.skinningMode === SkinningMode.None) {

            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Generic.ub_SkinningParams, 12);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_Generic.ub_SkinningParams);

            if (modelMatrix !== null) {
                offs += fillMatrix4x3(d, offs, modelMatrix);
            } else {
                mat4.identity(scratchMat4a);
                offs += fillMatrix4x3(d, offs, scratchMat4a);
            }
        }
    }

    public setOnRenderInstSkinningParams(renderInst: GfxRenderInst, boneMatrix: ReadonlyMat4[], bonePaletteTable: number[]): void {
        if (this.skinningMode === SkinningMode.Smooth) {
            assert(bonePaletteTable.length <= ShaderTemplate_Generic.MaxSkinningParamsBoneMatrix);

            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Generic.ub_SkinningParams, 12 * ShaderTemplate_Generic.MaxSkinningParamsBoneMatrix);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_Generic.ub_SkinningParams);

            mat4.identity(scratchMat4a);
            for (let i = 0; i < ShaderTemplate_Generic.MaxSkinningParamsBoneMatrix; i++) {
                const boneIndex = bonePaletteTable[i];
                const m = boneIndex !== undefined ? boneMatrix[boneIndex] : scratchMat4a;
                offs += fillMatrix4x3(d, offs, m);
            }
        } else if (this.skinningMode === SkinningMode.Rigid) {
            assert(bonePaletteTable.length === 1);

            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Generic.ub_SkinningParams, 12);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_Generic.ub_SkinningParams);

            const boneIndex = bonePaletteTable[0];
            const m = boneMatrix[boneIndex];
            offs += fillMatrix4x3(d, offs, m);
        }
    }

    public calcProjectedLight(renderContext: SourceRenderContext, bbox: AABB): void {
    }

    public getRenderInstListForView(view: SourceEngineView): GfxRenderInstList {
        // Choose the right list.
        if (this.isIndirect)
            return view.indirectList;
        else if (this.isTranslucent || this.isAdditive)
            return view.translucentList;
        else
            return view.mainList;
    }
}
//#endregion

//#region Generic (LightmappedGeneric, UnlitGeneric, VertexLightingGeneric, WorldVertexTransition)
const enum ShaderWorldLightType {
    None, Point, Spot, Directional,
}

function getDefineString(defines: Map<string, string>, name: string): string | null {
    return nullify(defines.get(name));
}

function getDefineBool(defines: Map<string, string>, name: string): boolean {
    const str = getDefineString(defines, name);
    if (str !== null)
        assert(str === '1');
    return str !== null;
}

function ifDefineBool(defines: Map<string, string>, name: string, t: string, f: string) {
    return getDefineBool(defines, name) ? t : f;
}

class ShaderTemplate_Generic extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public static MaxDynamicWorldLights = 4;

    public override generateProgramString(m: Map<string, string>): string {
        return `
precision mediump float;
precision mediump sampler2DArray;
precision mediump sampler2DShadow;

${MaterialShaderTemplateBase.Common}

struct WorldLight {
    // w = ShaderWorldLightType.
    vec4 Position;
    // w = Spot exponent
    vec4 Color;
    // w = stopdot
    vec4 DistAttenuation;
    // Direction for directional / spotlight. w = stopdot2
    vec4 Direction;
};

layout(std140) uniform ub_ObjectParams {
#if defined USE_AMBIENT_CUBE
    // TODO(jstpierre): Pack this more efficiently?
    vec4 u_AmbientCube[6];
#endif
#if defined USE_DYNAMIC_LIGHTING
    // We support up to N lights.
    WorldLight u_WorldLights[${ShaderTemplate_Generic.MaxDynamicWorldLights}];
#endif
    Mat4x2 u_BaseTextureTransform;
#if defined USE_BUMPMAP
    Mat4x2 u_BumpmapTransform;
#endif
#if defined USE_BUMPMAP2
    Mat4x2 u_Bumpmap2Transform;
#endif
#if defined USE_DETAIL
    Mat4x2 u_DetailTextureTransform;
#endif
#if defined USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#if defined USE_BLEND_MODULATE
    vec4 u_BlendModulateScaleBias;
#endif
#if defined USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnelLightScale;
#endif
#if defined USE_SELFILLUM
    vec4 u_SelfIllumTint;
#endif
#if defined USE_SELFILLUM_FRESNEL
    vec4 u_SelfIllumFresnel;
#endif
#if defined USE_PHONG
    vec4 u_FresnelRangeSpecAlbedoBoost;
    vec4 u_SpecTintBoost;
#endif
#if defined USE_PROJECTED_LIGHT
    Mat4x4 u_ProjectedLightFromWorldMatrix;
    vec4 u_ProjectedLightColor;
    vec4 u_ProjectedLightOrigin;
#endif
#if defined USE_TREE_SWAY

#define u_TreeSwayWindDir              (u_TreeSwayParam[0].xy)
#define u_TreeSwayTime                 (u_TreeSwayParam[0].z)
#define u_TreeSwaySpeed                (u_TreeSwayParam[0].w)

#define u_TreeSwayHeight               (u_TreeSwayParam[1].x)
#define u_TreeSwayStartHeight          (u_TreeSwayParam[1].y)
#define u_TreeSwayRadius               (u_TreeSwayParam[1].z)
#define u_TreeSwayStartRadius          (u_TreeSwayParam[1].w)

#define u_TreeSwayIntensity            (u_TreeSwayParam[2].x)
#define u_TreeSwayIntensityPow         (u_TreeSwayParam[2].y)
#define u_TreeSwayFastScale            (u_TreeSwayParam[2].z)

#define u_TreeSwayScrumbleIntensity    (u_TreeSwayParam[3].x)
#define u_TreeSwayScrumbleIntensityPow (u_TreeSwayParam[3].y)
#define u_TreeSwayScrumbleFrequency    (u_TreeSwayParam[3].z)
#define u_TreeSwayScrumbleSpeed        (u_TreeSwayParam[3].w)

// TODO(jstpierre): If we combine time and speed, I think we can lose a vec4 here...
#define u_TreeSwaySpeedLerpStart       (u_TreeSwayParam[4].x)
#define u_TreeSwaySpeedLerpEnd         (u_TreeSwayParam[4].y)

vec4 u_TreeSwayParam[5];

#endif
    vec4 u_ModulationColor;

#define u_AlphaTestReference (u_Misc[0].x)
#define u_DetailBlendFactor  (u_Misc[0].y)
#define u_SpecExponentFactor (u_Misc[0].z)
#define u_SeamlessScale      (u_Misc[0].w)
    vec4 u_Misc[1];
};

#define HAS_FULL_TANGENTSPACE (USE_BUMPMAP)

// Base, Raw Coords
varying vec4 v_TexCoord0;
// Lightmap / Decal
varying vec2 v_TexCoord1;

// w contains BaseTexture2 blend factor.
varying vec4 v_PositionWorld;
varying vec4 v_Color;
varying vec3 v_DiffuseLighting0;

#if defined USE_STATIC_VERTEX_LIGHTING_3
varying vec3 v_DiffuseLighting1;
varying vec3 v_DiffuseLighting2;
#endif

#if defined HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;
#if defined USE_DYNAMIC_PIXEL_LIGHTING
varying vec4 v_LightAtten;
#endif

layout(binding = 0) uniform sampler2D u_TextureBase;
layout(binding = 1) uniform sampler2D u_TextureBase2;
layout(binding = 2) uniform sampler2D u_TextureBumpmap;
layout(binding = 3) uniform sampler2D u_TextureBumpmap2;
layout(binding = 4) uniform sampler2D u_TextureBumpMask;
layout(binding = 5) uniform sampler2D u_TextureDetail;
layout(binding = 6) uniform sampler2D u_TextureEnvmapMask;
layout(binding = 7) uniform sampler2D u_TextureSpecularExponent;
layout(binding = 8) uniform sampler2D u_TextureSelfIllumMask;
layout(binding = 9) uniform sampler2D u_TextureBlendModulate;
layout(binding = 10) uniform sampler2DArray u_TextureLightmap;
layout(binding = 11) uniform samplerCube u_TextureEnvmap;
layout(binding = 12) uniform sampler2DShadow u_TextureProjectedLightDepth;
layout(binding = 13) uniform sampler2D u_TextureProjectedLight;

float ApplyAttenuation(vec3 t_Coeff, float t_Value) {
    return dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value));
}

struct DiffuseLightInput {
    vec3 PositionWorld;
    vec3 NormalWorld;
    vec4 LightAttenuation;
    bool HalfLambert;
};

float WorldLightCalcAttenuation(in WorldLight t_WorldLight, in vec3 t_PositionWorld) {
    int t_LightType = int(t_WorldLight.Position.w);

    float t_Attenuation = 1.0;
    bool t_UseDistanceAttenuation = (t_LightType == ${ShaderWorldLightType.Point} || t_LightType == ${ShaderWorldLightType.Spot});
    bool t_UseAngleAttenuation = (t_LightType == ${ShaderWorldLightType.Spot});

    if (t_UseDistanceAttenuation) {
        float t_Distance = distance(t_WorldLight.Position.xyz, t_PositionWorld);
        t_Attenuation *= 1.0 / ApplyAttenuation(t_WorldLight.DistAttenuation.xyz, t_Distance);

        if (t_UseAngleAttenuation) {
            // Unpack spot parameters
            float t_Exponent = t_WorldLight.Color.w;
            float t_Stopdot = t_WorldLight.DistAttenuation.w;
            float t_Stopdot2 = t_WorldLight.Direction.w;

            vec3 t_LightDirectionWorld = normalize(t_WorldLight.Position.xyz - t_PositionWorld);
            float t_AngleDot = dot(t_WorldLight.Direction.xyz, -t_LightDirectionWorld);

            // invlerp
            float t_AngleAttenuation = max(invlerp(t_Stopdot2, t_Stopdot, t_AngleDot), 0.01);
            t_AngleAttenuation = saturate(pow(t_AngleAttenuation, t_Exponent));

            t_Attenuation *= t_AngleAttenuation;
        }
    }

    return t_Attenuation;
}

vec3 WorldLightCalcDirection(in WorldLight t_WorldLight, in vec3 t_PositionWorld) {
    int t_LightType = int(t_WorldLight.Position.w);

    if (t_LightType == ${ShaderWorldLightType.Directional}) {
        // Directionals just have incoming light direction stored in Direction field.
        return -t_WorldLight.Direction.xyz;
    } else {
        return normalize(t_WorldLight.Position.xyz - t_PositionWorld);
    }
}

float WorldLightCalcVisibility(in WorldLight t_WorldLight, in vec3 t_PositionWorld, in vec3 t_NormalWorld, bool t_HalfLambert) {
    vec3 t_LightDirectionWorld = WorldLightCalcDirection(t_WorldLight, t_PositionWorld);

    float t_NoL = dot(t_NormalWorld, t_LightDirectionWorld);
    if (t_HalfLambert) {
        // Valve's Half-Lambert / Wrapped lighting term.
        t_NoL = t_NoL * 0.5 + 0.5;
        t_NoL = t_NoL * t_NoL;
        return t_NoL;
    } else {
        return max(0.0, t_NoL);
    }
}

vec3 WorldLightCalcDiffuse(in vec3 t_PositionWorld, in vec3 t_NormalWorld, bool t_HalfLambert, in float t_Attenuation, in WorldLight t_WorldLight) {
    int t_LightType = int(t_WorldLight.Position.w);

    if (t_LightType == ${ShaderWorldLightType.None})
        return vec3(0.0);

    float t_Visibility = WorldLightCalcVisibility(t_WorldLight, t_PositionWorld, t_NormalWorld, t_HalfLambert);
    return t_WorldLight.Color.rgb * t_Attenuation * t_Visibility;
}

#if defined USE_DYNAMIC_LIGHTING
vec4 WorldLightCalcAllAttenuation(in vec3 t_PositionWorld) {
    vec4 t_FinalAtten = vec4(0.0);
    for (int i = 0; i < ${ShaderTemplate_Generic.MaxDynamicWorldLights}; i++)
        t_FinalAtten[i] = WorldLightCalcAttenuation(u_WorldLights[i], t_PositionWorld);
    return t_FinalAtten;
}

vec3 WorldLightCalcAllDiffuse(in DiffuseLightInput t_DiffuseLightInput) {
#if defined DEBUG_FULLBRIGHT
    return vec3(0.0);
#else
    vec3 t_FinalLight = vec3(0.0);
    for (int i = 0; i < ${ShaderTemplate_Generic.MaxDynamicWorldLights}; i++)
        t_FinalLight += WorldLightCalcDiffuse(t_DiffuseLightInput.PositionWorld, t_DiffuseLightInput.NormalWorld, t_DiffuseLightInput.HalfLambert, t_DiffuseLightInput.LightAttenuation[i], u_WorldLights[i]);
    return t_FinalLight;
#endif
}
#endif

#if defined USE_AMBIENT_CUBE
vec3 AmbientLight(in vec3 t_NormalWorld) {
#if defined DEBUG_FULLBRIGHT
    return vec3(1.0);
#else
    vec3 t_Weight = t_NormalWorld * t_NormalWorld;
    bvec3 t_Negative = lessThan(t_NormalWorld, vec3(0.0));
    return (
        t_Weight.x * u_AmbientCube[t_Negative.x ? 1 : 0].rgb +
        t_Weight.y * u_AmbientCube[t_Negative.y ? 3 : 2].rgb +
        t_Weight.z * u_AmbientCube[t_Negative.z ? 5 : 4].rgb
    );
#endif
}
#endif

void CalcTreeSway(inout vec3 t_PositionLocal) {
#if defined VERT && defined USE_TREE_SWAY

    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    float t_WindIntensity = length(u_TreeSwayWindDir);
    vec3 t_WindDirLocal = Mul(vec3(u_TreeSwayWindDir, 0.0), t_WorldFromLocalMatrix).xyz;

    vec3 t_PosOffs = vec3(0.0);

    vec3 t_OriginWorld = Mul(t_WorldFromLocalMatrix, vec4(0.0, 0.0, 0.0, 1.0));
    float t_TimeOffset = dot(t_OriginWorld, vec3(1.0)) * 19.0;

    float t_SwayTime = (u_TreeSwayTime + t_TimeOffset) * u_TreeSwaySpeed;
    float t_SpeedLerp = smoothstep(u_TreeSwaySpeedLerpStart, u_TreeSwaySpeedLerpEnd, t_WindIntensity);

    float t_ScaleHeight = saturate(invlerp(t_PositionLocal.z, u_TreeSwayHeight * u_TreeSwayStartHeight, u_TreeSwayHeight));

    float t_TrunkSin = mix(sin(t_SwayTime), sin(u_TreeSwayFastScale * t_SwayTime), t_SpeedLerp);
    float t_TrunkSwayIntensity = (u_TreeSwayIntensity * pow(t_ScaleHeight, u_TreeSwayIntensityPow)) * (t_TrunkSin + 0.1);
    t_PosOffs.xyz += t_WindDirLocal * t_TrunkSwayIntensity;

    if (t_ScaleHeight > 0.0) {
        float t_ScaleRadius = saturate(invlerp(length(t_PositionLocal), u_TreeSwayRadius * u_TreeSwayStartRadius, u_TreeSwayRadius));

        float t_BranchScale = 1.0 - abs(dot(normalize(t_WindDirLocal), vec3(normalize(t_PositionLocal.xy), 0.0)));
        float t_BranchSin = mix(sin(2.31 * t_SwayTime), sin(2.41 * u_TreeSwayFastScale * t_SwayTime), t_SpeedLerp);
        float t_BranchSwayIntensity = u_TreeSwayIntensity * t_BranchScale * t_ScaleRadius * (t_BranchSin + 0.4);
        t_PosOffs.xyz += t_WindDirLocal * t_BranchSwayIntensity;

        vec3 t_ScrumblePhase = normalize(t_PositionLocal.yzx) * u_TreeSwayScrumbleFrequency;
        vec3 t_ScrumbleScale = vec3(u_TreeSwayIntensity * pow(t_ScaleRadius, u_TreeSwayScrumbleIntensityPow));
        t_PosOffs.xyz += t_WindIntensity * t_ScrumbleScale * sin(u_TreeSwayScrumbleSpeed * u_TreeSwayTime + t_ScrumblePhase + t_TimeOffset);
    }

    t_PositionLocal.xyz += t_PosOffs.xyz;
#endif
}

#if defined VERT
void mainVS() {
    vec3 t_PositionLocal = a_Position;
    CalcTreeSway(t_PositionLocal);

    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(t_PositionLocal, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    vec3 t_NormalWorld = normalize(Mul(t_WorldFromLocalMatrix, vec4(a_Normal.xyz, 0.0)));

#if defined USE_VERTEX_COLOR
    v_Color = a_Color;
#else
    v_Color = vec4(1.0);
#endif

    v_DiffuseLighting0.rgb = vec3(0.0);

#if !defined USE_DYNAMIC_LIGHTING && !defined USE_STATIC_VERTEX_LIGHTING
    // If we don't have any lighting, it's fullbright.
    v_DiffuseLighting0.rgb = vec3(1.0);
#endif

#if defined USE_DYNAMIC_LIGHTING
    vec4 t_LightAtten = WorldLightCalcAllAttenuation(t_PositionWorld.xyz);
#endif

#if defined USE_STATIC_VERTEX_LIGHTING
    // Static vertex lighting should already include ambient lighting.
    // 2.0 here is overbright.
    v_DiffuseLighting0.rgb = GammaToLinear(a_StaticVertexLighting0 * 2.0);

#if defined USE_STATIC_VERTEX_LIGHTING_3
    v_DiffuseLighting1.rgb = GammaToLinear(a_StaticVertexLighting1 * 2.0);
    v_DiffuseLighting2.rgb = GammaToLinear(a_StaticVertexLighting2 * 2.0);
#endif
#endif

#if defined USE_DYNAMIC_VERTEX_LIGHTING
#if defined USE_AMBIENT_CUBE
    v_DiffuseLighting0.rgb += AmbientLight(t_NormalWorld);
#endif

    bool t_HalfLambert = false;
#if defined USE_HALF_LAMBERT
    t_HalfLambert = true;
#endif

    DiffuseLightInput t_DiffuseLightInput;
    t_DiffuseLightInput.PositionWorld = t_PositionWorld.xyz;
    t_DiffuseLightInput.NormalWorld = t_NormalWorld.xyz;
    t_DiffuseLightInput.LightAttenuation = t_LightAtten.xyzw;
    t_DiffuseLightInput.HalfLambert = t_HalfLambert;
    vec3 t_DiffuseLighting = WorldLightCalcAllDiffuse(t_DiffuseLightInput);
    v_DiffuseLighting0.rgb += t_DiffuseLighting;
#endif

#if defined USE_DYNAMIC_PIXEL_LIGHTING
    v_LightAtten.xyzw = t_LightAtten;
#endif

#if defined USE_MODULATIONCOLOR_ALPHA
    v_Color.a *= u_ModulationColor.a;
#endif

#if defined USE_BASETEXTURE2
    // This is the BaseTexture2 blend factor, smuggled through using unobvious means.
    v_PositionWorld.w = a_Normal.w;
#endif

#if defined HAS_FULL_TANGENTSPACE
    vec3 t_TangentSWorld = normalize(Mul(t_WorldFromLocalMatrix, vec4(a_TangentS.xyz, 0.0)));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = Mul(u_BaseTextureTransform, vec4(a_TexCoord01.xy, 1.0, 1.0));
    v_TexCoord0.zw = a_TexCoord01.xy;
#if defined USE_LIGHTMAP || defined USE_DECAL
    v_TexCoord1.xy = a_TexCoord01.zw;
#endif
}
#endif

#if defined FRAG

#define DETAIL_BLEND_MODE_MUL_DETAIL2                             (0)
#define DETAIL_BLEND_MODE_RGB_ADDITIVE                            (1)
#define DETAIL_BLEND_MODE_DETAIL_OVER_BASE                        (2)
#define DETAIL_BLEND_MODE_FADE                                    (3)
#define DETAIL_BLEND_MODE_BASE_OVER_DETAIL                        (4)
#define DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM                  (5)
#define DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE   (6)
#define DETAIL_BLEND_MODE_MOD2X_SELECT_TWO_PATTERNS               (7)
#define DETAIL_BLEND_MODE_MULTIPLY                                (8)
#define DETAIL_BLEND_MODE_MASK_BASE_BY_DETAIL_ALPHA               (9)
#define DETAIL_BLEND_MODE_SSBUMP_BUMP                             (10)
#define DETAIL_BLEND_MODE_SSBUMP_NOBUMP                           (11)

vec4 CalcDetail(in vec4 t_BaseTexture, in vec4 t_DetailTexture) {
    bool use_detail = ${getDefineBool(m, 'USE_DETAIL')};
    if (!use_detail)
        return t_BaseTexture;

    int t_BlendMode = ${getDefineString(m, 'DETAIL_BLEND_MODE')};
    float t_BlendFactor = u_DetailBlendFactor;

    if (t_BlendMode == DETAIL_BLEND_MODE_MUL_DETAIL2) {
        return t_BaseTexture * mix(vec4(1.0), t_DetailTexture * 2.0, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE) {
        return t_BaseTexture + t_DetailTexture * t_BlendFactor;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_DETAIL_OVER_BASE) {
        return vec4(mix(t_BaseTexture.rgb, t_DetailTexture.rgb, t_BlendFactor * t_DetailTexture.a), t_BaseTexture.a);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_FADE) {
        return mix(t_BaseTexture, t_DetailTexture, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_BASE_OVER_DETAIL) {
        return vec4(mix(t_BaseTexture.rgb, t_DetailTexture.rgb, (t_BlendFactor * (1.0 - t_BaseTexture.a))), t_DetailTexture.a);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_MULTIPLY) {
        return mix(t_BaseTexture, t_BaseTexture * t_DetailTexture, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_MOD2X_SELECT_TWO_PATTERNS) {
        vec4 t_DetailPattern = vec4(mix(t_DetailTexture.r, t_DetailTexture.a, t_BaseTexture.a));
        return t_BaseTexture * mix(vec4(1.0), t_DetailPattern * 2.0, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM || t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Done in Post-Lighting.
        return t_BaseTexture;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_SSBUMP_BUMP) {
        // Done as part of bumpmapping.
        return t_BaseTexture;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_SSBUMP_NOBUMP) {
        return vec4(t_BaseTexture.rgb * dot(t_DetailTexture.rgb, vec3(2.0 / 3.0)), t_BaseTexture.a);
    }

    // Unknown.
    return t_BaseTexture + vec4(1.0, 0.0, 1.0, 0.0);
}

vec3 CalcDetailPostLighting(in vec3 t_DiffuseColor, in vec3 t_DetailTexture) {
    bool use_detail = ${getDefineBool(m, 'USE_DETAIL')};
    if (!use_detail)
        return t_DiffuseColor;

    int t_BlendMode = ${getDefineString(m, 'DETAIL_BLEND_MODE')};
    float t_BlendFactor = u_DetailBlendFactor;

    if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM) {
        return t_DiffuseColor.rgb + t_DetailTexture.rgb * t_BlendFactor;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Remap.
        if (t_BlendFactor >= 0.5) {
            float t_Mult = (1.0 / t_BlendFactor);
            return t_DiffuseColor.rgb + clamp((t_Mult * t_DetailTexture.rgb) + (1.0 - t_Mult), 0.0, 1.0);
        } else {
            float t_Mult = (4.0 * t_BlendFactor);
            return t_DiffuseColor.rgb + clamp((t_Mult * t_DetailTexture.rgb) + (-0.5 * t_Mult), 0.0, 1.0);
        }
    }

    // Nothing to do.
    return t_DiffuseColor.rgb;
}

#define DECAL_BLEND_MODE_ALPHA      0
#define DECAL_BLEND_MODE_MUL        1

vec3 CalcDecal(in vec3 t_BaseTexture, in vec3 t_DecalLighting) {
    bool use_decal = ${getDefineBool(m, 'USE_DECAL')};
    if (!use_decal)
        return t_BaseTexture;

    vec2 t_DecalTexCoord = v_TexCoord1.xy;

    // Decal reuses $basetexture2 slot...
    vec4 t_DecalTexture = DebugColorTexture(texture(SAMPLER_2D(u_TextureBase2), t_DecalTexCoord));

    int t_BlendMode = ${getDefineString(m, 'DECAL_BLEND_MODE')};
    if (t_BlendMode == DECAL_BLEND_MODE_ALPHA) {
        return mix(t_BaseTexture.rgb, t_DecalTexture.rgb * t_DecalLighting.rgb, t_DecalTexture.a);
    } else if (t_BlendMode == DECAL_BLEND_MODE_MUL) {
        return t_BaseTexture.rgb * t_DecalTexture.rgb;
    }

    // Unknown.
    return t_BaseTexture + vec3(1.0, 0.0, 1.0);
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 0.8660254037844386,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

struct SpecularLightResult {
    vec3 SpecularLight;
    vec3 RimLight;
};

SpecularLightResult SpecularLightResult_New() {
    SpecularLightResult t_Result;
    t_Result.SpecularLight = vec3(0, 0, 0);
    t_Result.RimLight = vec3(0, 0, 0);
    return t_Result;
}

void SpecularLightResult_Sum(inout SpecularLightResult t_Dst, in SpecularLightResult t_Src) {
    t_Dst.SpecularLight += t_Src.SpecularLight;
    t_Dst.RimLight += t_Src.RimLight;
}

struct SpecularLightInput {
    vec3 PositionWorld;
    vec3 NormalWorld;
    vec3 WorldDirectionToEye;
    float Fresnel;
    float SpecularExponent;
    float RimExponent;
};

SpecularLightResult WorldLightCalcSpecular(in SpecularLightInput t_Input, in WorldLight t_WorldLight) {
    vec3 t_Reflect = CalcReflection(t_Input.NormalWorld, t_Input.WorldDirectionToEye);
    vec3 t_LightDirectionWorld = WorldLightCalcDirection(t_WorldLight, t_Input.PositionWorld);

    float t_NoL = saturate(dot(t_Input.NormalWorld, t_LightDirectionWorld));
    float t_RoL = saturate(dot(t_Reflect, t_LightDirectionWorld));

    SpecularLightResult t_Result = SpecularLightResult_New();

    float t_Attenuation = WorldLightCalcAttenuation(t_WorldLight, t_Input.PositionWorld);

    t_Result.SpecularLight += vec3(pow(t_RoL, t_Input.SpecularExponent));
    // TODO(jstpierre): Specular Warp
    t_Result.SpecularLight *= t_NoL * t_WorldLight.Color.rgb * t_Attenuation * t_Input.Fresnel;

    t_Result.RimLight += vec3(pow(t_RoL, t_Input.RimExponent));
    t_Result.RimLight *= t_NoL * t_WorldLight.Color.rgb * t_Attenuation;

    return t_Result;
}

SpecularLightResult WorldLightCalcAllSpecular(in SpecularLightInput t_Input) {
    SpecularLightResult t_FinalLight = SpecularLightResult_New();
#if defined USE_DYNAMIC_PIXEL_LIGHTING
    for (int i = 0; i < ${ShaderTemplate_Generic.MaxDynamicWorldLights}; i++)
        SpecularLightResult_Sum(t_FinalLight, WorldLightCalcSpecular(t_Input, u_WorldLights[i]));
#endif
    return t_FinalLight;
}

vec4 UnpackNormalMap(vec4 t_Sample) {
    bool use_ssbump = ${getDefineBool(m, `USE_SSBUMP`)};
    if (!use_ssbump)
        t_Sample = UnpackUnsignedNormalMap(t_Sample);
    return t_Sample;
}

vec4 SeamlessSampleTex(PD_SAMPLER_2D(t_Texture), in float t_SeamlessScale) {
    // Seamless ignores the base texture coordinate, and instead blends three copies
    // of the same texture based on world position (similar to tri-planar).

    t_SeamlessScale *= u_SeamlessScale;
    vec3 t_BaseTexCoord = v_PositionWorld.xyz * t_SeamlessScale;

    // Weights should sum to 1.
    vec3 t_Weights = v_TangentSpaceBasis2.xyz * v_TangentSpaceBasis2.xyz;
    vec4 t_Sample = vec4(0.0);
    t_Sample += texture(PU_SAMPLER_2D(t_Texture), t_BaseTexCoord.yz) * t_Weights.x;
    t_Sample += texture(PU_SAMPLER_2D(t_Texture), t_BaseTexCoord.zx) * t_Weights.y;
    t_Sample += texture(PU_SAMPLER_2D(t_Texture), t_BaseTexCoord.xy) * t_Weights.z;
    return t_Sample;
}

vec4 SeamlessSampleTex(PD_SAMPLER_2D(t_Texture), in bool t_UseSeamless, in vec2 t_TexCoord) {
    if (t_UseSeamless) {
        return SeamlessSampleTex(PU_SAMPLER_2D(t_Texture), 1.0);
    } else {
        return texture(PU_SAMPLER_2D(t_Texture), t_TexCoord.xy);
    }
}

float CalcShadowPCF9(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord) {
    float t_Res = 0.0;
    t_Res += texture(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2( 0,  1)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2( 0, -1)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2( 1,  0)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2(-1,  0)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2( 1,  1)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2( 1, -1)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2(-1,  1)) * (1.0 / 9.0);
    t_Res += textureOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, ivec2(-1, -1)) * (1.0 / 9.0);
    return t_Res;
}

float CalcShadowPCF5(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord) {
    float t_Res = 0.0;
    t_Res += textureLod(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 0,  1)) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 0, -1)) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 1,  0)) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2(-1,  0)) * (1.0 / 5.0);
    return t_Res;
}

float CalcShadowPCF1(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord) {
    return textureLod(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0);
}

float CalcShadowPCF(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord, in float t_Bias) {
    t_ProjCoord.z += t_Bias;
    return CalcShadowPCF5(PF_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz);
}

void mainPS() {
    vec4 t_Albedo, t_BlendedAlpha;

    bool use_seamless_base = ${getDefineBool(m, `USE_SEAMLESS_BASE`)};
    vec4 t_BaseTexture = DebugColorTexture(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureBase), use_seamless_base, v_TexCoord0.xy));

    bool use_basetexture2 = ${getDefineBool(m, `USE_BASETEXTURE2`)};

    float t_BlendFactorWorld = v_PositionWorld.w;

    bool use_blend_modulate = ${getDefineBool(m, `USE_BLEND_MODULATE`)};
    if (use_blend_modulate) {
        vec2 t_BlendModulateTexCoord = ${ifDefineBool(m, `USE_BLEND_MODULATE`, `CalcScaleBias(v_TexCoord0.zw, u_BlendModulateScaleBias)`, `vec2(0.0)`)};
        vec4 t_BlendModulateSample = texture(SAMPLER_2D(u_TextureBlendModulate), t_BlendModulateTexCoord);
        float t_BlendModulateMin = t_BlendModulateSample.g - t_BlendModulateSample.r;
        float t_BlendModulateMax = t_BlendModulateSample.g + t_BlendModulateSample.r;
        t_BlendFactorWorld = smoothstep(t_BlendModulateMin, t_BlendModulateMax, t_BlendFactorWorld);
    }

    if (use_basetexture2) {
        // Blend in BaseTexture2 using blend factor.
        vec4 t_BaseTexture2 = DebugColorTexture(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureBase2), use_seamless_base, v_TexCoord0.xy));
        t_Albedo = mix(t_BaseTexture, t_BaseTexture2, t_BlendFactorWorld);
    } else {
        t_Albedo = t_BaseTexture;
    }

    vec4 t_DetailTexture = vec4(0.0);

#if defined USE_DETAIL
    bool use_seamless_detail = ${getDefineBool(m, `USE_SEAMLESS_DETAIL`)};
    if (use_seamless_detail) {
        float t_SeamlessDetailScale = u_DetailTextureTransform.mx.x;
        t_DetailTexture = DebugColorTexture(SeamlessSampleTex(SAMPLER_2D(u_TextureDetail), t_SeamlessDetailScale));
    } else {
        vec2 t_DetailTexCoord = Mul(u_DetailTextureTransform, vec4(v_TexCoord0.zw, 1.0, 1.0));
        t_DetailTexture = DebugColorTexture(texture(SAMPLER_2D(u_TextureDetail), t_DetailTexCoord));
    }
    t_Albedo = CalcDetail(t_Albedo, t_DetailTexture);
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;

    vec3 t_EnvmapFactor = vec3(1.0);
    bool use_bumpmap = ${getDefineBool(m, `USE_BUMPMAP`)};
    bool use_ssbump = ${getDefineBool(m, `USE_SSBUMP`)};

    // TODO(jstpierre): It seems like $bumptransform might not even be respected in lightmappedgeneric shaders?
    vec2 t_BumpmapTexCoord = ${ifDefineBool(m, `USE_BUMPMAP`, `Mul(u_BumpmapTransform, vec4(v_TexCoord0.zw, 1.0, 1.0))`, `vec2(0.0)`)};
    vec4 t_BumpmapSample = vec4(0.0);
    vec3 t_BumpmapNormal;

    if (use_bumpmap) {
        t_BumpmapSample = UnpackNormalMap(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureBumpmap), use_seamless_base, t_BumpmapTexCoord.xy));

        bool use_bumpmap2 = ${getDefineBool(m, `USE_BUMPMAP2`)};
        if (use_bumpmap2) {
            vec2 t_Bumpmap2TexCoord = ${ifDefineBool(m, `USE_BUMPMAP2`, `Mul(u_Bumpmap2Transform, vec4(v_TexCoord0.zw, 1.0, 1.0))`, `vec2(0.0)`)};
            vec4 t_Bumpmap2Sample = UnpackNormalMap(texture(SAMPLER_2D(u_TextureBumpmap2), t_Bumpmap2TexCoord));

            bool use_bumpmask = ${getDefineBool(m, `USE_BUMPMASK`)};
            if (use_bumpmask) {
                vec4 t_BumpMaskSample = UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureBumpMask), v_TexCoord0.xy));
                t_BumpmapSample.rgb = normalize(t_BumpmapSample.rgb + t_Bumpmap2Sample.rgb);
                t_BumpmapSample.rgb = mix(t_BumpMaskSample.rgb, t_BumpmapSample.rgb, t_BumpMaskSample.a);
                // Envmap factor from bump mask is multiplied in regardless of whether we have use_normalmap_alpha_envmap_mask set.
                t_EnvmapFactor *= t_BumpMaskSample.a;
            } else {
                // TODO(jstpierre): $addbumpmaps
                t_BumpmapSample.rgb = mix(t_BumpmapSample.rgb, t_Bumpmap2Sample.rgb, t_BlendFactorWorld);
            }
        }

        bool use_normalmap_alpha_envmap_mask = ${getDefineBool(m, `USE_NORMALMAP_ALPHA_ENVMAP_MASK`)};
        if (use_normalmap_alpha_envmap_mask)
            t_EnvmapFactor *= t_BumpmapSample.a;

        if (use_ssbump) {
            // In SSBUMP, the bumpmap is pre-convolved with the basis. Compute the normal by re-applying our basis.
            t_BumpmapNormal = normalize(g_RNBasis0*t_BumpmapSample.x + g_RNBasis1*t_BumpmapSample.y + g_RNBasis2*t_BumpmapSample.z);
        } else {
            // In non-SSBUMP, this is a traditional normal map with signed offsets.
            t_BumpmapNormal = t_BumpmapSample.rgb;
        }

        // Transform from tangent space into world-space.
#if defined HAS_FULL_TANGENTSPACE
        t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
#endif
    } else {
        t_NormalWorld = v_TangentSpaceBasis2;
    }

    vec3 t_DiffuseLighting = vec3(0.0);
    vec3 t_SpecularLighting = vec3(0.0);
    vec3 t_SpecularLightingEnvMap = vec3(0.0);

    bool use_lightmap = ${getDefineBool(m, `USE_LIGHTMAP`)};
    bool use_diffuse_bumpmap = ${getDefineBool(m, `USE_DIFFUSE_BUMPMAP`)};

    // Lightmap Diffuse
    if (use_lightmap) {
        vec3 t_LightmapColor0 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 0.0)));

        if (use_diffuse_bumpmap) {
            vec3 t_LightmapColor1 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 1.0)));
            vec3 t_LightmapColor2 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 2.0)));
            vec3 t_LightmapColor3 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 3.0)));

            vec3 t_Influence;

            bool t_NormalizeInfluence = true;

            if (use_ssbump) {
                // SSBUMP precomputes the elements of t_Influence (calculated below) offline.
                t_Influence = t_BumpmapSample.rgb;

                if (DETAIL_BLEND_MODE == DETAIL_BLEND_MODE_SSBUMP_BUMP) {
                    t_Influence.xyz *= mix(vec3(1.0), 2.0 * t_DetailTexture.rgb, t_BaseTexture.a);
                    t_Albedo.a = 1.0; // Reset alpha
                }

                bool use_ssbump_normalize = ${getDefineBool(m, `USE_SSBUMP_NORMALIZE`)};
                t_NormalizeInfluence = use_ssbump_normalize;
            } else {
                t_Influence.x = saturate(dot(t_BumpmapNormal, g_RNBasis0));
                t_Influence.y = saturate(dot(t_BumpmapNormal, g_RNBasis1));
                t_Influence.z = saturate(dot(t_BumpmapNormal, g_RNBasis2));

                if (DETAIL_BLEND_MODE == DETAIL_BLEND_MODE_SSBUMP_BUMP) {
                    t_Influence.xyz *= t_DetailTexture.rgb * 2.0;
                }
            }

            // The lightmap is constructed assuming that the three basis tap weights sum to 1, however,
            // a flat vector projected against our three HL2 basis vectors would sum to sqrt(3).
            // Renormalize so that the weights sum to 1.
            if (t_NormalizeInfluence)
                t_Influence.xyz *= 0.5773502691896258; // 1/sqrt(3)

            t_DiffuseLighting = vec3(0.0);
            t_DiffuseLighting += t_LightmapColor1 * t_Influence.x;
            t_DiffuseLighting += t_LightmapColor2 * t_Influence.y;
            t_DiffuseLighting += t_LightmapColor3 * t_Influence.z;
        } else {
            t_DiffuseLighting.rgb = t_LightmapColor0;
        }
    } else {
        bool use_static_vertex_lighting_3 = ${getDefineBool(m, `USE_STATIC_VERTEX_LIGHTING_3`)};
        if (use_static_vertex_lighting_3) {
#if defined USE_STATIC_VERTEX_LIGHTING_3
            vec3 t_Influence;

            if (false && use_bumpmap) {
                t_Influence.x = clamp(dot(t_BumpmapNormal, g_RNBasis0), 0.0, 1.0);
                t_Influence.y = clamp(dot(t_BumpmapNormal, g_RNBasis1), 0.0, 1.0);
                t_Influence.z = clamp(dot(t_BumpmapNormal, g_RNBasis2), 0.0, 1.0);
                t_Influence.xyz = normalize(t_Influence.xyz);
            } else {
                // No bumpmap, equal diffuse influence
                t_Influence.xyz = vec3(1.0 / 3.0);
            }

            t_DiffuseLighting = vec3(0.0);
            t_DiffuseLighting += v_DiffuseLighting0.rgb * t_Influence.x;
            t_DiffuseLighting += v_DiffuseLighting1.rgb * t_Influence.y;
            t_DiffuseLighting += v_DiffuseLighting2.rgb * t_Influence.z;
#endif
        } else {
            t_DiffuseLighting.rgb = v_DiffuseLighting0.rgb;
        }
    }

    t_Albedo *= v_Color;

#if defined USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

    bool use_half_lambert = ${getDefineBool(m, `USE_HALF_LAMBERT`)};
    bool use_phong = ${getDefineBool(m, `USE_PHONG`)};

#if defined USE_DYNAMIC_PIXEL_LIGHTING
    // World Diffuse
    bool t_HalfLambert = use_half_lambert;

    if (use_phong) {
        // Skin shader forces half-lambert on.
        t_HalfLambert = true;
    }

    DiffuseLightInput t_DiffuseLightInput;
    t_DiffuseLightInput.PositionWorld = v_PositionWorld.xyz;
    t_DiffuseLightInput.NormalWorld = t_NormalWorld.xyz;
    t_DiffuseLightInput.LightAttenuation = v_LightAtten.xyzw;
    t_DiffuseLightInput.HalfLambert = t_HalfLambert;
    t_DiffuseLighting.rgb += WorldLightCalcAllDiffuse(t_DiffuseLightInput);

#if defined USE_AMBIENT_CUBE
    t_DiffuseLighting.rgb += AmbientLight(t_NormalWorld.xyz);
#endif
#endif

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    float t_FresnelDot = dot(t_NormalWorld, t_WorldDirectionToEye);

    float t_Fresnel;
#if defined USE_PHONG
    t_Fresnel = CalcFresnelTerm2Ranges(t_FresnelDot, u_FresnelRangeSpecAlbedoBoost.xyz);
#else
    t_Fresnel = CalcFresnelTerm2(t_FresnelDot);
#endif

    bool use_base_alpha_envmap_mask = ${getDefineBool(m, `USE_BASE_ALPHA_ENVMAP_MASK`)};

#if defined USE_ENVMAP
    t_EnvmapFactor *= u_EnvmapTint.rgb;

    bool use_envmap_mask = ${getDefineBool(m, `USE_ENVMAP_MASK`)};
    if (use_envmap_mask) {
        vec2 t_EnvmapMaskTexCoord = ${ifDefineBool(m, `USE_ENVMAP_MASK`, `CalcScaleBias(v_TexCoord0.zw, u_EnvmapMaskScaleBias)`, `vec2(0.0)`)};
        t_EnvmapFactor *= texture(SAMPLER_2D(u_TextureEnvmapMask), t_EnvmapMaskTexCoord).rgb;
    }

    if (use_base_alpha_envmap_mask)
        t_EnvmapFactor *= 1.0 - t_BaseTexture.a;

    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_WorldDirectionToEye);
    vec3 t_EnvmapColor = texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgb * g_EnvmapScale;
    t_EnvmapColor *= t_EnvmapFactor;

    // TODO(jstpierre): Double-check all of this with Phong. I don't think it's 100% right...

    // TODO(jstpierre): $envmaplightscaleminmax
    vec3 t_EnvmapDiffuseLightScale = saturate(t_DiffuseLighting.rgb);
    t_EnvmapColor.rgb *= mix(vec3(1.0), t_EnvmapDiffuseLightScale.rgb, u_EnvmapContrastSaturationFresnelLightScale.w);

    t_EnvmapColor = mix(t_EnvmapColor, t_EnvmapColor*t_EnvmapColor, u_EnvmapContrastSaturationFresnelLightScale.x);
    t_EnvmapColor = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_EnvmapColor)), t_EnvmapColor, u_EnvmapContrastSaturationFresnelLightScale.y);
    t_EnvmapColor *= mix(t_Fresnel, 1.0, u_EnvmapContrastSaturationFresnelLightScale.z);

    t_SpecularLightingEnvMap.rgb += t_EnvmapColor.rgb;
#endif

    // World Specular
    SpecularLightInput t_SpecularLightInput;
    t_SpecularLightInput.PositionWorld = v_PositionWorld.xyz;
    t_SpecularLightInput.NormalWorld = t_NormalWorld;
    t_SpecularLightInput.WorldDirectionToEye = t_WorldDirectionToEye;
    t_SpecularLightInput.Fresnel = t_Fresnel;
    t_SpecularLightInput.RimExponent = 4.0;

    vec4 t_SpecularMapSample = vec4(0.0);

    if (use_phong) {
        bool use_phong_exponent_texture = ${getDefineBool(m, `USE_PHONG_EXPONENT_TEXTURE`)};
        if (use_phong_exponent_texture) {
            t_SpecularMapSample = texture(SAMPLER_2D(u_TextureSpecularExponent), v_TexCoord0.xy);
            t_SpecularLightInput.SpecularExponent = 1.0 + u_SpecExponentFactor * t_SpecularMapSample.r;
        } else {
            t_SpecularLightInput.SpecularExponent = u_SpecExponentFactor;
        }
    }

#if defined USE_DYNAMIC_PIXEL_LIGHTING
    if (use_phong) {
        SpecularLightResult t_SpecularLightResult = WorldLightCalcAllSpecular(t_SpecularLightInput);
        t_SpecularLighting.rgb += t_SpecularLightResult.SpecularLight;
    }
#endif // USE_DYNAMIC_PIXEL_LIGHTING

#if defined USE_PROJECTED_LIGHT
    // Projected Light (Flashlight, env_projected_texture)
    vec4 t_ProjectedLightCoord = Mul(u_ProjectedLightFromWorldMatrix, vec4(v_PositionWorld.xyz, 1.0));
    t_ProjectedLightCoord.xyz /= t_ProjectedLightCoord.www;

    // Clip space is between -1 and 1. Move it into 0...1 space.
    t_ProjectedLightCoord.xy = t_ProjectedLightCoord.xy * 0.5 + 0.5;
#if !defined GFX_CLIPSPACE_NEAR_ZERO
    t_ProjectedLightCoord.z = t_ProjectedLightCoord.z * 0.5 + 0.5;
#endif

    vec4 t_ProjectedLightSample = texture(SAMPLER_2D(u_TextureProjectedLight), t_ProjectedLightCoord.xy);
    if (all(greaterThan(t_ProjectedLightCoord.xyz, vec3(0.0))) && all(lessThan(t_ProjectedLightCoord.xyz, vec3(1.0)))) {
        vec2 t_ProjectedGoboTexCoord = t_ProjectedLightCoord.xy;

#if defined GFX_VIEWPORT_ORIGIN_TL
        t_ProjectedLightCoord.y = 1.0 - t_ProjectedLightCoord.y;
#else
        t_ProjectedGoboTexCoord.y = 1.0 - t_ProjectedGoboTexCoord.y;
#endif

        vec3 t_ProjectedLightColor = (t_ProjectedLightSample.rgb * u_ProjectedLightColor.rgb);

        vec3 t_WorldToProjectedLight = u_ProjectedLightOrigin.xyz - v_PositionWorld.xyz;
        vec3 t_WorldDirectionToProjectedLight = normalize(t_WorldToProjectedLight);
        float t_AngleAttenuation = saturate(dot(t_WorldDirectionToProjectedLight.xyz, t_NormalWorld.xyz));

        float t_DistanceNorm = length(t_WorldToProjectedLight) / u_ProjectedLightOrigin.w;
        float t_DistanceAttenuation = saturate(invlerp(1.0, 0.6, t_DistanceNorm));
        t_ProjectedLightColor *= t_DistanceAttenuation * t_AngleAttenuation;

        if (any(greaterThan(t_ProjectedLightColor.rgb, vec3(0.0)))) {
            float t_ShadowVisibility = 1.0 - CalcShadowPCF(PP_SAMPLER_2DShadow(u_TextureProjectedLightDepth), t_ProjectedLightCoord.xyz, 0.01);
            t_ProjectedLightColor.rgb *= t_ShadowVisibility;

            t_DiffuseLighting.rgb += t_ProjectedLightColor.rgb;

            bool t_CalcSpecularFlashlight = use_phong;
            if (t_CalcSpecularFlashlight) {
                vec3 t_Reflect = CalcReflection(t_SpecularLightInput.NormalWorld, t_SpecularLightInput.WorldDirectionToEye);
                float t_RoL = saturate(dot(t_Reflect, t_WorldDirectionToProjectedLight));

                // TODO(jstpierre): $phongwarptexture
                t_SpecularLighting.rgb += t_ProjectedLightColor.rgb * pow(t_RoL, t_SpecularLightInput.SpecularExponent);
            }
        }
    }
#endif

    // Compute final specular
#if defined USE_DYNAMIC_PIXEL_LIGHTING
    if (use_phong) {
        // Specular mask is either in base map or normal map alpha.
        float t_SpecularMask;
        bool use_base_alpha_phong_mask = ${getDefineBool(m, `USE_BASE_ALPHA_PHONG_MASK`)};
        if (use_base_alpha_phong_mask) {
            t_SpecularMask = t_BaseTexture.a;
        } else if (use_bumpmap) {
            t_SpecularMask = t_BumpmapSample.a;
        } else {
            t_SpecularMask = 1.0;
        }

        bool use_phong_mask_invert = ${getDefineBool(m, `USE_PHONG_MASK_INVERT`)};
        if (use_phong_mask_invert)
            t_SpecularMask = 1.0 - t_SpecularMask;

        vec3 t_SpecularTint = vec3(u_SpecTintBoost.w);
        bool use_phong_albedo_tint = ${getDefineBool(m, `USE_PHONG_ALBEDO_TINT`)};
        if (use_phong_albedo_tint) {
            t_SpecularTint.rgb = mix(t_SpecularTint.rgb, t_Albedo.rgb * u_FresnelRangeSpecAlbedoBoost.www, t_SpecularMapSample.ggg);
        } else {
            t_SpecularTint.rgb *= u_SpecTintBoost.rgb;
        }

        t_SpecularLighting.rgb *= t_SpecularTint.rgb * t_SpecularMask;

        // TODO(jstpierre): $rimlight, $rimlightexponent, $rimlightboost, $rimmask
    }
#endif

    vec3 t_DecalLighting = t_DiffuseLighting;

    vec3 t_FinalDiffuse = t_DiffuseLighting * t_Albedo.rgb;
    t_FinalDiffuse.rgb = CalcDecal(t_FinalDiffuse.rgb, t_DecalLighting.rgb);

    t_FinalDiffuse = CalcDetailPostLighting(t_FinalDiffuse, t_DetailTexture.rgb);

    // TODO(jstpierre): Support $blendtintbybasealpha and $blendtintcoloroverbase
    #if defined USE_MODULATIONCOLOR_COLOR
        t_FinalDiffuse *= u_ModulationColor.rgb;
    #endif

#if defined USE_SELFILLUM
    vec3 t_SelfIllumMask;

    bool use_selfillum_envmapmask_alpha = ${getDefineBool(m, `USE_SELFILLUM_ENVMAPMASK_ALPHA`)};
    bool use_selfillum_mask = ${getDefineBool(m, `USE_SELFILLUM_MASK`)};
    if (use_selfillum_envmapmask_alpha) {
        vec2 t_EnvmapMaskTexCoord = ${ifDefineBool(m, `USE_ENVMAP_MASK`, `CalcScaleBias(v_TexCoord0.zw, u_EnvmapMaskScaleBias)`, `vec2(0.0)`)};
        t_SelfIllumMask = texture(SAMPLER_2D(u_TextureEnvmapMask), t_EnvmapMaskTexCoord).aaa;
    } else if (use_selfillum_mask) {
        t_SelfIllumMask = texture(SAMPLER_2D(u_TextureSelfIllumMask), v_TexCoord0.xy).rgb;
    } else {
        t_SelfIllumMask = t_BaseTexture.aaa;
    }

    vec3 t_SelfIllum = u_SelfIllumTint.rgb * t_Albedo.rgb;

#if defined USE_SELFILLUM_FRESNEL
    float t_SelfIllumFresnelMin = u_SelfIllumFresnel.r;
    float t_SelfIllumFresnelMax = u_SelfIllumFresnel.g;
    float t_SelfIllumFresnelExp = u_SelfIllumFresnel.b;

    float t_SelfIllumFresnel = saturate(mix(t_SelfIllumFresnelMin, t_SelfIllumFresnelMax, pow(saturate(t_FresnelDot), t_SelfIllumFresnelExp)));
    t_SelfIllumMask.rgb *= t_SelfIllumFresnel;
#endif

    t_FinalDiffuse.rgb = mix(t_FinalDiffuse.rgb, t_SelfIllum.rgb, t_SelfIllumMask.rgb);
#endif

    t_FinalColor.rgb += t_FinalDiffuse;

#if !defined DEBUG_DIFFUSEONLY
    t_FinalColor.rgb += t_SpecularLighting.rgb;
    t_FinalColor.rgb += t_SpecularLightingEnvMap.rgb;
#endif

    t_FinalColor.a = t_Albedo.a;
    if (!use_base_alpha_envmap_mask)
        t_FinalColor.a *= t_BaseTexture.a;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
        `;
    }
}

const enum GenericShaderType {
    LightmappedGeneric, VertexLitGeneric, UnlitGeneric, WorldVertexTransition, Skin, Black, DecalModulate, Sprite, Unknown,
};

class Material_Generic extends BaseMaterial {
    private wantsTreeSway = false;
    private wantsDetail = false;
    private wantsBaseTexture2 = false;
    private wantsDecal = false;
    private wantsBumpmap = false;
    private wantsBumpmap2 = false;
    private wantsEnvmapMask = false;
    private wantsEnvmap = false;
    private wantsSelfIllum = false;
    private wantsSelfIllumFresnel = false;
    private wantsBlendModulate = false;
    private wantsPhong = false;
    private wantsPhongExponentTexture = false;
    private wantsDynamicLighting = false;
    private wantsAmbientCube = false;
    private wantsProjectedTexture = false;
    private shaderType: GenericShaderType;
    private objectParamsWordCount: number = 0;

    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private projectedLight: ProjectedLight | null = null;

    public override setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        let wantsStaticVertexLighting: boolean;
        let wantsDynamicVertexLighting: boolean;
        let wantsDynamicPixelLighting: boolean;

        const isStudioVertexLighting = (staticLightingMode === StaticLightingMode.StudioVertexLighting || staticLightingMode === StaticLightingMode.StudioVertexLighting3);
        const isStudioVertexLighting3 = (staticLightingMode === StaticLightingMode.StudioVertexLighting3);
        const isStudioAmbientCube = (staticLightingMode === StaticLightingMode.StudioAmbientCube);

        if (this.shaderType === GenericShaderType.VertexLitGeneric) {
            wantsStaticVertexLighting = isStudioVertexLighting;
            this.wantsAmbientCube = isStudioAmbientCube;
            wantsDynamicVertexLighting = isStudioAmbientCube;
            wantsDynamicPixelLighting = false;
        } else if (this.shaderType === GenericShaderType.Skin) {
            wantsStaticVertexLighting = isStudioVertexLighting;
            this.wantsAmbientCube = isStudioAmbientCube;
            wantsDynamicVertexLighting = false;
            wantsDynamicPixelLighting = true;
        } else {
            wantsStaticVertexLighting = false;
            this.wantsAmbientCube = false;
            wantsDynamicVertexLighting = false;
            wantsDynamicPixelLighting = false;
        }

        this.wantsDynamicLighting = wantsDynamicVertexLighting || wantsDynamicPixelLighting;

        // Ensure that we never have a lightmap at the same time as "studio model" lighting, as they're exclusive...
        if (wantsStaticVertexLighting || this.wantsDynamicLighting || this.wantsAmbientCube) {
            assert(!this.wantsLightmap);
        }

        let changed = false;
        changed = this.shaderInstance.setDefineBool('USE_STATIC_VERTEX_LIGHTING', wantsStaticVertexLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_STATIC_VERTEX_LIGHTING_3', isStudioVertexLighting3) || changed;
        changed = this.shaderInstance.setDefineBool('USE_DYNAMIC_VERTEX_LIGHTING', wantsDynamicVertexLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_DYNAMIC_PIXEL_LIGHTING', wantsDynamicPixelLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_DYNAMIC_LIGHTING', this.wantsDynamicLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_AMBIENT_CUBE', this.wantsAmbientCube) || changed;

        if (changed)
            this.gfxProgram = null;
    }

    protected override initParameters(): void {
        super.initParameters();

        const shaderTypeStr = this.vmt._Root.toLowerCase();
        if (shaderTypeStr === 'lightmappedgeneric')
            this.shaderType = GenericShaderType.LightmappedGeneric;
        else if (shaderTypeStr === 'vertexlitgeneric')
            this.shaderType = GenericShaderType.VertexLitGeneric;
        else if (shaderTypeStr === 'unlitgeneric')
            this.shaderType = GenericShaderType.UnlitGeneric;
        else if (shaderTypeStr === 'worldvertextransition')
            this.shaderType = GenericShaderType.WorldVertexTransition;
        else if (shaderTypeStr === 'black')
            this.shaderType = GenericShaderType.Black;
        else if (shaderTypeStr === 'decalmodulate')
            this.shaderType = GenericShaderType.DecalModulate;
        else if (shaderTypeStr === 'sprite')
            this.shaderType = GenericShaderType.Sprite;
        else
            this.shaderType = GenericShaderType.Unknown;

        const p = this.param;

        // Generic
        p['$envmap']                       = new ParameterTexture(true, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$envmapmask']                   = new ParameterTexture();
        p['$envmapmaskframe']              = new ParameterNumber(0);
        p['$envmapmasktransform']          = new ParameterMatrix();
        p['$envmaptint']                   = new ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new ParameterNumber(0);
        p['$envmapsaturation']             = new ParameterNumber(1);
        p['$envmaplightscale']             = new ParameterNumber(0);
        p['$fresnelreflection']            = new ParameterNumber(1);
        p['$detail']                       = new ParameterTexture();
        p['$detailframe']                  = new ParameterNumber(0);
        p['$detailblendmode']              = new ParameterNumber(0, false);
        p['$detailblendfactor']            = new ParameterNumber(1);
        p['$detailtint']                   = new ParameterColor(1, 1, 1);
        p['$detailscale']                  = new ParameterNumber(4);
        p['$detailtexturetransform']       = new ParameterMatrix();
        p['$bumpmap']                      = new ParameterTexture();             // Generic
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$bumpmap2']                     = new ParameterTexture();             // LightmappedGeneric, WorldVertexTransition
        p['$bumpframe2']                   = new ParameterNumber(0);
        p['$bumptransform2']               = new ParameterMatrix();
        p['$bumpmask']                     = new ParameterTexture();
        p['$alphatestreference']           = new ParameterNumber(0.7);
        p['$nodiffusebumplighting']        = new ParameterBoolean(false, false);
        p['$ssbump']                       = new ParameterBoolean(false, false);
        p['$halflambert']                  = new ParameterBoolean(false, false);
        p['$selfillumtint']                = new ParameterColor(1, 1, 1);
        p['$selfillummask']                = new ParameterTexture(false, false);
        p['$selfillumfresnel']             = new ParameterBoolean(false, false);
        p['$selfillumfresnelminmaxexp']    = new ParameterVector(3);
        p['$decaltexture']                 = new ParameterTexture();             // VertexLitGeneric, Phong
        p['$decalblendmode']               = new ParameterNumber(-1, false);

        // World Vertex Transition
        p['$basetexture2']                 = new ParameterTexture(true);         // WorldVertexTransition
        p['$frame2']                       = new ParameterNumber(0.0);
        p['$blendmodulatetexture']         = new ParameterTexture(true);         // WorldVertexTransition
        p['$blendmasktransform']           = new ParameterMatrix();
        p['$seamless_base']                = new ParameterBoolean(false, false);
        p['$seamless_detail']              = new ParameterBoolean(false, false);
        p['$seamless_scale']               = new ParameterNumber(0.0);

        // Phong (Skin)
        p['$phong']                        = new ParameterBoolean(false, false);
        p['$phongboost']                   = new ParameterNumber(1.0);
        p['$phongtint']                    = new ParameterColor(1, 1, 1);
        p['$phongalbedoboost']             = new ParameterNumber(1.0);
        p['$phongalbedotint']              = new ParameterBoolean(false, false);
        p['$phongexponent']                = new ParameterNumber(5.0);
        p['$phongexponenttexture']         = new ParameterTexture(false);       // Phong
        p['$phongexponentfactor']          = new ParameterNumber(149.0);
        p['$phongfresnelranges']           = new ParameterVector(3);
        p['$basemapalphaphongmask']        = new ParameterBoolean(false, false);
        p['$invertphongmask']              = new ParameterBoolean(false, false);

        // Sprite
        p['$spriteorientation']            = new ParameterString('parallel_upright');
        p['$spriteorigin']                 = new ParameterVector(2, [0.5, 0.5]);

        // TreeSway (VertexLitGeneric)
        p['$treesway']                     = new ParameterBoolean(false, false);
        p['$treeswayheight']               = new ParameterNumber(1000.0);
        p['$treeswaystartheight']          = new ParameterNumber(0.2);
        p['$treeswayradius']               = new ParameterNumber(300.0);
        p['$treeswaystartradius']          = new ParameterNumber(0.1);
        p['$treeswayspeed']                = new ParameterNumber(1.0);
        p['$treeswayspeedhighwindmultiplier'] = new ParameterNumber(2.0);
        p['$treeswayspeedstrength']        = new ParameterNumber(10.0);
        p['$treeswayspeedscrumblespeed']   = new ParameterNumber(0.1);
        p['$treeswayspeedscrumblestrength'] = new ParameterNumber(0.1);
        p['$treeswayspeedscrumblefrequency'] = new ParameterNumber(0.1);
        p['$treeswayfalloffexp']           = new ParameterNumber(1.5);
        p['$treeswayscrumblefalloffexp']   = new ParameterNumber(1.0);
        p['$treeswayspeedlerpstart']       = new ParameterNumber(3.0);
        p['$treeswayspeedlerpend']         = new ParameterNumber(6.0);
        p['$treeswaystatic']               = new ParameterBoolean(false, false);
    }

    private recacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = this.shaderInstance.getGfxProgram(cache);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected override initStaticBeforeResourceFetch() {
        // The detailBlendMode parameter determines whether we load an SRGB texture or not.
        const detailBlendMode = this.paramGetNumber('$detailblendmode');
        this.paramGetTexture('$detail').isSRGB = (detailBlendMode === 1);

        // The detailBlendMode parameter determines whether we load an SRGB texture or not.
        const decalBlendMode = this.paramGetNumber('$decalblendmode');
        this.paramGetTexture('$decaltexture').isSRGB = (decalBlendMode === 0);

        // decalmodulate doesn't load basetexture as sRGB.
        if (this.shaderType === GenericShaderType.DecalModulate)
            this.paramGetTexture('$basetexture').isSRGB = false;

        // In some world materials, $envmap is incorrectly set up and isn't overridden correctly.
        // In these cases, just replace it with a null texture.
        // Simple example: Portal 1's observationwall_001b.vmt overrides in escape_01
        if (this.shaderType === GenericShaderType.LightmappedGeneric && this.paramGetTexture('$envmap').ref === 'env_cubemap')
            this.paramGetTexture('$envmap').ref = null;
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Generic);

        if (this.shaderType === GenericShaderType.LightmappedGeneric || this.shaderType === GenericShaderType.WorldVertexTransition) {
            this.wantsLightmap = true;
            this.shaderInstance.setDefineBool('USE_LIGHTMAP', true);
        }

        if (this.shaderType === GenericShaderType.WorldVertexTransition) {
            this.wantsBaseTexture2 = true;
            this.shaderInstance.setDefineBool('USE_BASETEXTURE2', true);
        }

        if (this.wantsBaseTexture2 && this.paramGetVTF('$blendmodulatetexture') !== null) {
            this.wantsBlendModulate = true;
            this.shaderInstance.setDefineBool('USE_BLEND_MODULATE', true);
        }

        if (this.shaderType === GenericShaderType.VertexLitGeneric && this.paramGetBoolean('$phong')) {
            // $phong on a vertexlitgeneric tells it to use the Skin shader instead.
            this.shaderType = GenericShaderType.Skin;
            this.wantsPhong = true;
            this.shaderInstance.setDefineBool('USE_PHONG', true);

            if (this.paramGetVTF('$phongexponenttexture') !== null) {
                this.wantsPhongExponentTexture = true;
                this.shaderInstance.setDefineBool('USE_PHONG_EXPONENT_TEXTURE', true);
                this.shaderInstance.setDefineBool('USE_PHONG_ALBEDO_TINT', this.paramGetBoolean('$phongalbedotint'));
            }
        }

        if (this.paramGetBoolean('$treesway')) {
            this.wantsTreeSway = true;
            this.shaderInstance.setDefineBool('USE_TREE_SWAY', true);
        }

        if (this.paramGetVTF('$detail') !== null) {
            this.wantsDetail = true;
            this.shaderInstance.setDefineBool('USE_DETAIL', true);
            const detailBlendMode = this.paramGetNumber('$detailblendmode');
            this.shaderInstance.setDefineString('DETAIL_BLEND_MODE', '' + detailBlendMode);
        } else {
            this.shaderInstance.setDefineString('DETAIL_BLEND_MODE', '-1');
        }

        if (this.paramGetVTF('$bumpmap') !== null) {
            this.wantsBumpmap = true;
            this.shaderInstance.setDefineBool('USE_BUMPMAP', true);
            const wantsDiffuseBumpmap = !this.paramGetBoolean('$nodiffusebumplighting');
            this.shaderInstance.setDefineBool('USE_DIFFUSE_BUMPMAP', wantsDiffuseBumpmap);
            this.wantsBumpmappedLightmap = wantsDiffuseBumpmap;

            if (this.paramGetVTF('$bumpmap2') !== null) {
                this.wantsBumpmap2 = true;
                this.shaderInstance.setDefineBool(`USE_BUMPMAP2`, true);

                if (this.paramGetVTF('$bumpmask'))
                    this.shaderInstance.setDefineBool(`USE_BUMPMASK`, true);
            }
        }

        if (this.paramGetVTF('$decaltexture') !== null) {
            assert(!this.wantsBaseTexture2); // Incompatible with decal
            this.wantsDecal = true;
            this.shaderInstance.setDefineBool('USE_DECAL', true);
            const decalBlendMode = this.paramGetNumber('$decalblendmode');
            this.shaderInstance.setDefineString('DECAL_BLEND_MODE', '' + decalBlendMode);
        } else {
            this.shaderInstance.setDefineString('DECAL_BLEND_MODE', '-1');
        }

        if (this.paramGetVTF('$envmapmask') !== null) {
            this.wantsEnvmapMask = true;
            this.shaderInstance.setDefineBool('USE_ENVMAP_MASK', true);
        }

        if (this.paramGetVTF('$envmap') !== null) {
            this.wantsEnvmap = true;
            this.shaderInstance.setDefineBool('USE_ENVMAP', true);
        }

        if (this.paramGetBoolean('$selfillum')) {
            this.wantsSelfIllum = true;
            this.shaderInstance.setDefineBool('USE_SELFILLUM', true);

            if (this.paramGetVTF('$selfillummask')) {
                this.shaderInstance.setDefineBool('USE_SELFILLUM_MASK', true);
            }

            if (this.paramGetBoolean('$selfillumfresnel')) {
                this.wantsSelfIllumFresnel = true;
                this.shaderInstance.setDefineBool('USE_SELFILLUM_FRESNEL', true);
            }
        }

        // LightmappedGeneric uses only $seamless_scale to turn on seamless mode (for base), while the vertex has $seamless_base / $seamless_detail
        if (this.paramGetBoolean('$seamless_base')) {
            this.shaderInstance.setDefineBool('USE_SEAMLESS_BASE', true);
            if (this.paramGetNumber('$seamless_scale') === 0.0)
                this.paramSetNumber('$seamless_scale', 1.0);
        } else if (this.paramGetBoolean('$seamless_detail')) {
            this.shaderInstance.setDefineBool('USE_SEAMLESS_DETAIL', true);
            if (this.paramGetNumber('$seamless_scale') === 0.0)
                this.paramSetNumber('$seamless_scale', 1.0);
        } else if (this.paramGetNumber('$seamless_scale') > 0.0 && this.shaderType === GenericShaderType.LightmappedGeneric) {
            this.shaderInstance.setDefineBool('USE_SEAMLESS_BASE', true);
        }

        // Modulation color is used differently between lightmapped and non-lightmapped.
        // In vertexlit / unlit, then the modulation color is multiplied in with the texture (and possibly blended).
        // In lightmappedgeneric, then the modulation color is used as the diffuse lightmap scale, and contains the
        // lightmap scale factor.
        // USE_MODULATIONCOLOR_COLOR only handles the vertexlit / unlit case. USE_LIGHTMAP will also use the modulation
        // color if necessary.
        if (this.wantsLightmap) {
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_COLOR', false);
            // TODO(jstpierre): Figure out if modulation alpha is used in lightmappedgeneric.
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_ALPHA', false);
        } else {
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_COLOR', true);
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_ALPHA', true);
        }

        if (this.hasVertexColorInput && (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha')))
            this.shaderInstance.setDefineBool('USE_VERTEX_COLOR', true);

        if (this.paramGetBoolean('$basealphaenvmapmask'))
            this.shaderInstance.setDefineBool('USE_BASE_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$normalmapalphaenvmapmask') && this.wantsBumpmap)
            this.shaderInstance.setDefineBool('USE_NORMALMAP_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$basemapalphaphongmask'))
            this.shaderInstance.setDefineBool('USE_BASE_ALPHA_PHONG_MASK', true);

        if (this.paramGetBoolean('$invertphongmask'))
            this.shaderInstance.setDefineBool('USE_PHONG_MASK_INVERT', true);

        if (this.paramGetBoolean('$ssbump'))
            this.shaderInstance.setDefineBool('USE_SSBUMP', true);

        if (this.paramGetBoolean('$halflambert'))
            this.shaderInstance.setDefineBool('USE_HALF_LAMBERT', true);

        if (this.paramGetBoolean('$alphatest')) {
            this.shaderInstance.setDefineBool('USE_ALPHATEST', true);
        } else if (this.shaderType === GenericShaderType.DecalModulate) {
            this.isTranslucent = true;
            this.isToneMapped = false;

            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Dst,
                blendDstFactor: GfxBlendFactor.Src,
            });
            this.megaStateFlags.depthWrite = false;
        } else if (this.paramGetNumber('$rendermode') > 0) {
            const renderMode: RenderMode = this.paramGetNumber('$rendermode');

            if (renderMode === RenderMode.Glow || renderMode === RenderMode.WorldGlow) {
                this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Glow);
                // TODO(jstpierre): Once we support glow traces, re-enable this.
                // this.megaStateFlags.depthCompare = GfxCompareMode.Always;
            } else if (renderMode === RenderMode.TransAdd) {
                this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Add);
            } else {
                // Haven't seen this render mode yet.
                debugger;
            }
        } else {
            let isTranslucent = false;

            if (this.textureIsTranslucent('$basetexture'))
                isTranslucent = true;

            this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        }

        this.shaderInstance.setDefineBool(`USE_SSBUMP_NORMALIZE`, materialCache.ssbumpNormalize);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.recacheProgram(materialCache.cache);
        this.calcObjectParamsWordCount();
    }

    private updateTextureMappings(dst: TextureMapping[], renderContext: SourceRenderContext, lightmapPageIndex: number | null): void {
        resetTextureMappings(dst);

        const systemTextures = renderContext.materialCache.staticResources;
        if (!this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'))) {
            // If we don't have a base texture, then it depends on $envmap. With an $envmap, we bind black, otherwise
            // we bind white.
            if (this.wantsEnvmap)
                dst[0].gfxTexture = systemTextures.opaqueBlackTexture2D;
            else
                dst[0].gfxTexture = systemTextures.whiteTexture2D;
        }

        if (this.wantsBaseTexture2)
            this.paramGetTexture('$basetexture2').fillTextureMapping(dst[1], this.paramGetInt('$frame2'));

        this.paramGetTexture('$bumpmap').fillTextureMapping(dst[2], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$bumpmap2').fillTextureMapping(dst[3], this.paramGetInt('$bumpframe2'));
        this.paramGetTexture('$bumpmask').fillTextureMapping(dst[4], 0);
        this.paramGetTexture('$detail').fillTextureMapping(dst[5], this.paramGetInt('$detailframe'));

        if (this.wantsDecal)
            this.paramGetTexture('$decaltexture').fillTextureMapping(dst[1], 0);

        this.paramGetTexture('$envmapmask').fillTextureMapping(dst[6], this.paramGetInt('$envmapmaskframe'));
        this.paramGetTexture('$phongexponenttexture').fillTextureMapping(dst[7], 0);
        this.paramGetTexture('$selfillummask').fillTextureMapping(dst[8], 0);
        this.paramGetTexture('$blendmodulatetexture').fillTextureMapping(dst[9], 0);
        if (this.wantsLightmap)
            renderContext.lightmapManager.fillTextureMapping(dst[10], lightmapPageIndex);
        this.paramGetTexture('$envmap').fillTextureMapping(dst[11], this.paramGetInt('$envmapframe'));

        if (this.wantsProjectedTexture && renderContext.currentView.viewType !== SourceEngineViewType.ShadowMap) {
            dst[12].lateBinding = LateBindingTexture.ProjectedLightDepth;
            this.projectedLight!.texture!.fillTextureMapping(dst[13], this.projectedLight!.textureFrame);
        }
    }

    public override calcProjectedLight(renderContext: SourceRenderContext, bbox: AABB): void {
        if (this.shaderType === GenericShaderType.UnlitGeneric)
            return;

        let projectedLightRenderer = null;
        if (renderContext.currentViewRenderer !== null)
            projectedLightRenderer = renderContext.currentViewRenderer.currentProjectedLightRenderer;

        if (projectedLightRenderer !== null) {
            if (!projectedLightRenderer.light.frustumView.frustum.contains(bbox))
                projectedLightRenderer = null;
        }

        this.projectedLight = projectedLightRenderer !== null ? projectedLightRenderer.light : null;

        this.wantsProjectedTexture = this.projectedLight !== null && this.projectedLight.texture !== null;
        if (this.shaderInstance.setDefineBool('USE_PROJECTED_LIGHT', this.wantsProjectedTexture))
            this.gfxProgram = null;
    }

    private calcObjectParamsWordCount(): void {
        let vec4Count = 0;

        if (this.wantsAmbientCube)
            vec4Count += 6;
        if (this.wantsDynamicLighting)
            vec4Count += 4 * ShaderTemplate_Generic.MaxDynamicWorldLights;
        vec4Count += 2;
        if (this.wantsBumpmap)
            vec4Count += 2;
        if (this.wantsBumpmap2)
            vec4Count += 2;
        if (this.wantsDetail)
            vec4Count += 2;
        if (this.wantsEnvmapMask)
            vec4Count += 1;
        if (this.wantsBlendModulate)
            vec4Count += 1;
        if (this.wantsEnvmap)
            vec4Count += 2;
        if (this.wantsSelfIllum)
            vec4Count += 1;
        if (this.wantsSelfIllumFresnel)
            vec4Count += 1;
        if (this.wantsPhong)
            vec4Count += 2;
        if (this.wantsProjectedTexture)
            vec4Count += 4 + 2;
        if (this.wantsTreeSway)
            vec4Count += 5;
        vec4Count += 1; // Color
        vec4Count += 1; // Misc
        this.objectParamsWordCount = vec4Count * 4;
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, lightmapPageIndex: number | null = null): void {
        // TODO(jstpierre): Special shader program for depth-only?

        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings, renderContext, lightmapPageIndex);

        this.setupOverrideSceneParams(renderContext, renderInst);

        if (this.gfxProgram === null)
            this.calcObjectParamsWordCount();

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Generic.ub_ObjectParams, this.objectParamsWordCount);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Generic.ub_ObjectParams);

        if (this.wantsAmbientCube) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillAmbientCube(d, offs);
        }

        if (this.wantsDynamicLighting) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillWorldLights(d, offs, renderContext.worldLightingState);
        }

        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));

        if (this.wantsBumpmap)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform');

        if (this.wantsBumpmap2)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform2');

        if (this.wantsDetail) {
            const detailTextureTransform = this.paramGetMatrix('$detailtexturetransform');
            const detailScale = this.paramGetNumber('$detailscale');
            scaleMatrix(scratchMat4a, detailTextureTransform, detailScale, detailScale);
            offs += fillMatrix4x2(d, offs, scratchMat4a);
        }

        if (this.wantsEnvmapMask)
            offs += this.paramFillScaleBias(d, offs, '$envmapmasktransform');

        if (this.wantsBlendModulate)
            offs += this.paramFillScaleBias(d, offs, '$blendmasktransform');

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            const envmapLightScale = this.paramGetNumber('$envmaplightscale');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection, envmapLightScale);
        }

        if (this.wantsSelfIllum)
            offs += this.paramFillGammaColor(d, offs, '$selfillumtint');

        if (this.wantsSelfIllumFresnel) {
            const minMaxExp = this.paramGetVector('$selfillumfresnelminmaxexp');
            const min = minMaxExp.get(0), max = minMaxExp.get(1), exp = minMaxExp.get(2);
            offs += fillVec4(d, offs, min, max, exp);
        }

        if (this.wantsPhong) {
            const fresnelRanges = this.paramGetVector('$phongfresnelranges');
            const r0 = fresnelRanges.get(0), r1 = fresnelRanges.get(1), r2 = fresnelRanges.get(2);
            offs += fillVec4(d, offs, r0, r1, r2, this.paramGetNumber('$phongalbedoboost'));
            offs += this.paramFillColor(d, offs, '$phongtint', this.paramGetNumber('$phongboost'));
        }

        if (this.wantsProjectedTexture) {
            const projectedLight = this.projectedLight!;
            // We only need rows for X, Y and W (skip Z).
            offs += fillMatrix4x4(d, offs, projectedLight.frustumView.clipFromWorldMatrix);
            colorScale(scratchColor, projectedLight.lightColor, projectedLight.lightColor.a * projectedLight.brightnessScale * 0.25);
            offs += fillColor(d, offs, scratchColor);
            offs += fillVec3v(d, offs, projectedLight.frustumView.cameraPos, projectedLight.farZ);
        }

        if (this.wantsTreeSway) {
            const windDirX = 0.5, windDirY = 0.5;
            const time = renderContext.globalTime;
            offs += fillVec4(d, offs, windDirX, windDirY, time, this.paramGetNumber('$treeswayspeed'));

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswayheight'),
                this.paramGetNumber('$treeswaystartheight'),
                this.paramGetNumber('$treeswayradius'),
                this.paramGetNumber('$treeswaystartradius'),
            );

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswaystrength'),
                this.paramGetNumber('$treeswayfalloffexp'),
                this.paramGetNumber('$treeswayspeedhighwindmultiplier'),
            );

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswayscrumblestrength'),
                this.paramGetNumber('$treeswayscrumblefalloffexp'),
                this.paramGetNumber('$treeswayscrumblefrequency'),
                this.paramGetNumber('$treeswayscrumblespeed'),
            );

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswayspeedlerpstart'),
                this.paramGetNumber('$treeswayspeedlerpend'),
            );
        }

        // Compute modulation color.
        if (this.shaderType === GenericShaderType.Black) {
            colorCopy(scratchColor, OpaqueBlack);
        } else {
            colorCopy(scratchColor, White);
            this.paramGetVector('$color').mulColor(scratchColor);
            this.paramGetVector('$color2').mulColor(scratchColor);
        }

        scratchColor.a *= this.paramGetNumber('$alpha');
        offs += fillColor(d, offs, scratchColor);

        const alphaTestReference = this.paramGetNumber('$alphatestreference');
        const detailBlendFactor = this.paramGetNumber('$detailblendfactor');
        const specExponentFactor = this.wantsPhongExponentTexture ? this.paramGetNumber('$phongexponentfactor') : this.paramGetNumber('$phongexponent');
        const seamlessScale = this.paramGetNumber('$seamless_scale');
        offs += fillVec4(d, offs, alphaTestReference, detailBlendFactor, specExponentFactor, seamlessScale);

        this.recacheProgram(renderContext.renderCache);
        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public destroy(device: GfxDevice): void {
    }
}

// Modulate
class ShaderTemplate_Modulate extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x2 u_BaseTextureTransform;
};

varying vec3 v_PositionWorld;
// BaseTexture
varying vec2 v_TexCoord0;

// BaseTexture
uniform sampler2D u_BaseTexture;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_TexCoord0.xy = Mul(u_BaseTextureTransform, vec4(a_TexCoord01.xy, 1.0, 1.0));
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_BaseTextureSample = texture(SAMPLER_2D(u_BaseTexture), v_TexCoord0.xy);
    vec4 t_FinalColor = t_BaseTextureSample;
    t_FinalColor.rgb = mix(vec3(0.5), t_FinalColor.rgb, t_FinalColor.a);

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Modulate extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$mod2x']                        = new ParameterBoolean(false, false);
        p['$writez']                       = new ParameterBoolean(false, false);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Modulate);

        const isTranslucent = this.paramGetBoolean('$translucent') || this.textureIsTranslucent('$basetexture');
        const blendMode = this.getAlphaBlendMode(isTranslucent);

        const opaque = this.paramGetBoolean('$writez') && !(blendMode === AlphaBlendMode.Blend || blendMode === AlphaBlendMode.Glow);

        this.megaStateFlags.depthWrite = opaque;
        this.isTranslucent = !opaque;

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.Dst,
            blendDstFactor: this.paramGetBoolean('$mod2x') ? GfxBlendFactor.Src : GfxBlendFactor.Zero,
        });

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Modulate.ub_ObjectParams, 8);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Modulate.ub_ObjectParams);

        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));

        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}

// UnlitTwoTexture
class ShaderTemplate_UnlitTwoTexture extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x2 u_Texture1Transform;
    Mat4x2 u_Texture2Transform;
    vec4 u_ModulationColor;
};

varying vec3 v_PositionWorld;
// Texture1, Texture2
varying vec4 v_TexCoord0;

// Texture1, Texture2
uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_TexCoord0.xy = Mul(u_Texture1Transform, vec4(a_TexCoord01.xy, 1.0, 1.0));
    v_TexCoord0.zw = Mul(u_Texture2Transform, vec4(a_TexCoord01.xy, 1.0, 1.0));
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_Texture1 = texture(SAMPLER_2D(u_Texture1), v_TexCoord0.xy);
    vec4 t_Texture2 = texture(SAMPLER_2D(u_Texture2), v_TexCoord0.zw);
    vec4 t_FinalColor = t_Texture1 * t_Texture2 * u_ModulationColor;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_UnlitTwoTexture extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$texture2']                     = new ParameterTexture(true);
        p['$texture2transform']            = new ParameterMatrix();
        p['$frame2']                       = new ParameterNumber(0.0);

        // TODO(jstpierre): MonitorScreen tint/constrast/saturation.
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.UnlitTwoTexture);

        const isTranslucent = this.paramGetBoolean('$translucent') || this.textureIsTranslucent('$basetexture') || this.textureIsTranslucent('$texture2');
        this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$texture2').fillTextureMapping(dst[1], this.paramGetInt('$frame2'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_UnlitTwoTexture.ub_ObjectParams, 20);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_UnlitTwoTexture.ub_ObjectParams);
        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));
        offs += this.paramFillTextureMatrix(d, offs, '$texture2transform');
        offs += this.paramFillColor(d, offs, '$color', this.paramGetNumber('$alpha'));

        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Water
const SampleFlowMap = `
vec4 SampleFlowMap(PD_SAMPLER_2D(t_FlowMapTexture), vec2 t_TexCoordBase, float t_FlowTimeInIntervals, float t_TexCoordScrollDistance, vec2 t_FlowVectorTangent, float t_LerpExp) {
    float t_ScrollTime1 = fract(t_FlowTimeInIntervals + 0.0);
    float t_ScrollTime2 = fract(t_FlowTimeInIntervals + 0.5);
    float t_ScrollPhase1 = floor(t_FlowTimeInIntervals) * 0.311;
    float t_ScrollPhase2 = floor(t_FlowTimeInIntervals + 0.5) * 0.311 + 0.5;

    vec2 t_FlowMapTexCoordDisp = t_TexCoordScrollDistance * t_FlowVectorTangent.xy;
    vec2 t_FlowMapTexCoord1 = t_TexCoordBase + t_ScrollPhase1 + (t_ScrollTime1 * t_FlowMapTexCoordDisp.xy);
    vec2 t_FlowMapTexCoord2 = t_TexCoordBase + t_ScrollPhase2 + (t_ScrollTime2 * t_FlowMapTexCoordDisp.xy);

    vec4 t_FlowMapSample1 = texture(PU_SAMPLER_2D(t_FlowMapTexture), t_FlowMapTexCoord1.xy);
    vec4 t_FlowMapSample2 = texture(PU_SAMPLER_2D(t_FlowMapTexture), t_FlowMapTexCoord2.xy);
    float t_FlowMapWeight1 = pow(abs(t_ScrollTime2 * 2.0 - 1.0), t_LerpExp);
    float t_FlowMapWeight2 = pow(abs(t_ScrollTime1 * 2.0 - 1.0), t_LerpExp);
    vec4 t_FlowMapSample = vec4(0.0);
    t_FlowMapSample.rgba += t_FlowMapSample1.rgba * t_FlowMapWeight1;
    t_FlowMapSample.rgba += t_FlowMapSample2.rgba * t_FlowMapWeight2;

    return t_FlowMapSample;
}
`;

class ShaderTemplate_Water extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override generateProgramString(m: Map<string, string>): string {
        return `
precision mediump float;
precision mediump sampler2DArray;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    vec4 u_BumpScaleBias;
#if defined USE_TEXSCROLL
    vec4 u_TexScroll0ScaleBias;
    vec4 u_TexScroll1ScaleBias;
#endif
    vec4 u_RefractTint;
    vec4 u_ReflectTint;
    vec4 u_WaterFogColor;
    Mat4x4 u_ProjectedDepthToWorld;

#if defined USE_FLOWMAP
    vec4 u_BaseTextureScaleBias;
    vec4 u_Misc[3];
#endif
};

#define u_RefractAmount (u_RefractTint.a)
#define u_ReflectAmount (u_ReflectTint.a)
#define u_WaterFogRange (u_WaterFogColor.a)

#if defined USE_FLOWMAP

#define u_FlowTexCoordScale                (u_Misc[0].x)
#define u_FlowNormalTexCoordScale          (u_Misc[0].y)
#define u_FlowNoiseTexCoordScale           (u_Misc[0].z)
#define u_FlowColorTexCoordScale           (u_Misc[0].w)

#define u_FlowTimeInIntervals              (u_Misc[1].x)
#define u_FlowColorTimeInIntervals         (u_Misc[1].y)
#define u_FlowNormalTexCoordScrollDistance (u_Misc[1].z)
#define u_FlowColorTexCoordScrollDistance  (u_Misc[1].w)

#define u_FlowBumpStrength                 (u_Misc[2].x)
#define u_FlowColorDisplacementStrength    (u_Misc[2].y)
#define u_FlowColorLerpExp                 (u_Misc[2].z)
#define u_WaterBlendFactor                 (u_Misc[2].w)

#endif

// Refract Coordinates
varying vec3 v_TexCoord0;
// Normal Map / Base Texture, Lightmap
varying vec4 v_TexCoord1;
varying vec3 v_PositionWorld;

layout(binding = 0) uniform sampler2D u_TextureRefract;
layout(binding = 1) uniform sampler2D u_TextureNormalmap;
layout(binding = 2) uniform sampler2D u_TextureReflect;
layout(binding = 3) uniform sampler2D u_TextureBase;
layout(binding = 4) uniform sampler2D u_TextureFlowmap;
layout(binding = 5) uniform sampler2D u_TextureFlowNoise;

layout(binding = 10) uniform sampler2DArray u_TextureLightmap;
layout(binding = 11) uniform samplerCube u_TextureEnvmap;
layout(binding = 14) uniform sampler2D u_TextureFramebufferDepth;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    // Convert from projected position to texture space.
    // TODO(jstpierre): This could probably be done easier with gl_FragCoord
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xyzw = a_TexCoord01.xyzw;
}
#endif

#if defined FRAG
vec2 SampleFramebufferCoord(vec2 t_TexCoord) {
#if defined GFX_VIEWPORT_ORIGIN_TL
    t_TexCoord.y = 1.0 - t_TexCoord.y;
#endif
    return t_TexCoord;
}

float SampleFramebufferDepth(vec2 t_ProjTexCoord) {
    return texture(SAMPLER_2D(u_TextureFramebufferDepth), t_ProjTexCoord).r;
}

bool IsSomethingInFront(float t_DepthSample) {
    if (t_DepthSample ${IS_DEPTH_REVERSED ? `>` : `<`} gl_FragCoord.z)
        return true;

    return false;
}

vec4 CalcPosClipFromViewport(vec3 t_PosViewport) {
    vec4 t_PosClip = vec4(t_PosViewport.xy * 2.0 - 1.0, t_PosViewport.z, 1.0);
#if !defined GFX_CLIPSPACE_NEAR_ZERO
    t_PosClip.z = t_PosClip.z * 2.0 - 1.0;
#endif
    return t_PosClip;
}

vec3 CalcPosWorldFromScreen(vec2 t_ProjTexCoord, float t_DepthSample) {
    // Reconstruct world-space position for the sample.
    vec3 t_PosViewport = vec3(t_ProjTexCoord.x, t_ProjTexCoord.y, t_DepthSample);
    vec4 t_PosClip = CalcPosClipFromViewport(t_PosViewport);
    vec4 t_PosWorld = Mul(u_ProjectedDepthToWorld, t_PosClip);
    // Divide by W.
    t_PosWorld.xyz /= t_PosWorld.www;
    return t_PosWorld.xyz;
}

float CalcFogAmountFromScreenPos(vec2 t_ProjTexCoord, float t_DepthSample) {
    vec3 t_DepthSamplePosWorld = CalcPosWorldFromScreen(t_ProjTexCoord, t_DepthSample);

    // Now retrieve the height difference (+Z is up in Source Engine BSP space)
    float t_HeightDifference = v_PositionWorld.z - t_DepthSamplePosWorld.z;

    // Also account for the distance from the eye (emulate "traditional" scattering fog)
    float t_DistanceFromEye = u_CameraPosWorld.z - v_PositionWorld.z;
    float t_FogDepth = saturate(t_HeightDifference / t_DistanceFromEye);

    // float t_PositionClipZ = v_PositionWorld.w;
    // Not quite equivalent since we don't have the near clip plane, but it's close enough and doesn't
    // depend on a certain configuration in our projection matrix.
    float t_PositionClipZ = distance(u_CameraPosWorld.xyz, v_PositionWorld.xyz);

    float t_FogAmount = saturate((t_FogDepth * t_PositionClipZ) / u_WaterFogRange);

    return t_FogAmount;
}

${SampleFlowMap}

vec3 ReconstructNormal(in vec2 t_NormalXY) {
    float t_NormalZ = sqrt(saturate(1.0 - dot(t_NormalXY.xy, t_NormalXY.xy)));
    return vec3(t_NormalXY.xy, t_NormalZ);
}

void mainPS() {
    bool use_flowmap = ${getDefineBool(m, `USE_FLOWMAP`)};

    vec2 t_BumpmapCoord0 = CalcScaleBias(v_TexCoord1.xy, u_BumpScaleBias);

#if defined USE_FLOWMAP

    vec2 t_FlowTexCoord = t_BumpmapCoord0.xy * u_FlowTexCoordScale;

    vec2 t_TexCoordWorldBase = vec2(v_PositionWorld.x, -v_PositionWorld.y);
    vec2 t_FlowNoiseTexCoord = t_TexCoordWorldBase * u_FlowNoiseTexCoordScale;
    vec4 t_FlowNoiseSample = texture(SAMPLER_2D(u_TextureFlowNoise), t_FlowNoiseTexCoord.xy);

    vec4 t_FlowSample = texture(SAMPLER_2D(u_TextureFlowmap), t_FlowTexCoord.xy);
    vec2 t_FlowVectorTangent = UnpackUnsignedNormalMap(t_FlowSample).rg;

    vec2 t_FlowNormalTexCoordBase = t_TexCoordWorldBase * u_FlowNormalTexCoordScale;
    float t_FlowTimeInIntervals = u_FlowTimeInIntervals + t_FlowNoiseSample.g;
    float t_FlowNormalLerpExp = 1.0;
    vec4 t_FlowNormalSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureNormalmap), t_FlowNormalTexCoordBase.xy, t_FlowTimeInIntervals, u_FlowNormalTexCoordScrollDistance, t_FlowVectorTangent.xy, t_FlowNormalLerpExp);

    vec2 t_FlowNormalXY = UnpackUnsignedNormalMap(t_FlowNormalSample).xy * (length(t_FlowVectorTangent.xy) + 0.1) * u_FlowBumpStrength;
    vec3 t_BumpmapNormal = ReconstructNormal(t_FlowNormalXY);
    float t_BumpmapStrength = 1.0;

#else

    // Sample our normal map with scroll offsets.
    vec4 t_BumpmapSample0 = texture(SAMPLER_2D(u_TextureNormalmap), t_BumpmapCoord0);
#if defined USE_TEXSCROLL
    vec2 t_BumpmapCoord1 = CalcScaleBias(vec2(v_TexCoord1.x + v_TexCoord1.y, -v_TexCoord1.x + v_TexCoord1.y) * 0.1, u_TexScroll0ScaleBias);
    vec4 t_BumpmapSample1 = texture(SAMPLER_2D(u_TextureNormalmap), t_BumpmapCoord1);
    vec2 t_BumpmapCoord2 = CalcScaleBias(v_TexCoord1.yx * 0.45, u_TexScroll1ScaleBias);
    vec4 t_BumpmapSample2 = texture(SAMPLER_2D(u_TextureNormalmap), t_BumpmapCoord2);
    vec4 t_BumpmapSample = (0.33 * (t_BumpmapSample0 + t_BumpmapSample1 + t_BumpmapSample2));
#else
    vec4 t_BumpmapSample = t_BumpmapSample0;
#endif
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample).rgb;
    float t_BumpmapStrength = t_BumpmapSample.a;

#endif

    // It's assumed the surface normal is facing up, so this is roughly correct.
    vec3 t_NormalWorld = t_BumpmapNormal.xyz;

    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    float t_NoV = saturate(dot(t_WorldDirectionToEye.xyz, t_NormalWorld.xyz));
    float t_Reflectance = 0.2;
    float t_Fresnel = mix(CalcFresnelTerm5(t_NoV), 1.0, t_Reflectance);

    // Compute reflection and refraction colors.

    vec3 t_DiffuseLighting = vec3(1.0);

    bool use_lightmap_water_fog = ${getDefineBool(m, `USE_LIGHTMAP_WATER_FOG`)};
    if (use_lightmap_water_fog) {
        vec3 t_LightmapColor = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.zw, 0.0)));
        t_DiffuseLighting.rgb *= t_LightmapColor;
    }
    vec3 t_WaterFogColor = u_WaterFogColor.rgb * t_DiffuseLighting.rgb;

    // Compute a 2D offset vector in view space.
    // TODO(jstpierre): Rotate bumpmap normal to be in camera space.
    vec2 t_TexCoordBumpOffset = t_BumpmapNormal.xy * t_BumpmapStrength;

    vec3 t_RefractColor;
    bool use_refract = ${getDefineBool(m, `USE_REFRACT`)};
    if (use_refract) {
        float t_RefractFogBendAmount = CalcFogAmountFromScreenPos(t_ProjTexCoord, SampleFramebufferDepth(SampleFramebufferCoord(t_ProjTexCoord)));
        float t_RefractStrength = u_RefractAmount * (1.0 - t_RefractFogBendAmount);
        vec2 t_RefractTexCoord = t_ProjTexCoord + (t_TexCoordBumpOffset.xy * t_RefractStrength);

        float t_RefractFogAmount;
        float t_RefractDepthSample = SampleFramebufferDepth(SampleFramebufferCoord(t_RefractTexCoord));
        if (IsSomethingInFront(t_RefractDepthSample)) {
            // Something's in front, just use the original...
            t_RefractTexCoord = t_ProjTexCoord;
            t_RefractFogAmount = t_RefractFogBendAmount;
        } else {
            t_RefractFogAmount = CalcFogAmountFromScreenPos(t_RefractTexCoord, t_RefractDepthSample);
        }

        vec4 t_RefractSample = texture(SAMPLER_2D(u_TextureRefract), SampleFramebufferCoord(t_RefractTexCoord));

        // Our refraction framebuffer has been tone-mapped. Divide back out to get linear.
        t_RefractSample.rgb /= u_ToneMapScale;

        t_RefractColor.rgb = t_RefractSample.rgb * u_RefractTint.rgb;

        t_RefractColor.rgb = mix(t_RefractColor.rgb, t_WaterFogColor.rgb, t_RefractFogAmount);
    } else {
        t_RefractColor.rgb = t_WaterFogColor.rgb;
    }

    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_WorldDirectionToEye);

    vec3 t_ReflectColor = vec3(0.0);

    float t_ReflectAmount = u_ReflectAmount;
    if (t_ReflectAmount > 0.0) {
        vec2 t_ReflectTexCoord = t_ProjTexCoord + (t_TexCoordBumpOffset.xy * t_ReflectAmount);

        // Reflection texture is stored upside down
        t_ReflectTexCoord.y = 1.0 - t_ReflectTexCoord.y;

        vec4 t_ReflectSample = texture(SAMPLER_2D(u_TextureReflect), SampleFramebufferCoord(t_ReflectTexCoord));

        // Our reflection framebuffer has been tone-mapped. Divide back out to get linear.
        t_ReflectSample.rgb /= u_ToneMapScale;

        t_ReflectColor = t_ReflectSample.rgb * u_ReflectTint.rgb;
    } else if (t_ReflectAmount < 0.0) {
        vec4 t_ReflectSample = texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection) * g_EnvmapScale;
        t_ReflectColor = t_ReflectSample.rgb * u_ReflectTint.rgb;
    }

    vec4 t_FinalColor;

#if defined USE_FLOWMAP
    bool use_flowmap_basetexture = ${getDefineBool(m, `USE_FLOWMAP_BASETEXTURE`)};
    if (use_flowmap_basetexture) {
        // Parallax scum layer
        float t_ParallaxStrength = t_FlowNormalSample.a * u_FlowColorDisplacementStrength;
        vec3 t_InteriorDirection = t_ParallaxStrength * (t_WorldDirectionToEye.xyz - t_NormalWorld.xyz);
        vec2 t_FlowColorTexCoordBase = t_TexCoordWorldBase.xy * u_FlowColorTexCoordScale + t_InteriorDirection.xy;
        float t_FlowColorTimeInIntervals = u_FlowColorTimeInIntervals + t_FlowNoiseSample.g;
        vec4 t_FlowColorSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureBase), t_FlowColorTexCoordBase, t_FlowColorTimeInIntervals, u_FlowColorTexCoordScrollDistance, t_FlowVectorTangent.xy, u_FlowColorLerpExp);

        vec4 t_FlowColor = t_FlowColorSample.rgba;

        // Mask by flowmap alpha and apply light
        t_FlowColor.rgba *= t_FlowSample.a;
        t_FlowColor.rgb *= t_DiffuseLighting.rgb;

        // Sludge can either be below or on top of the water, according to base texture alpha.
        //   0.0 - 0.5 = translucency, and 0.5 - 1.0 = above water
        t_RefractColor.rgb = mix(t_RefractColor.rgb, t_FlowColor.rgb, saturate(invlerp(0.0, 0.5, t_FlowColor.a)));

        float t_AboveWater = 1.0 - smoothstep(0.5, 0.7, t_FlowColor.a);
        t_Fresnel = saturate(t_Fresnel * t_AboveWater);
    }
#endif

    t_FinalColor.rgb = t_RefractColor.rgb + (t_ReflectColor.rgb * t_Fresnel);

#if defined USE_FLOWMAP
    t_FinalColor.a = u_WaterBlendFactor;
#endif

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
    }
}

class Material_Water extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram | null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    private wantsTexScroll = false;
    private wantsFlowmap = false;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$envmap']                       = new ParameterTexture(true, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$refracttexture']               = new ParameterTexture(true, false, '_rt_WaterRefraction');
        p['$refracttint']                  = new ParameterColor(1, 1, 1);
        p['$refractamount']                = new ParameterNumber(0);
        p['$reflecttexture']               = new ParameterTexture(true, false, '_rt_WaterReflection');
        p['$reflecttint']                  = new ParameterColor(1, 1, 1);
        p['$reflectamount']                = new ParameterNumber(0.8);
        p['$scroll1']                      = new ParameterVector(3);
        p['$scroll2']                      = new ParameterVector(3);
        p['$cheapwaterstartdistance']      = new ParameterNumber(500.0);
        p['$cheapwaterenddistance']        = new ParameterNumber(1000.0);

        p['$forcecheap']                   = new ParameterBoolean(false, false);
        p['$forceenvmap']                  = new ParameterBoolean(false, false);

        p['$flowmap']                      = new ParameterTexture(false, false);
        p['$flowmapframe']                 = new ParameterNumber(0);
        p['$flowmapscrollrate']            = new ParameterVector(2);
        p['$flow_worlduvscale']            = new ParameterNumber(1);
        p['$flow_normaluvscale']           = new ParameterNumber(1);
        p['$flow_bumpstrength']            = new ParameterNumber(1);
        p['$flow_noise_texture']           = new ParameterTexture(false, false);
        p['$flow_noise_scale']             = new ParameterNumber(0.0002);
        p['$flow_timeintervalinseconds']   = new ParameterNumber(0.4);
        p['$flow_uvscrolldistance']        = new ParameterNumber(0.2);

        p['$color_flow_uvscale']           = new ParameterNumber(1);
        p['$color_flow_timeintervalinseconds'] = new ParameterNumber(0.4);
        p['$color_flow_uvscrolldistance']  = new ParameterNumber(0.2);
        p['$color_flow_lerpexp']           = new ParameterNumber(1);
        p['$color_flow_displacebynormalstrength'] = new ParameterNumber(0.0025);

        p['$lightmapwaterfog']             = new ParameterBoolean(false, false);
        p['$waterblendfactor']             = new ParameterNumber(1.0);
        p['$fogcolor']                     = new ParameterColor(0, 0, 0);

        // Hacky way to get RT depth
        p['$depthtexture']                 = new ParameterTexture(false, false, '_rt_Depth');
    }

    private recacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = this.shaderInstance.getGfxProgram(cache);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Water);

        if (this.paramGetVTF('$flowmap') !== null) {
            this.wantsFlowmap = true;
            this.shaderInstance.setDefineBool('USE_FLOWMAP', true);

            if (this.paramGetVTF('$basetexture') !== null)
                this.shaderInstance.setDefineBool('USE_FLOWMAP_BASETEXTURE', true);

            if (this.paramGetBoolean('$lightmapwaterfog')) {
                this.shaderInstance.setDefineBool('USE_LIGHTMAP_WATER_FOG', true);
                this.wantsLightmap = true;
            }

            this.isTranslucent = false;
        } else {
            if (this.paramGetVector('$scroll1').get(0) !== 0) {
                this.wantsTexScroll = true;
                this.shaderInstance.setDefineBool('USE_TEXSCROLL', true);
            }
        }

        if (this.paramGetVTF('$refracttexture') !== null)
            this.shaderInstance.setDefineBool('USE_REFRACT', true);

        this.isIndirect = this.textureIsIndirect('$refracttexture') || this.textureIsIndirect('$reflecttexture');

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, lightmapPageIndex: number | null = null): void {
        assert(this.isMaterialLoaded());

        this.setupOverrideSceneParams(renderContext, renderInst);

        resetTextureMappings(textureMappings);

        this.paramGetTexture('$refracttexture').fillTextureMapping(textureMappings[0], 0);
        this.paramGetTexture('$normalmap').fillTextureMapping(textureMappings[1], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$reflecttexture').fillTextureMapping(textureMappings[2], 0);

        this.paramGetTexture('$basetexture').fillTextureMapping(textureMappings[3], this.paramGetInt('$frame'));
        this.paramGetTexture('$flowmap').fillTextureMapping(textureMappings[4], this.paramGetInt('$flowmapframe'));
        this.paramGetTexture('$flow_noise_texture').fillTextureMapping(textureMappings[5], 0);

        renderContext.lightmapManager.fillTextureMapping(textureMappings[10], lightmapPageIndex);
        this.paramGetTexture('$envmap').fillTextureMapping(textureMappings[11], this.paramGetInt('$envmapframe'));
        this.paramGetTexture('$depthtexture').fillTextureMapping(textureMappings[14], 0);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Water.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Water.ub_ObjectParams);
        offs += this.paramFillScaleBias(d, offs, '$bumptransform');

        if (this.wantsTexScroll) {
            const m = scratchMat4a;
            mat4.identity(m);
            m[0] = this.texCoord0Scale[0];
            m[5] = this.texCoord0Scale[1];

            m[12] = this.paramGetVector('$scroll1').get(0) * renderContext.globalTime;
            m[13] = this.paramGetVector('$scroll1').get(1) * renderContext.globalTime;
            offs += fillScaleBias(d, offs, m);

            m[12] = this.paramGetVector('$scroll2').get(0) * renderContext.globalTime;
            m[13] = this.paramGetVector('$scroll2').get(1) * renderContext.globalTime;
            offs += fillScaleBias(d, offs, m);
        }

        const forceEnvMap = this.paramGetBoolean('$forceenvmap');
        const forceCheap = this.paramGetBoolean('$forcecheap');
        const useExpensiveReflect = renderContext.currentView.useExpensiveWater && !forceEnvMap && !forceCheap;

        let reflectAmount = this.paramGetNumber('$reflectamount');
        if (!useExpensiveReflect)
            reflectAmount = -1.0;

        offs += this.paramFillGammaColor(d, offs, '$refracttint', this.paramGetNumber('$refractamount'));
        offs += this.paramFillGammaColor(d, offs, '$reflecttint', reflectAmount);

        const fogStart = this.paramGetNumber('$fogstart');
        const fogEnd = this.paramGetNumber('$fogend');
        // The start is actually unused, only the range is used...
        const fogRange = fogEnd - fogStart;

        this.paramGetVector('$fogcolor').fillColor(scratchColor, fogRange);
        offs += fillGammaColor(d, offs, scratchColor);

        // This will take us from -1...1 to world space position.
        mat4.invert(scratchMat4a, renderContext.currentView.clipFromWorldMatrix);
        offs += fillMatrix4x4(d, offs, scratchMat4a);

        if (this.wantsFlowmap) {
            offs += this.paramFillScaleBias(d, offs, '$basetexturetransform');

            // Texture coordinate scales
            offs += fillVec4(d, offs,
                1.0 / this.paramGetNumber('$flow_worlduvscale'),
                1.0 / this.paramGetNumber('$flow_normaluvscale'),
                this.paramGetNumber('$flow_noise_scale'),
                1.0 / this.paramGetNumber('$color_flow_uvscale'));

            // Compute local time.
            const timeInIntervals = (renderContext.globalTime) / (this.paramGetNumber('$flow_timeintervalinseconds') * 2.0);
            const colorTimeInIntervals = (renderContext.globalTime) / (this.paramGetNumber('$color_flow_timeintervalinseconds') * 2.0);
            offs += fillVec4(d, offs,
                timeInIntervals,
                colorTimeInIntervals,
                this.paramGetNumber('$flow_uvscrolldistance'),
                this.paramGetNumber('$color_flow_uvscrolldistance'));

            offs += fillVec4(d, offs,
                this.paramGetNumber('$flow_bumpstrength'),
                this.paramGetNumber('$color_flow_displacebynormalstrength'),
                this.paramGetNumber('$color_flow_lerpexp'),
                this.paramGetNumber('$waterblendfactor'));
        }

        this.recacheProgram(renderContext.renderCache);
        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public override isMaterialVisible(renderContext: SourceRenderContext): boolean {
        if (!super.isMaterialVisible(renderContext))
            return false;

        if (renderContext.currentView.viewType === SourceEngineViewType.WaterReflectView)
            return false;

        return true;
    }
}
//#endregion

//#region Refract
class ShaderTemplate_Refract extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    vec4 u_BumpScaleBias;
    vec4 u_RefractTint;
    vec4 u_Misc[1];
#if defined USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
#if defined USE_VERTEX_MODULATE
    // XXX(jstpierre): ParticleSystem uses a uniform buffer until
    // we can switch it to using custom vertex data.
    vec4 u_FakeVertexModulate;
#endif
};

#define u_RefractAmount (u_RefractTint.a)
#define u_RefractDepth  (u_Misc[0].x)

// Base Texture Coordinates
varying vec3 v_TexCoord0;
// Normal Map Coordinates
varying vec2 v_TexCoord1;
varying vec3 v_PositionWorld;

#if defined USE_VERTEX_MODULATE
varying vec4 v_Modulate;
#endif

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Base Texture, Normalmap, Refract Tint Texture
layout(binding = 0) uniform sampler2D u_TextureBase;
layout(binding = 1) uniform sampler2D u_TextureNormalmap;
layout(binding = 2) uniform sampler2D u_TextureRefractTint;

// Envmap
layout(binding = 11) uniform samplerCube u_TextureEnvmap;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    vec3 t_NormalWorld = normalize(Mul(t_WorldFromLocalMatrix, vec4(a_Normal.xyz, 0.0)));

    vec3 t_TangentSWorld = normalize(Mul(t_WorldFromLocalMatrix, vec4(a_TangentS.xyz, 0.0)));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    // Convert from projected position to texture space.
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xy = CalcScaleBias(a_TexCoord01.xy, u_BumpScaleBias);

#if defined USE_VERTEX_MODULATE
    v_Modulate.rgba = a_Color.rgba * u_FakeVertexModulate.rgba;
#endif
}
#endif

#if defined FRAG
void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord1.xy;
    vec4 t_BumpmapSample = UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureNormalmap), t_BumpmapCoord0));
    vec3 t_BumpmapNormal = t_BumpmapSample.rgb;

    vec4 t_FinalColor = vec4(0);

    vec3 t_RefractTint = u_RefractTint.rgb;
#if defined USE_REFRACT_TINT_TEXTURE
    vec4 t_RefractTintTextureSample = texture(SAMPLER_2D(u_TextureRefractTint), t_BumpmapCoord0);
    t_RefractTint *= 2.0 * t_RefractTintTextureSample.rgb;
#endif

#if defined USE_VERTEX_MODULATE
    t_RefractTint.rgb *= v_Modulate.rgb;
#endif

#if defined USE_LOCAL_REFRACT
    vec3 t_LookDirWorld = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    // Get the tangent-space look direction to offset our texture.
    vec3 t_LookDirTangent = normalize(CalcWorldToTangent(t_LookDirWorld, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2));

    // Look dir in tangent space gives us the texture offset.
    // That is, when viewed in view-space, we move parallel to the view-space surface normal.
    vec2 t_RefractOffs = -t_LookDirTangent.xy / t_LookDirTangent.zz;
    vec2 t_RefractTexCoordOffs = t_RefractOffs.xy;

    // Add on the bumpmap normal for displacement.
    t_RefractTexCoordOffs += t_BumpmapNormal.xy + (1.0 - t_BumpmapNormal.z) * t_RefractOffs.xy;

    vec2 t_TexSize = vec2(textureSize(TEXTURE(u_TextureBase), 0));
    vec2 t_Aspect = vec2(-t_TexSize.y / t_TexSize.x, 1.0);
    t_RefractTexCoordOffs *= t_Aspect * u_RefractDepth;
    vec2 t_RefractTexCoord = v_TexCoord1.xy + t_RefractTexCoordOffs.xy;

    vec4 t_Refract1 = texture(SAMPLER_2D(u_TextureBase), saturate(t_RefractTexCoord));

    // "Shadow" since this is used to emulate light.
    vec4 t_Refract2 = texture(SAMPLER_2D(u_TextureBase), saturate(v_TexCoord1.xy + t_BumpmapNormal.xy * 0.1));

    vec3 t_Refract = mix(t_Refract1.rgb, t_Refract2.aaa, 0.025);

    // Add some cheap, fake, glass-y lighting using the bumpmap.
    float t_GlassLighting = pow(t_BumpmapNormal.z, 3.0);

    t_FinalColor.rgb += t_Refract.rgb * t_GlassLighting * t_RefractTint.rgb;
#else
    // "Classic" refract
    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;

    float t_RefractAmount = u_RefractAmount;
#if defined USE_VERTEX_MODULATE
    t_RefractAmount *= v_Modulate.a;
#endif

    vec2 t_RefractTexCoord = t_ProjTexCoord + (t_RefractAmount * t_BumpmapSample.a) * t_BumpmapNormal.xy;

    vec4 t_BlurAccum = vec4(0);
    int g_BlurAmount = BLUR_AMOUNT;
    int g_BlurWidth = g_BlurAmount * 2 + 1;
    float g_BlurWeight = 1.0 / (float(g_BlurWidth * g_BlurWidth) * u_ToneMapScale);

    vec2 t_FramebufferSize = vec2(textureSize(TEXTURE(u_TextureBase), 0));
    vec2 t_BlurSampleOffset = vec2(1.0) / t_FramebufferSize;
    for (int y = -g_BlurAmount; y <= g_BlurAmount; y++) {
        for (int x = -g_BlurAmount; x <= g_BlurAmount; x++) {
            vec2 t_TexCoord = t_RefractTexCoord + vec2(t_BlurSampleOffset.x * float(x), t_BlurSampleOffset.y * float(y));

#if defined GFX_VIEWPORT_ORIGIN_TL
            t_TexCoord.y = 1.0 - t_TexCoord.y;
#endif

            t_BlurAccum += g_BlurWeight * texture(SAMPLER_2D(u_TextureBase), t_TexCoord);
        }
    }

    t_FinalColor.rgb += t_BlurAccum.rgb * t_RefractTint.rgb;
#endif

#if defined USE_ENVMAP
    vec3 t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec3 t_SpecularFactor = vec3(u_EnvmapTint);
    t_SpecularFactor.rgb *= t_BumpmapSample.a;

    vec3 t_SpecularLighting = vec3(0.0);
    t_SpecularLighting += texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgb * g_EnvmapScale;
    t_SpecularLighting *= t_SpecularFactor;

    t_SpecularLighting = mix(t_SpecularLighting, t_SpecularLighting*t_SpecularLighting, u_EnvmapContrastSaturationFresnel.x);
    t_SpecularLighting = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_SpecularLighting)), t_SpecularLighting, u_EnvmapContrastSaturationFresnel.y);

    t_FinalColor.rgb += t_SpecularLighting;
#endif

    t_FinalColor.a = t_BumpmapSample.a;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Refract extends BaseMaterial {
    private wantsEnvmap: boolean = false;
    private wantsLocalRefract: boolean = false;
    private wantsVertexModulate: boolean = false;

    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$envmap']                       = new ParameterTexture(true, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$refracttint']                  = new ParameterColor(1, 1, 1);
        p['$refractamount']                = new ParameterNumber(2);
        p['$refracttinttexture']           = new ParameterTexture(true, false);
        p['$refracttinttextureframe']      = new ParameterNumber(0);
        p['$envmaptint']                   = new ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new ParameterNumber(0);
        p['$envmapsaturation']             = new ParameterNumber(1);
        p['$fresnelreflection']            = new ParameterNumber(1);
        p['$bluramount']                   = new ParameterNumber(1, false);
        p['$localrefract']                 = new ParameterBoolean(false, false);
        p['$localrefractdepth']            = new ParameterNumber(0.05);
        p['$vertexcolormodulate']          = new ParameterBoolean(false, false);

        this.paramGetTexture('$basetexture').ref = '_rt_RefractTexture';
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Refract);

        if (this.paramGetVTF('$envmap') !== null) {
            this.shaderInstance.setDefineBool('USE_ENVMAP', true);
            this.wantsEnvmap = true;
        }

        if (this.paramGetVTF('$refracttinttexture') !== null) {
            this.shaderInstance.setDefineBool('USE_REFRACT_TINT_TEXTURE', true);
        }

        if (this.paramGetBoolean('$localrefract')) {
            this.shaderInstance.setDefineBool('USE_LOCAL_REFRACT', true);
            this.wantsLocalRefract = true;
        }

        const blurAmount = this.paramGetNumber('$bluramount') | 0;
        this.shaderInstance.setDefineString('BLUR_AMOUNT', '' + blurAmount);

        if (this.hasVertexColorInput && (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha'))) {
            this.shaderInstance.setDefineBool('USE_VERTEX_COLOR', true);

            if (this.paramGetBoolean('$vertexcolormodulate')) {
                this.shaderInstance.setDefineBool('USE_VERTEX_MODULATE', true);
                this.wantsVertexModulate = true;
            }
        }

        const isTranslucent = this.textureIsTranslucent('$basetexture');
        this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);
        this.isIndirect = this.textureIsIndirect('$basetexture');

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$normalmap').fillTextureMapping(dst[1], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$refracttinttexture').fillTextureMapping(dst[2], this.paramGetInt('$refracttinttextureframe'));
        this.paramGetTexture('$envmap').fillTextureMapping(dst[11], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Refract.ub_ObjectParams, 24);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Refract.ub_ObjectParams);

        offs += this.paramFillScaleBias(d, offs, '$bumptransform');
        offs += this.paramFillGammaColor(d, offs, '$refracttint', this.paramGetNumber('$refractamount'));
        offs += fillVec4(d, offs, this.paramGetNumber('$localrefractdepth'));

        if (this.wantsEnvmap) {
            offs += this.paramFillGammaColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        if (this.wantsVertexModulate)
            offs += this.paramFillGammaColor(d, offs, `$color`, this.paramGetNumber(`$alpha`));

        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region SolidEnergy
class ShaderTemplate_SolidEnergy extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x2 u_BaseTextureTransform;
#if defined USE_DETAIL
    Mat4x2 u_Detail1TextureTransform;
    Mat4x2 u_Detail2TextureTransform;
#endif
#if defined USE_FLOWMAP
    vec4 u_Misc[3];
#endif
};

#define u_FlowWorldTexCoordScale           (u_Misc[0].x)
#define u_FlowNormalTexCoordScale          (u_Misc[0].y)
#define u_FlowNoiseTexCoordScale           (u_Misc[0].z)
#define u_FlowOutputIntensity              (u_Misc[0].w)

#define u_FlowColor                        (u_Misc[1].xyz)
#define u_FlowIntensity                    (u_Misc[1].w)

#define u_FlowTimeInInvervals              (u_Misc[2].x)
#define u_FlowNormalTexCoordScrollDistance (u_Misc[2].y)
#define u_FlowLerpExp                      (u_Misc[2].z)

varying vec4 v_TexCoord0;
varying vec4 v_TexCoord1;
varying vec4 v_PositionWorld;

layout(binding = 0) uniform sampler2D u_TextureBase;
layout(binding = 1) uniform sampler2D u_TextureDetail1;
layout(binding = 2) uniform sampler2D u_TextureDetail2;
layout(binding = 3) uniform sampler2D u_TextureFlowmap;
layout(binding = 4) uniform sampler2D u_TextureFlowNoise;
layout(binding = 5) uniform sampler2D u_TextureFlowBounds;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));
    v_PositionWorld.w = -gl_Position.z;
#if !defined GFX_CLIPSPACE_NEAR_ZERO
    v_PositionWorld.w = v_PositionWorld.w * 0.5 + 0.5;
#endif

    vec3 t_NormalWorld = normalize(Mul(t_WorldFromLocalMatrix, vec4(a_Normal.xyz, 0.0)));

    vec3 t_TangentSWorld = normalize(Mul(t_WorldFromLocalMatrix, vec4(a_TangentS.xyz, 0.0)));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TexCoord0.xy = Mul(u_BaseTextureTransform, vec4(a_TexCoord01.xy, 1.0, 1.0));
    v_TexCoord0.zw = vec2(0.0);

    v_TexCoord1.xyzw = vec4(0.0);

#if defined USE_DETAIL
    v_TexCoord1.xy = Mul(u_Detail1TextureTransform, vec4(a_TexCoord01.xy, 1.0, 1.0));
    v_TexCoord1.zw = Mul(u_Detail2TextureTransform, vec4(a_TexCoord01.xy, 1.0, 1.0));
#endif

#if defined USE_FLOWMAP
    vec2 t_FlowUV = vec2(0.0);

#if defined MODEL
    t_FlowUV.xy = a_TexCoord01.xy;
#else
    t_FlowUV.x = dot(t_TangentSWorld.xyz, v_PositionWorld.xyz);
    t_FlowUV.y = dot(t_TangentTWorld.xyz, v_PositionWorld.xyz);
#endif

    v_TexCoord0.zw = t_FlowUV.xy;
#endif
}
#endif

${SampleFlowMap}

float CalcCameraFade(in float t_PosProjZ) {
    return smoothstep(0.0, 1.0, saturate(t_PosProjZ * 0.025));
}

#if defined FRAG
void mainPS() {
    vec4 t_BaseTexture = vec4(0.0, 0.0, 0.0, 1.0);
    bool t_UseBaseAlpha = true;

#if defined USE_FLOWMAP
    vec4 t_FlowBoundsSample = texture(SAMPLER_2D(u_TextureFlowBounds), v_TexCoord0.xy);
    vec4 t_FlowSample = texture(SAMPLER_2D(u_TextureFlowmap), v_TexCoord0.zw * u_FlowWorldTexCoordScale);
    vec2 t_FlowVectorTangent = UnpackUnsignedNormalMap(t_FlowSample).rg;
    t_FlowVectorTangent.xy *= t_FlowBoundsSample.r;

    // No vortex.

    vec2 t_FlowNoiseTexCoord = v_TexCoord0.zw * u_FlowNoiseTexCoordScale;
    vec4 t_FlowNoiseSample = texture(SAMPLER_2D(u_TextureFlowNoise), t_FlowNoiseTexCoord.xy);
    vec2 t_FlowTexCoordBase = v_TexCoord0.zw * u_FlowNormalTexCoordScale;
    float t_FlowTimeInIntervals = u_FlowTimeInInvervals + t_FlowNoiseSample.g;
    vec4 t_FlowColorSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureBase), t_FlowTexCoordBase, t_FlowTimeInIntervals, u_FlowNormalTexCoordScrollDistance, t_FlowVectorTangent.xy, u_FlowLerpExp);

    float t_Alpha = t_FlowColorSample.a;

    // TODO(jstpierre): Power-up?
    t_Alpha += t_FlowBoundsSample.g;

    t_BaseTexture.rgb = u_FlowColor.rgb * t_Alpha;
    t_BaseTexture.rgb *= t_FlowBoundsSample.b * u_FlowIntensity;

    t_UseBaseAlpha = false;
#else
    t_BaseTexture.rgba = texture(SAMPLER_2D(u_TextureBase), v_TexCoord0.xy).rgba;
#endif

    vec4 t_FinalColor = t_BaseTexture;
    t_FinalColor.a = 1.0;

#if defined USE_DETAIL1
    vec4 t_Detail1 = texture(SAMPLER_2D(u_TextureDetail1), v_TexCoord1.xy);
    int t_Detail1BlendMode = DETAIL1_BLENDMODE;

    if (t_Detail1BlendMode == 0) {
        t_FinalColor.rgb *= t_Detail1.rgb * 2.0;
    } else {
        t_FinalColor.rgb = mix(t_FinalColor.rgb * t_Detail1.rgb, t_FinalColor.rgb, t_BaseTexture.a);
    }

    if (t_Detail1BlendMode == 1)
        t_UseBaseAlpha = false;
#endif

#if defined USE_DETAIL2
    vec4 t_Detail2 = texture(SAMPLER_2D(u_TextureDetail2), v_TexCoord1.zw);
    int t_Detail2BlendMode = DETAIL2_BLENDMODE;

    if (t_Detail2BlendMode == 0) {
#if defined USE_DETAIL1
        t_Detail2.rgb *= t_Detail1.rgb;
#endif
        t_FinalColor.rgb += t_Detail2.rgb;
    } else {
        t_FinalColor.rgb *= t_Detail2.rgb;
    }
#endif

    if (t_UseBaseAlpha)
        t_FinalColor.a *= t_BaseTexture.a;

#if defined ADDITIVE
    t_FinalColor.rgb *= (1.0 + t_FinalColor.a);
    t_FinalColor.a = 1.0;
#endif

    t_FinalColor.a *= CalcCameraFade(v_PositionWorld.w);

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_SolidEnergy extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    private wantsDetail = false;
    private wantsFlowmap = false;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$detail1']                     = new ParameterTexture(true);
        p['$detail1scale']                = new ParameterNumber(1.0);
        p['$detail1frame']                = new ParameterNumber(0);
        p['$detail1blendmode']            = new ParameterNumber(0, false);
        p['$detail1texturetransform']     = new ParameterMatrix();

        p['$detail2']                     = new ParameterTexture(true);
        p['$detail2scale']                = new ParameterNumber(1.0);
        p['$detail2frame']                = new ParameterNumber(0);
        p['$detail2blendmode']            = new ParameterNumber(0, false);
        p['$detail2texturetransform']     = new ParameterMatrix();

        p['$flowmap']                     = new ParameterTexture(false);
        p['$flowmapframe']                = new ParameterNumber(0);
        p['$flowmapscrollrate']           = new ParameterVector(2);
        p['$flowbounds']                  = new ParameterTexture(false);
        p['$flow_noise_texture']          = new ParameterTexture(false);
        p['$flow_noise_scale']            = new ParameterNumber(1.0);
        p['$flow_lerpexp']                = new ParameterNumber(1.0);
        p['$flow_timeintervalinseconds']  = new ParameterNumber(0.4);
        p['$flow_worlduvscale']           = new ParameterNumber(1.0);
        p['$flow_normaluvscale']          = new ParameterNumber(1.0);
        p['$flow_uvscrolldistance']       = new ParameterNumber(0.2);
        p['$flow_color']                  = new ParameterColor(0);
        p['$flow_color_intensity']        = new ParameterNumber(1.0);

        p['$outputintensity']             = new ParameterNumber(1.0);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.SolidEnergy);

        const isTranslucent = this.paramGetBoolean('$translucent');
        this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        if (this.paramGetVTF('$detail1') !== null) {
            this.shaderInstance.setDefineBool('USE_DETAIL', true);
            this.shaderInstance.setDefineBool('USE_DETAIL1', true);
            this.shaderInstance.setDefineString('DETAIL1_BLENDMODE', '' + this.paramGetNumber('$detail1blendmode'));
            this.wantsDetail = true;
        }

        if (this.paramGetVTF('$detail2') !== null) {
            this.shaderInstance.setDefineBool('USE_DETAIL', true);
            this.shaderInstance.setDefineBool('USE_DETAIL2', true);
            this.shaderInstance.setDefineString('DETAIL2_BLENDMODE', '' + this.paramGetNumber('$detail2blendmode'));
            this.wantsDetail = true;
        }

        if (this.paramGetVTF('$flowmap') !== null) {
            this.shaderInstance.setDefineBool('USE_FLOWMAP', true);
            this.wantsFlowmap = true;
        }

        this.shaderInstance.setDefineBool('ADDITIVE', this.isAdditive);
        this.shaderInstance.setDefineBool('MODEL', this.paramGetBoolean('$model'));

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));

        if (this.wantsDetail) {
            this.paramGetTexture('$detail1').fillTextureMapping(dst[1], this.paramGetInt('$detail1frame'));
            this.paramGetTexture('$detail2').fillTextureMapping(dst[2], this.paramGetInt('$detail2frame'));
        }

        if (this.wantsFlowmap) {
            this.paramGetTexture('$flowmap').fillTextureMapping(dst[3], this.paramGetInt('$flowmapframe'));
            this.paramGetTexture('$flow_noise_texture').fillTextureMapping(dst[4], 0);
            this.paramGetTexture('$flowbounds').fillTextureMapping(dst[5], 0);
        }
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_SolidEnergy.ub_ObjectParams, 24);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_SolidEnergy.ub_ObjectParams);
        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));

        if (this.wantsDetail) {
            offs += this.paramFillTextureMatrix(d, offs, '$detail1texturetransform', false, this.paramGetNumber('$detail1scale'));
            offs += this.paramFillTextureMatrix(d, offs, '$detail2texturetransform', false, this.paramGetNumber('$detail2scale'));
        }

        if (this.wantsFlowmap) {
            offs += fillVec4(d, offs,
                this.paramGetNumber('$flow_worlduvscale'),
                this.paramGetNumber('$flow_normaluvscale'),
                this.paramGetNumber('$flow_noise_scale'),
                this.paramGetNumber('$outputintensity'));

            offs += this.paramFillColor(d, offs, '$flow_color', this.paramGetNumber('$flow_color_intensity'));

            // Compute local time.
            const timeInIntervals = (renderContext.globalTime) / (this.paramGetNumber('$flow_timeintervalinseconds') * 2.0);
            offs += fillVec4(d, offs,
                timeInIntervals,
                this.paramGetNumber('$flow_uvscrolldistance'),
                this.paramGetNumber('$flow_lerpexp'));
        }

        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Sky
class ShaderTemplate_Sky extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x2 u_BaseTextureTransform;
    vec4 u_ColorScale;
};

varying vec2 v_TexCoord0;

layout(binding = 0) uniform sampler2D u_Texture;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));
    v_TexCoord0.xy = Mul(u_BaseTextureTransform, vec4(a_TexCoord01.xy, 0.0, 1.0));
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_FinalColor = texture(SAMPLER_2D(u_Texture), v_TexCoord0.xy);

    OutputLinearColor(vec4(t_FinalColor.rgb * u_ColorScale.rgb, 1.0));
}
#endif
`;
}

class ShaderTemplate_SkyHDRCompressed extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x2 u_BaseTextureTransform;
    vec4 u_TextureSizeInfo;
    vec4 u_ColorScale;
};

#define u_TexelXIncr               (u_TextureSizeInfo.x)
#define u_TexelYIncr               (u_TextureSizeInfo.y)
#define u_UToPixelCoordScale       (u_TextureSizeInfo.z)
#define u_VToPixelCoordScale       (u_TextureSizeInfo.w)

varying vec4 v_TexCoord0;
varying vec4 v_TexCoord1;
varying vec2 v_TexCoordInPixels;

layout(binding = 0) uniform sampler2D u_TextureHdrCompressed;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    vec2 t_TexCoord = Mul(u_BaseTextureTransform, vec4(a_TexCoord01.xy, 0.0, 1.0));

    v_TexCoord0.xy = t_TexCoord + vec2(-u_TexelXIncr, -u_TexelYIncr);
    v_TexCoord0.zw = t_TexCoord + vec2( u_TexelXIncr, -u_TexelYIncr);

    v_TexCoord1.xy = t_TexCoord + vec2(-u_TexelXIncr,  u_TexelYIncr);
    v_TexCoord1.zw = t_TexCoord + vec2( u_TexelXIncr,  u_TexelYIncr);

    v_TexCoordInPixels = v_TexCoord0.xy * vec2(u_UToPixelCoordScale, u_VToPixelCoordScale);
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_S00 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord0.xy);
    vec4 t_S01 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord0.zw);
    vec4 t_S10 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord1.xy);
    vec4 t_S11 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord1.zw);

    vec2 t_FracCoord = fract(v_TexCoordInPixels);

    t_S00.rgb *= t_S00.a;
    t_S10.rgb *= t_S10.a;
    t_S00.rgb = mix(t_S00.rgb, t_S10.rgb, t_FracCoord.x);

    t_S01.rgb *= t_S01.a;
    t_S11.rgb *= t_S11.a;
    t_S01.rgb = mix(t_S01.rgb, t_S11.rgb, t_FracCoord.x);

    vec3 t_FinalColor = mix(t_S00.rgb, t_S01.rgb, t_FracCoord.y);

    OutputLinearColor(vec4(t_FinalColor * u_ColorScale.rgb, 1.0));
}
#endif
`;
}

const enum Material_Sky_Type {
    SkyHDRCompressed, Sky,
}

class Material_Sky extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureSizeInfo: vec4 | null = null;
    private type: Material_Sky_Type;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$hdrcompressedtexture'] = new ParameterTexture(false);
        p['$hdrbasetexture']       = new ParameterTexture(true);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        if (this.paramGetVTF('$hdrcompressedtexture') !== null) {
            this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.SkyHDRCompressed);

            const texture = assertExists(this.paramGetVTF('$hdrcompressedtexture'));
            const w = texture.width, h = texture.height;
            const fudge = 0.01 / Math.max(w, h);
            this.textureSizeInfo = vec4.fromValues(0.5 / w - fudge, 0.5 / h - fudge, w, h);

            this.type = Material_Sky_Type.SkyHDRCompressed;
        } else {
            this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Sky);

            this.type = Material_Sky_Type.Sky;
        }

        this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.None);
        this.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        resetTextureMappings(dst);

        if (this.type === Material_Sky_Type.SkyHDRCompressed) {
            this.paramGetTexture('$hdrcompressedtexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        } else if (this.type === Material_Sky_Type.Sky) {
            let texture = this.paramGetTexture('$hdrbasetexture');
            if (texture === null)
                texture = assertExists(this.paramGetTexture('$basetexture'));
            texture.fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        }
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        if (this.type === Material_Sky_Type.SkyHDRCompressed) {
            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_SkyHDRCompressed.ub_ObjectParams, 16);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_SkyHDRCompressed.ub_ObjectParams);
            offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform');
            offs += fillVec4v(d, offs, this.textureSizeInfo!);

            this.paramGetVector('$color').fillColor(scratchColor, 1.0);
            scratchColor.r *= 8.0;
            scratchColor.g *= 8.0;
            scratchColor.b *= 8.0;

            offs += fillColor(d, offs, scratchColor);
        } else if (this.type === Material_Sky_Type.Sky) {
            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Sky.ub_ObjectParams, 12);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_Sky.ub_ObjectParams);
            offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform');
            this.paramGetVector('$color').fillColor(scratchColor, 1.0);
            offs += fillColor(d, offs, scratchColor);
        }

        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region SpriteCard
class ShaderTemplate_SpriteCard extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override generateProgramString(m: Map<string, string>): string {
        return `
precision mediump float;

${MaterialShaderTemplateBase.Common}

// In the future, we should use vertex data for some of this...
layout(std140) uniform ub_ObjectParams {
    vec4 u_BaseTextureScaleBias[4]; // Two animation frames, dual
    vec4 u_Color;
    vec4 u_Misc[1];
};
#define u_BlendFactor0 (u_Misc[0].x)
#define u_BlendFactor1 (u_Misc[0].y)

varying vec4 v_TexCoord0;
varying vec4 v_TexCoord1;
varying vec4 v_Color;
varying vec4 v_Misc;

layout(binding = 0) uniform sampler2D u_Texture;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));
    v_TexCoord0.xy = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[0]);
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[1]);
    v_TexCoord1.xy = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[2]);
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[3]);
    v_Color = u_Color;
    v_Misc.x = u_BlendFactor0;
    v_Misc.y = u_BlendFactor1;
}
#endif

#if defined FRAG
float Lum(in vec3 t_Sample) {
    return dot(vec3(0.3, 0.59, 0.11), t_Sample.rgb);
}

vec4 MaxLumFrameBlend(in vec4 t_Sample0, in vec4 t_Sample1, in float t_BlendFactor) {
    float t_Lum0 = Lum(t_Sample0.rgb * t_BlendFactor);
    float t_Lum1 = Lum(t_Sample1.rgb * (1.0 - t_BlendFactor));
    return t_Lum0 > t_Lum1 ? t_Sample0 : t_Sample1;
}

void mainPS() {
    vec4 t_Base00 = texture(SAMPLER_2D(u_Texture), v_TexCoord0.xy);
    vec4 t_Base01 = texture(SAMPLER_2D(u_Texture), v_TexCoord0.zw);
    float t_BlendFactor0 = v_Misc.x;

    bool t_BlendFrames = ${getDefineBool(m, `BLEND_FRAMES`)};
    bool t_MaxLumFrameBlend1 = ${getDefineBool(m, `MAX_LUM_FRAMEBLEND_1`)};
    vec4 t_Base0, t_Base;

    if (t_MaxLumFrameBlend1) {
        t_Base0 = MaxLumFrameBlend(t_Base00, t_Base01, t_BlendFactor0);
    } else if (t_BlendFrames) {
        t_Base0 = mix(t_Base00, t_Base01, t_BlendFactor0);
    } else {
        t_Base0 = t_Base00;
    }
    t_Base = t_Base0;

    bool t_DualSequence = ${getDefineBool(m, `DUAL_SEQUENCE`)};
    if (t_DualSequence) {
        vec4 t_Base10 = texture(SAMPLER_2D(u_Texture), v_TexCoord1.xy);
        vec4 t_Base11 = texture(SAMPLER_2D(u_Texture), v_TexCoord1.zw);
        bool t_MaxLumFrameBlend2 = ${getDefineBool(m, `MAX_LUM_FRAMEBLEND_2`)};
        float t_BlendFactor1 = v_Misc.y;

        vec4 t_Base1;
        if (t_MaxLumFrameBlend2) {
            t_Base1 = MaxLumFrameBlend(t_Base10, t_Base11, t_BlendFactor1);
        } else {
            t_Base1 = mix(t_Base10, t_Base11, t_BlendFactor1);
        }

        int t_BlendMode = ${getDefineString(m, `DUAL_BLEND_MODE`)};
        if (t_BlendMode == 0) { // DETAIL_BLEND_MODE_AVERAGE
            t_Base = (t_Base0 + t_Base1) * 0.5;
        } else if (t_BlendMode == 1) { // DETAIL_BLEND_MODE_USE_FIRST_AS_ALPHA_MASK_ON_SECOND
            t_Base.rgb = t_Base1.rgb;
        } else if (t_BlendMode == 2) { // DETAIL_BLEND_MODE_USE_FIRST_OVER_SECOND
            t_Base.rgb = mix(t_Base0.rgb, t_Base1.rgb, t_Base1.a);
        }
    }

    vec4 t_FinalColor = t_Base;
    // TODO(jstpierre): MOD2X, ADDSELF, ADDBASETEXTURE2

    t_FinalColor.rgba *= v_Color.rgba;

    bool t_UseAlphaTest = true;
    if (t_UseAlphaTest) {
        if (t_FinalColor.a < (1.0/255.0))
            discard;
    }

    OutputLinearColor(t_FinalColor.rgba);
}
#endif
`;
    }
}

class Material_SpriteCard extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    public isSpriteCard = true;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$blendframes']           = new ParameterBoolean(true);
        p['$maxlumframeblend1']     = new ParameterBoolean(false);
        p['$maxlumframeblend2']     = new ParameterBoolean(false);
        p['$dualsequence']          = new ParameterBoolean(false);
        p['$sequence_blend_mode']   = new ParameterNumber(0);

        // Stuff hacked in by the particle system.
        p['_b00'] = new ParameterVector(4);
        p['_b01'] = new ParameterVector(4);
        p['_blend0'] = new ParameterNumber(0);
        p['_b10'] = new ParameterVector(4);
        p['_b11'] = new ParameterVector(4);
        p['_blend1'] = new ParameterNumber(0);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.SpriteCard);
        this.shaderInstance.setDefineBool(`BLEND_FRAMES`, this.paramGetBoolean(`$blendframes`));
        this.shaderInstance.setDefineBool(`MAX_LUM_FRAMEBLEND_1`, this.paramGetBoolean(`$maxlumframeblend1`));
        this.shaderInstance.setDefineBool(`MAX_LUM_FRAMEBLEND_2`, this.paramGetBoolean(`$maxlumframeblend2`));
        this.shaderInstance.setDefineBool(`DUAL_SEQUENCE`, this.paramGetBoolean(`$dualsequence`));
        this.shaderInstance.setDefineString(`DUAL_BLEND_MODE`, '' + this.paramGetInt(`$sequence_blend_mode`));

        // TODO(jstpierre): Additive modes
        let isAdditive = this.paramGetBoolean('$additive');
        this.setAlphaBlendMode(this.megaStateFlags, isAdditive ? AlphaBlendMode.Add : AlphaBlendMode.Blend);
        this.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_SolidEnergy.ub_ObjectParams, 24);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_SolidEnergy.ub_ObjectParams);

        offs += this.paramFillVector4(d, offs, '_b00');
        offs += this.paramFillVector4(d, offs, '_b01');
        offs += this.paramFillVector4(d, offs, '_b10');
        offs += this.paramFillVector4(d, offs, '_b11');
        offs += this.paramFillGammaColor(d, offs, '$color', this.paramGetNumber('$alpha'));
        offs += fillVec4(d, offs, this.paramGetNumber('_blend0'), this.paramGetNumber('_blend1'));

        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Material Cache
class StaticQuad {
    private vertexBufferQuad: GfxBuffer;
    private indexBufferQuad: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputStateQuad: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialShaderTemplateBase.a_Position,   bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialShaderTemplateBase.a_TexCoord01, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
            { location: MaterialShaderTemplateBase.a_Color,      bufferIndex: 0, bufferByteOffset: 5*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        const n0 = 1, n1 = -1;
        this.vertexBufferQuad = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array([
            0, n0, n0, 1, 0, 1, 1, 1, 1,
            0, n0, n1, 1, 1, 1, 1, 1, 1,
            0, n1, n0, 0, 0, 1, 1, 1, 1,
            0, n1, n1, 0, 1, 1, 1, 1, 1,
        ]).buffer);
        this.indexBufferQuad = makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array([
            0, 1, 2, 2, 1, 3,
        ]).buffer);

        this.inputStateQuad = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBufferQuad, byteOffset: 0 },
        ], { buffer: this.indexBufferQuad, byteOffset: 0 });
    }

    public setQuadOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputStateQuad);
        renderInst.drawIndexes(6);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputStateQuad);
        device.destroyBuffer(this.vertexBufferQuad);
        device.destroyBuffer(this.indexBufferQuad);
    }
}

class StaticResources {
    public whiteTexture2D: GfxTexture;
    public opaqueBlackTexture2D: GfxTexture;
    public transparentBlackTexture2D: GfxTexture;
    public linearClampSampler: GfxSampler;
    public linearRepeatSampler: GfxSampler;
    public pointClampSampler: GfxSampler;
    public shadowSampler: GfxSampler;
    public staticQuad: StaticQuad;
    public zeroVertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.whiteTexture2D = makeSolidColorTexture2D(device, White);
        this.opaqueBlackTexture2D = makeSolidColorTexture2D(device, OpaqueBlack);
        this.transparentBlackTexture2D = makeSolidColorTexture2D(device, TransparentBlack);
        this.shadowSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            compareMode: GfxCompareMode.Less,
        });
        this.linearClampSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.linearRepeatSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.pointClampSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.zeroVertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new ArrayBuffer(16));
        this.staticQuad = new StaticQuad(device, cache);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.whiteTexture2D);
        device.destroyTexture(this.opaqueBlackTexture2D);
        device.destroyTexture(this.transparentBlackTexture2D);
        device.destroyBuffer(this.zeroVertexBuffer);
        this.staticQuad.destroy(device);
    }
}

class ShaderTemplates {
    public Generic = new ShaderTemplate_Generic();
    public Modulate = new ShaderTemplate_Modulate();
    public UnlitTwoTexture = new ShaderTemplate_UnlitTwoTexture();
    public Water = new ShaderTemplate_Water();
    public Refract = new ShaderTemplate_Refract();
    public SolidEnergy = new ShaderTemplate_SolidEnergy();
    public Sky = new ShaderTemplate_Sky();
    public SkyHDRCompressed = new ShaderTemplate_SkyHDRCompressed();
    public SpriteCard = new ShaderTemplate_SpriteCard();

    public destroy(device: GfxDevice): void {
        this.Generic.destroy(device);
        this.Modulate.destroy(device);
        this.UnlitTwoTexture.destroy(device);
        this.Water.destroy(device);
        this.Refract.destroy(device);
        this.SolidEnergy.destroy(device);
        this.Sky.destroy(device);
        this.SkyHDRCompressed.destroy(device);
        this.SpriteCard.destroy(device);
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();
    private usingHDR: boolean = false;
    public readonly particleSystemCache: ParticleSystemCache;
    public ssbumpNormalize = false;
    public staticResources: StaticResources;
    public materialDefines: string[] = [];
    public deviceNeedsFlipY: boolean;
    public shaderTemplates = new ShaderTemplates();

    constructor(public device: GfxDevice, public cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        // Install render targets
        const _rt_Camera = new VTF(device, cache, null, '_rt_Camera', false, LateBindingTexture.Camera);
        _rt_Camera.width = 256;
        _rt_Camera.height = 256;
        this.textureCache.set('_rt_Camera', _rt_Camera);
        this.textureCache.set('_rt_RefractTexture', new VTF(device, cache, null, '_rt_RefractTexture', false, LateBindingTexture.FramebufferColor));
        this.textureCache.set('_rt_WaterRefraction', new VTF(device, cache, null, '_rt_WaterRefraction', false, LateBindingTexture.FramebufferColor));
        this.textureCache.set('_rt_WaterReflection', new VTF(device, cache, null, '_rt_WaterReflection', false, LateBindingTexture.WaterReflection));
        this.textureCache.set('_rt_Depth', new VTF(device, cache, null, '_rt_Depth', false, LateBindingTexture.FramebufferDepth));
        this.staticResources = new StaticResources(device, cache);

        this.particleSystemCache = new ParticleSystemCache(this.filesystem);

        this.deviceNeedsFlipY = gfxDeviceNeedsFlipY(device);
    }

    public isInitialized(): boolean {
        if (!this.particleSystemCache.isLoaded)
            return false;

        return true;
    }

    public setRenderConfig(hdr: boolean, bspVersion: number): void {
        this.setUsingHDR(hdr);

        // Portal 2 has a fix for ssbump materials being too bright.
        this.ssbumpNormalize = (bspVersion >= 21);
    }

    private setUsingHDR(hdr: boolean): void {
        this.usingHDR = hdr;

        this.materialDefines = [`gpu>=1`, `gpu>=2`, `gpu>=3`, `>=dx90_20b`, `>=dx90`, `>dx90`, `srgb`, `srgb_pc`, `dx9`];
        this.materialDefines.push(this.usingHDR ? `hdr` : `ldr`);
    }

    public isUsingHDR(): boolean {
        return this.usingHDR;
    }

    public async bindLocalCubemap(cubemap: Cubemap) {
        const vtf = await this.fetchVTF(cubemap.filename, true);
        this.textureCache.set('env_cubemap', vtf);
    }

    private resolvePath(path: string): string {
        if (!path.startsWith(`materials/`))
            path = `materials/${path}`;
        return path;
    }

    private async fetchMaterialDataInternal(name: string): Promise<VMT> {
        return parseVMT(this.filesystem, this.resolvePath(name));
    }

    private fetchMaterialData(path: string): Promise<VMT> {
        if (!this.materialPromiseCache.has(path))
            this.materialPromiseCache.set(path, this.fetchMaterialDataInternal(path));
        return this.materialPromiseCache.get(path)!;
    }

    private createMaterialInstanceInternal(vmt: VMT): BaseMaterial {
        // Dispatch based on shader type.
        const shaderType = vmt._Root.toLowerCase();
        if (shaderType === 'water')
            return new Material_Water(vmt);
        else if (shaderType === 'modulate')
            return new Material_Modulate(vmt);
        else if (shaderType === 'unlittwotexture' || shaderType === 'monitorscreen')
            return new Material_UnlitTwoTexture(vmt);
        else if (shaderType === 'refract')
            return new Material_Refract(vmt);
        else if (shaderType === 'solidenergy')
            return new Material_SolidEnergy(vmt);
        else if (shaderType === 'sky')
            return new Material_Sky(vmt);
        else if (shaderType === 'spritecard')
            return new Material_SpriteCard(vmt);
        else
            return new Material_Generic(vmt);
    }

    public async createMaterialInstance(path: string): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        if (vmt['%compiletrigger'])
            materialInstance.isToolMaterial = true;
        return materialInstance;
    }

    public checkVTFExists(name: string): boolean {
        const path = this.filesystem.resolvePath(this.resolvePath(name), '.vtf');
        return this.filesystem.hasEntry(path);
    }

    private async fetchVTFInternal(name: string, srgb: boolean, cacheKey: string): Promise<VTF> {
        const path = this.filesystem.resolvePath(this.resolvePath(name), '.vtf');
        const data = await this.filesystem.fetchFileData(path);
        const vtf = new VTF(this.device, this.cache, data, path, srgb);
        this.textureCache.set(cacheKey, vtf);
        return vtf;
    }

    private getCacheKey(name: string, srgb: boolean): string {
        // Special runtime render target
        if (name.startsWith('_rt_'))
            return name;

        return srgb ? `${name}_srgb` : name;
    }

    public fetchVTF(name: string, srgb: boolean): Promise<VTF> {
        const cacheKey = this.getCacheKey(name, srgb);

        if (this.textureCache.has(cacheKey))
            return Promise.resolve(this.textureCache.get(cacheKey)!);

        if (!this.texturePromiseCache.has(cacheKey))
            this.texturePromiseCache.set(cacheKey, this.fetchVTFInternal(name, srgb, cacheKey));
        return this.texturePromiseCache.get(cacheKey)!;
    }

    public destroy(device: GfxDevice): void {
        this.staticResources.destroy(device);
        this.shaderTemplates.destroy(device);
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
//#endregion

//#region Runtime Lighting / LightCache
function findEnvCubemapTexture(bspfile: BSPFile, pos: ReadonlyVec3): Cubemap | null {
    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < bspfile.cubemaps.length; i++) {
        const distance = vec3.squaredDistance(pos, bspfile.cubemaps[i].pos);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    if (bestIndex < 0)
        return null;

    return bspfile.cubemaps[bestIndex];
}

function worldLightInsideRadius(light: WorldLight, delta: ReadonlyVec3): boolean {
    return light.radius <= 0.0 || vec3.squaredLength(delta) <= light.radius**2;
}

function worldLightDistanceFalloff(light: WorldLight, delta: ReadonlyVec3): number {
    if (light.type === WorldLightType.Surface) {
        const sqdist = vec3.squaredLength(delta);
        if (light.radius > 0.0 && sqdist > light.radius**2)
            return 0.0;
        return 1.0 / Math.max(1.0, vec3.squaredLength(delta));
    } else if (light.type === WorldLightType.Point || light.type === WorldLightType.Spotlight) {
        const sqdist = vec3.squaredLength(delta);
        if (light.radius > 0.0 && sqdist > light.radius**2)
            return 0.0;

        // Compute quadratic attn falloff.
        const dist = Math.sqrt(sqdist);
        const denom = (1.0*light.distAttenuation[0] + dist*light.distAttenuation[1] + sqdist*light.distAttenuation[2]);
        return 1.0 / denom;
    } else if (light.type === WorldLightType.SkyLight) {
        // Sky light requires visibility to the sky. Until we can do a raycast,
        // just place low on the list...
        return 0.1;
    } else if (light.type === WorldLightType.SkyAmbient) {
        // Already in ambient cube; ignore.
        return 0.0;
    } else if (light.type === WorldLightType.QuakeLight) {
        return Math.max(0.0, light.distAttenuation[1] - vec3.length(delta));
    } else {
        throw "whoops";
    }
}

function worldLightAngleFalloff(light: WorldLight, surfaceNormal: ReadonlyVec3, delta: ReadonlyVec3): number {
    if (light.type === WorldLightType.Surface) {
        const dot1 = vec3.dot(surfaceNormal, delta);
        if (dot1 <= 0.0)
            return 0.0;
        const dot2 = -vec3.dot(delta, light.normal);
        if (dot2 <= 0.0)
            return 0.0;
        return dot1 * dot2;
    } else if (light.type === WorldLightType.Point || light.type === WorldLightType.QuakeLight) {
        const dot = vec3.dot(surfaceNormal, delta);
        if (dot <= 0.0)
            return 0.0;
        return dot;
    } else if (light.type === WorldLightType.Spotlight) {
        const visDot = vec3.dot(surfaceNormal, delta);
        if (visDot <= 0.0)
            return 0.0;

        const angleDot = -vec3.dot(delta, light.normal);
        if (angleDot <= light.stopdot2) // Outside outer cone.
            return 0.0;

        if (angleDot >= light.stopdot) // Inside inner cone.
            return visDot;

        const ratio = Math.pow(invlerp(light.stopdot2, light.stopdot, angleDot), light.exponent);
        return visDot * ratio;
    } else if (light.type === WorldLightType.SkyLight) {
        const dot = -vec3.dot(delta, light.normal);
        if (dot <= 0.0)
            return 0.0;
        return dot;
    } else if (light.type === WorldLightType.SkyAmbient) {
        return 1.0;
    } else {
        throw "whoops";
    }
}

const scratchVec3 = vec3.create();
const ntscGrayscale = vec3.fromValues(0.299, 0.587, 0.114);

function fillWorldLight(d: Float32Array, offs: number, light: WorldLight | null, worldLightingState: WorldLightingState): number {
    const base = offs;

    if (light === null) {
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        return offs - base;
    }

    if (light.style >= 0)
        vec3.scale(scratchVec3, light.intensity, worldLightingState.styleIntensities[light.style]);
    else
        vec3.copy(scratchVec3, light.intensity);

    if (light.type === WorldLightType.Surface) {
        // 180 degree spotlight.
        const type = ShaderWorldLightType.Spot;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, scratchVec3);
        offs += fillVec4(d, offs, 0, 0, 1);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.Spotlight) {
        // Controllable spotlight.
        const type = ShaderWorldLightType.Spot;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, scratchVec3, light.exponent);
        offs += fillVec3v(d, offs, light.distAttenuation, light.stopdot);
        offs += fillVec3v(d, offs, light.normal, light.stopdot2);
    } else if (light.type === WorldLightType.Point) {
        const type = ShaderWorldLightType.Point;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, scratchVec3);
        offs += fillVec3v(d, offs, light.distAttenuation);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.SkyLight) {
        // Directional.
        const type = ShaderWorldLightType.Directional;
        offs += fillVec3v(d, offs, Vec3Zero, type);
        offs += fillVec3v(d, offs, scratchVec3);
        offs += fillVec4(d, offs, 0);
        offs += fillVec3v(d, offs, light.normal);
    } else {
        debugger;
    }

    return offs - base;
}

class LightCacheWorldLight {
    public worldLight: WorldLight | null = null;
    public intensity: number = 0;

    public copy(o: LightCacheWorldLight): void {
        this.worldLight = o.worldLight;
        this.intensity = o.intensity;
    }

    public reset(): void {
        this.worldLight = null;
        this.intensity = 0;
    }

    public fill(d: Float32Array, offs: number, worldLightingState: WorldLightingState): number {
        return fillWorldLight(d, offs, this.worldLight, worldLightingState);
    }
}

function newAmbientCube(): AmbientCube {
    return nArray(6, () => colorNewCopy(TransparentBlack));
}

function computeAmbientCubeFromLeaf(dst: AmbientCube, leaf: BSPLeaf, pos: ReadonlyVec3): boolean {
    // XXX(jstpierre): This breaks on d2_coast_01, where there's a prop located outside
    // the leaf it's in due to floating point rounding error.
    // assert(leaf.bbox.containsPoint(pos));

    if (leaf.ambientLightSamples.length === 0) {
        // No ambient light samples.
        return false;
    } else if (leaf.ambientLightSamples.length === 1) {
        // Fast path.
        const sample = leaf.ambientLightSamples[0];
        for (let p = 0; p < 6; p++)
            colorCopy(dst[p], sample.ambientCube[p]);

        return true;
    } else {
        // Slow path.
        for (let p = 0; p < 6; p++)
            colorCopy(dst[p], TransparentBlack);

        let totalWeight = 0.0;

        for (let i = 0; i < leaf.ambientLightSamples.length; i++) {
            const sample = leaf.ambientLightSamples[i];

            // Compute the weight for each sample, using inverse square falloff.
            const dist2 = vec3.squaredDistance(sample.pos, pos);
            const weight = 1.0 / (dist2 + 1.0);
            totalWeight += weight;

            for (let p = 0; p < 6; p++)
                colorScaleAndAdd(dst[p], dst[p], sample.ambientCube[p], weight);
        }

        for (let p = 0; p < 6; p++)
            colorScale(dst[p], dst[p], 1.0 / totalWeight);

        return true;
    }
}

export function worldLightingCalcColorForPoint(dst: Color, bspRenderer: BSPRenderer, pos: ReadonlyVec3): void {
    dst.r = 0;
    dst.g = 0;
    dst.b = 0;

    const bspfile = bspRenderer.bsp;
    for (let i = 0; i < bspfile.worldlights.length; i++) {
        const light = bspfile.worldlights[i];

        vec3.sub(scratchVec3, light.pos, pos);
        const ratio = worldLightDistanceFalloff(light, scratchVec3);
        vec3.normalize(scratchVec3, scratchVec3);
        const angularRatio = worldLightAngleFalloff(light, scratchVec3, scratchVec3);

        dst.r += light.intensity[0] * ratio * angularRatio;
        dst.g += light.intensity[1] * ratio * angularRatio;
        dst.b += light.intensity[2] * ratio * angularRatio;
    }
}

export class ProjectedLight {
    public farZ: number = 1000;
    public frustumView = new SourceEngineView();
    public texture: VTF | null = null;
    public textureFrame: number = 0;
    public lightColor = colorNewCopy(White);
    public brightnessScale: number = 1.0;
    public resolveTextureID: GfxrResolveTextureID;

    constructor() {
        this.frustumView.viewType = SourceEngineViewType.ShadowMap;
    }
}

const ambientCubeDirections = [ Vec3UnitX, Vec3NegX, Vec3UnitY, Vec3NegY, Vec3UnitZ, Vec3NegZ ] as const;
export class LightCache {
    private leaf: number = -1;
    public envCubemap: Cubemap | null;

    private worldLights: LightCacheWorldLight[] = nArray(ShaderTemplate_Generic.MaxDynamicWorldLights, () => new LightCacheWorldLight());
    private ambientCube: AmbientCube = newAmbientCube();

    constructor(bspRenderer: BSPRenderer, private pos: ReadonlyVec3) {
        this.calc(bspRenderer);
    }

    public debugDrawLights(view: SourceEngineView): void {
        for (let i = 0; i < this.worldLights.length; i++) {
            const worldLight = this.worldLights[i].worldLight;
            if (worldLight !== null) {
                const norm = 1 / Math.max(...worldLight.intensity);
                const lightColor = colorNewFromRGBA(worldLight.intensity[0] * norm, worldLight.intensity[1] * norm, worldLight.intensity[2] * norm);
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, worldLight.pos, lightColor, 10);

                const lineColorI = [1.0, 0.8, 0.5, 0.0][i];
                const lineColor = colorNewFromRGBA(lineColorI, lineColorI, lineColorI);
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, this.pos, worldLight.pos, lineColor, 4);
            }
        }
    }

    private cacheAmbientLight(leaf: BSPLeaf): boolean {
        return computeAmbientCubeFromLeaf(this.ambientCube, leaf, this.pos);
    }

    private addWorldLightToAmbientCube(light: WorldLight): void {
        vec3.sub(scratchVec3, light.pos, this.pos);
        const ratio = worldLightDistanceFalloff(light, scratchVec3);
        vec3.normalize(scratchVec3, scratchVec3);
        const angularRatio = worldLightAngleFalloff(light, scratchVec3, scratchVec3);

        for (let i = 0; i < ambientCubeDirections.length; i++) {
            const dst = this.ambientCube[i];
            const mul = vec3.dot(scratchVec3, ambientCubeDirections[i]) * ratio * angularRatio;
            if (mul <= 0)
                continue;
            dst.r += light.intensity[0] * mul;
            dst.g += light.intensity[1] * mul;
            dst.b += light.intensity[2] * mul;
        }
    }

    private cacheWorldLights(worldLights: WorldLight[], hasAmbientLeafLighting: boolean): void {
        for (let i = 0; i < this.worldLights.length; i++)
            this.worldLights[i].reset();

        for (let i = 0; i < worldLights.length; i++) {
            const light = worldLights[i];

            if (hasAmbientLeafLighting && !!(light.flags & WorldLightFlags.InAmbientCube))
                continue;

            vec3.sub(scratchVec3, light.pos, this.pos);
            const ratio = worldLightDistanceFalloff(light, scratchVec3);
            vec3.normalize(scratchVec3, scratchVec3);
            const intensity = ratio * vec3.dot(light.intensity, ntscGrayscale);

            if (intensity <= 0.0)
                continue;

            // Look for a place to insert.
            for (let j = 0; j < this.worldLights.length; j++) {
                if (intensity <= this.worldLights[j].intensity)
                    continue;

                // Found a better light than the one we have right now. Move down the remaining ones to make room.

                // If we're about to eject a light, toss it into the ambient cube first.
                const ejectedLight = this.worldLights[this.worldLights.length - 1].worldLight;
                if (ejectedLight !== null)
                    this.addWorldLightToAmbientCube(ejectedLight);

                for (let k = this.worldLights.length - 1; k > j; k--)
                    if (this.worldLights[k - 1].worldLight !== null)
                        this.worldLights[k].copy(this.worldLights[k - 1]);

                this.worldLights[j].worldLight = light;
                this.worldLights[j].intensity = intensity;
                break;
            }
        }
    }

    private calc(bspRenderer: BSPRenderer): void {
        const bspfile = bspRenderer.bsp;

        // Calculate leaf information.
        this.leaf = bspfile.findLeafIdxForPoint(this.pos);
        assert(this.leaf >= 0);

        this.envCubemap = findEnvCubemapTexture(bspfile, this.pos);

        // Reset ambient cube to leaf lighting.
        const hasAmbientLeafLighting = this.cacheAmbientLight(bspfile.leaflist[this.leaf]);

        // Now go through and cache world lights.
        this.cacheWorldLights(bspfile.worldlights, hasAmbientLeafLighting);
    }

    public fillAmbientCube(d: Float32Array, offs: number): number {
        const base = offs;
        for (let i = 0; i < 6; i++)
            offs += fillColor(d, offs, this.ambientCube[i]);
            // offs += fillVec4(d, offs, 0.5, 0.5, 0.5);
        return offs - base;
    }

    public fillWorldLights(d: Float32Array, offs: number, worldLightingState: WorldLightingState): number {
        const base = offs;
        for (let i = 0; i < this.worldLights.length; i++)
            offs += this.worldLights[i].fill(d, offs, worldLightingState);
        return offs - base;
    }
}
//#endregion

//#region Lightmap / Lighting data
class LightmapPage {
    public gfxTexture: GfxTexture;
    public data: Uint8Array;
    public uploadDirty = false;

    constructor(device: GfxDevice, public page: LightmapPackerPage) {
        const width = this.page.width, height = this.page.height, numSlices = 4;

        // RGBM seems to be good enough for all devices
        const pixelFormat = GfxFormat.U8_RGBA_NORM;
        this.data = new Uint8Array(width * height * numSlices * 4);

        this.gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2DArray,
            usage: GfxTextureUsage.Sampled,
            pixelFormat,
            width: page.width,
            height: page.height,
            depth: numSlices,
            numLevels: 1,
        });

        const fillEmptySpaceWithPink = false;
        if (fillEmptySpaceWithPink) {
            for (let i = 0; i < width * height * numSlices * 4; i += 4) {
                this.data[i+0] = 0xFF;
                this.data[i+1] = 0x00;
                this.data[i+2] = 0xFF;
                this.data[i+3] = 0xFF;
            }
        }
    }

    public prepareToRender(device: GfxDevice): void {
        const data = this.data;

        if (this.uploadDirty) {
            // TODO(jstpierre): Sub-data resource uploads? :/
            device.uploadTextureData(this.gfxTexture, 0, [data]);
            this.uploadDirty = false;
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class LightmapManager {
    private lightmapPages: LightmapPage[] = [];
    public gfxSampler: GfxSampler;
    public scratchpad = new Float32Array(4 * 128 * 128 * 3);
    public pageWidth = 2048;
    public pageHeight = 2048;

    constructor(private device: GfxDevice, cache: GfxRenderCache) {
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    public fillTextureMapping(m: TextureMapping, lightmapPageIndex: number | null): void {
        if (lightmapPageIndex === null)
            return;

        m.gfxTexture = this.getPageTexture(lightmapPageIndex);
        m.gfxSampler = this.gfxSampler;
    }

    public appendPackerPages(manager: LightmapPacker): number {
        const startPage = this.lightmapPages.length;
        for (let i = 0; i < manager.pages.length; i++)
            this.lightmapPages.push(new LightmapPage(this.device, manager.pages[i]));
        return startPage;
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].prepareToRender(device);
    }

    public getPage(pageIndex: number): LightmapPage {
        return this.lightmapPages[pageIndex];
    }

    public getPageTexture(pageIndex: number): GfxTexture {
        return this.lightmapPages[pageIndex].gfxTexture;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].destroy(device);
    }
}

// Convert from RGBM-esque storage to linear light
export function unpackColorRGBExp32(v: number, exp: number): number {
    // exp comes in unsigned, sign extend
    exp = (exp << 24) >> 24;
    const m = Math.pow(2.0, exp) / 0xFF;
    return v * m;
}

function lightmapAccumLight(dst: Float32Array, dstOffs: number, src: Uint8Array, srcOffs: number, size: number, m: number): void {
    if (m <= 0.0)
        return;

    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], exp = src[srcOffs + i + 3];
        dst[dstOffs++] += m * unpackColorRGBExp32(sr, exp);
        dst[dstOffs++] += m * unpackColorRGBExp32(sg, exp);
        dst[dstOffs++] += m * unpackColorRGBExp32(sb, exp);
    }
}

function gammaToLinear(v: number): number {
    const gamma = 2.2;
    return Math.pow(v, gamma);
}

function packRGBM(dst: Uint8Array, dstOffs: number, r: number, g: number, b: number): number {
    const scale = 1.0 / RGBM_SCALE;
    r = saturate(r * scale);
    g = saturate(g * scale);
    b = saturate(b * scale);

    const mul = Math.ceil(saturate(Math.max(r, g, b, 1.0e-6)) * 255.0) / 255.0;
    const m = 1.0 / mul;
    r *= m;
    g *= m;
    b *= m;

    dst[dstOffs++] = r * 0xFF;
    dst[dstOffs++] = g * 0xFF;
    dst[dstOffs++] = b * 0xFF;
    dst[dstOffs++] = mul * 0xFF;
    return 4;
}

function lightmapPackRuntime(dstPage: LightmapPage, location: Readonly<SurfaceLightmapData>, src: Float32Array, srcOffs: number): void {
    const dst = dstPage.data;
    const dstWidth = dstPage.page.width;

    for (let dstY = 0; dstY < location.height; dstY++) {
        for (let dstX = 0; dstX < location.width; dstX++) {
            let sr = src[srcOffs++], sg = src[srcOffs++], sb = src[srcOffs++];
            let dstOffs = ((location.pagePosY + dstY) * dstWidth + location.pagePosX + dstX) * 4;
            dstOffs += packRGBM(dst, dstOffs, sr, sg, sb);
        }
    }
}

function lightmapPackRuntimeWhite(dstPage: LightmapPage, location: Readonly<SurfaceLightmapData>): void {
    const dst = dstPage.data;
    const dstWidth = dstPage.page.width;

    for (let dstY = 0; dstY < location.height; dstY++) {
        for (let dstX = 0; dstX < location.width; dstX++) {
            let dstOffs = ((location.pagePosY + dstY) * dstWidth + location.pagePosX + dstX) * 4;
            dstOffs += packRGBM(dst, dstOffs, 1.0, 1.0, 1.0);
        }
    }
}

function lightmapPackRuntimeBumpmap(dstPage: LightmapPage, location: Readonly<SurfaceLightmapData>, src: Float32Array, srcOffs: number): void {
    const dst = dstPage.data;
    const srcTexelCount = location.width * location.height;
    const srcSize = srcTexelCount * 3;
    const dstWidth = dstPage.page.width, dstHeight = dstPage.page.height;
    const dstSize = dstWidth * dstHeight * 4;

    let srcOffs0 = srcOffs, srcOffs1 = srcOffs + srcSize * 1, srcOffs2 = srcOffs + srcSize * 2, srcOffs3 = srcOffs + srcSize * 3;
    for (let dstY = 0; dstY < location.height; dstY++) {
        for (let dstX = 0; dstX < location.width; dstX++) {
            let dstOffs = ((location.pagePosY + dstY) * dstWidth + location.pagePosX + dstX) * 4;
            let dstOffs0 = dstOffs, dstOffs1 = dstOffs + dstSize * 1, dstOffs2 = dstOffs + dstSize * 2, dstOffs3 = dstOffs + dstSize * 3;

            const s0r = src[srcOffs0++], s0g = src[srcOffs0++], s0b = src[srcOffs0++];

            // Lightmap 0 is easy (unused tho).
            dstOffs0 += packRGBM(dst, dstOffs0, s0r, s0g, s0b);

            // Average the bumped colors to normalize (this math is very wrong, but it's what Valve appears to do)
            let s1r = src[srcOffs1++], s1g = src[srcOffs1++], s1b = src[srcOffs1++];
            let s2r = src[srcOffs2++], s2g = src[srcOffs2++], s2b = src[srcOffs2++];
            let s3r = src[srcOffs3++], s3g = src[srcOffs3++], s3b = src[srcOffs3++];

            let sr = (s1r + s2r + s3r) / 3.0;
            let sg = (s1g + s2g + s3g) / 3.0;
            let sb = (s1b + s2b + s3b) / 3.0;

            if (sr !== 0.0)
                sr = s0r / sr;
            if (sg !== 0.0)
                sg = s0g / sg;
            if (sb !== 0.0)
                sb = s0b / sb;

            dstOffs1 += packRGBM(dst, dstOffs1, s1r * sr, s1g * sg, s1b * sb);
            dstOffs2 += packRGBM(dst, dstOffs2, s2r * sr, s2g * sg, s2b * sb);
            dstOffs3 += packRGBM(dst, dstOffs3, s3r * sr, s3g * sg, s3b * sb);
        }
    }
}

export class WorldLightingState {
    public styleIntensities = new Float32Array(64);
    public stylePatterns: string[] = [
        'm',
        'mmnmmommommnonmmonqnmmo',
        'abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba',
        'mmmmmaaaaammmmmaaaaaabcdefgabcdefg',
        'mamamamamama',
        'jklmnopqrstuvwxyzyxwvutsrqponmlkj',
        'nmonqnmomnmomomno',
        'mmmaaaabcdefgmmmmaaaammmaamm',
        'mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa',
        'aaaaaaaazzzzzzzz',
        'mmamammmmammamamaaamammma',
        'abcdefghijklmnopqrrqponmlkjihgfedcba',
        'mmnnmmnnnmmnn',
    ];
    private smoothAnim = false;
    private doUpdates = true;

    constructor() {
        this.styleIntensities.fill(1.0);
    }

    private styleIntensityFromChar(c: number): number {
        const alpha = c - 0x61;
        assert(alpha >= 0 && alpha <= 25);
        return (alpha * 22) / 264.0;
    }

    private styleIntensityFromPattern(pattern: string, time: number): number {
        const t = time % pattern.length;
        const i0 = t | 0;
        const p0 = this.styleIntensityFromChar(pattern.charCodeAt(i0));

        if (this.smoothAnim) {
            const i1 = (i0 + 1) % pattern.length;
            const t01 = t - i0;

            const p1 = this.styleIntensityFromChar(pattern.charCodeAt(i1));
            return lerp(p0, p1, t01);
        } else {
            return p0;
        }
    }

    public update(timeInSeconds: number): void {
        if (!this.doUpdates)
            return;

       const time = (timeInSeconds * 10);
        for (let i = 0; i < this.styleIntensities.length; i++) {
            const pattern = this.stylePatterns[i];
            if (pattern === undefined)
                continue;

            this.styleIntensities[i] = this.styleIntensityFromPattern(pattern, time);
        }
    }
}

export class SurfaceLightmap {
    // The styles that we built our lightmaps for.
    public lightmapStyleIntensities: number[];

    constructor(public lightmapData: SurfaceLightmapData, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.lightmapStyleIntensities = nArray(this.lightmapData.styles.length, () => -1);
    }

    public checkDirty(renderContext: SourceRenderContext): boolean {
        const worldLightingState = renderContext.worldLightingState;

        if (!this.wantsLightmap)
            return false;

        for (let i = 0; i < this.lightmapData.styles.length; i++) {
            const styleIdx = this.lightmapData.styles[i];
            if (worldLightingState.styleIntensities[styleIdx] !== this.lightmapStyleIntensities[i])
                return true;
        }

        return false;
    }

    public buildLightmap(renderContext: SourceRenderContext, managerPageIndex: number): void {
        const worldLightingState = renderContext.worldLightingState;
        const scratchpad = renderContext.lightmapManager.scratchpad;

        const dstPage = renderContext.lightmapManager.getPage(managerPageIndex);
        const hasLightmap = this.lightmapData.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const texelCount = this.lightmapData.width * this.lightmapData.height;
            const srcNumLightmaps = (this.wantsBumpmap && this.lightmapData.hasBumpmapSamples) ? 4 : 1;
            const srcSize = srcNumLightmaps * texelCount * 4;

            scratchpad.fill(0);
            assert(scratchpad.byteLength >= srcSize);

            let srcOffs = 0;
            for (let i = 0; i < this.lightmapData.styles.length; i++) {
                const styleIdx = this.lightmapData.styles[i];
                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lightmapData.samples!, srcOffs, srcSize, intensity);
                srcOffs += srcSize;
                this.lightmapStyleIntensities[i] = intensity;
            }

            if (this.wantsBumpmap && !this.lightmapData.hasBumpmapSamples) {
                // Game wants bumpmap samples but has none. Copy from primary lightsource.
                const src = new Float32Array(scratchpad.buffer, 0, srcSize * 3);
                for (let i = 1; i < 4; i++) {
                    const dst = new Float32Array(scratchpad.buffer, i * srcSize * 3, srcSize * 3);
                    dst.set(src);
                }
            }

            if (this.wantsBumpmap) {
                lightmapPackRuntimeBumpmap(dstPage, this.lightmapData, scratchpad, 0);
            } else {
                lightmapPackRuntime(dstPage, this.lightmapData, scratchpad, 0);
            }
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
            lightmapPackRuntimeWhite(dstPage, this.lightmapData);
        }

        dstPage.uploadDirty = true;
        renderContext.debugStatistics.lightmapsBuilt++;
    }
}
//#endregion

//#region Material Proxy System
export class ParameterReference {
    public name: string | null = null;
    public index: number = -1;
    public value: Parameter | null = null;

    constructor(str: string, defaultValue: number | null = null, required: boolean = true) {
        if (str === undefined) {
            if (required || defaultValue !== null)
                this.value = new ParameterNumber(assertExists(defaultValue));
        } else if (str.startsWith('$')) {
            // '$envmaptint', '$envmaptint[1]'
            const [, name, index] = assertExists(/([a-zA-Z0-9$_]+)(?:\[(\d+)\])?/.exec(str));
            this.name = name.toLowerCase();
            if (index !== undefined)
                this.index = Number(index);
        } else {
            this.value = createParameterAuto(str);
        }
    }
}

function paramLookupOptional<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T | null {
    if (ref.name !== null) {
        const pm = map[ref.name];
        if (pm === undefined)
            return null;
        else if (ref.index !== -1)
            return pm.index(ref.index) as T;
        else
            return pm as T;
    } else {
        return ref.value as T;
    }
}

type ParameterMap = { [k: string]: Parameter };

function paramLookup<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T {
    return assertExists(paramLookupOptional<T>(map, ref));
}

export function paramGetNum(map: ParameterMap, ref: ParameterReference): number {
    return paramLookup<ParameterNumber>(map, ref).value;
}

export function paramSetNum(map: ParameterMap, ref: ParameterReference, v: number): void {
    const param = paramLookupOptional<ParameterNumber>(map, ref);
    if (param === null) {
        // Perhaps put in a warning, but this seems to happen in live content (TF2's hwn_skeleton_blue.vmt)
        return;
    }
    param.value = v;
}

interface MaterialProxyFactory {
    type: string;
    new (params: VKFParamMap): MaterialProxy;
}

export class MaterialProxySystem {
    public proxyFactories = new Map<string, MaterialProxyFactory>();

    constructor() {
        this.registerDefaultProxyFactories();
    }

    private registerDefaultProxyFactories(): void {
        this.registerProxyFactory(MaterialProxy_Equals);
        this.registerProxyFactory(MaterialProxy_Add);
        this.registerProxyFactory(MaterialProxy_Subtract);
        this.registerProxyFactory(MaterialProxy_Multiply);
        this.registerProxyFactory(MaterialProxy_Clamp);
        this.registerProxyFactory(MaterialProxy_Abs);
        this.registerProxyFactory(MaterialProxy_LessOrEqual);
        this.registerProxyFactory(MaterialProxy_LinearRamp);
        this.registerProxyFactory(MaterialProxy_Sine);
        this.registerProxyFactory(MaterialProxy_TextureScroll);
        this.registerProxyFactory(MaterialProxy_PlayerProximity);
        this.registerProxyFactory(MaterialProxy_GaussianNoise);
        this.registerProxyFactory(MaterialProxy_AnimatedTexture);
        this.registerProxyFactory(MaterialProxy_MaterialModify);
        this.registerProxyFactory(MaterialProxy_MaterialModifyAnimated);
        this.registerProxyFactory(MaterialProxy_WaterLOD);
        this.registerProxyFactory(MaterialProxy_TextureTransform);
        this.registerProxyFactory(MaterialProxy_ToggleTexture);
        this.registerProxyFactory(MaterialProxy_EntityRandom);
        this.registerProxyFactory(MaterialProxy_FizzlerVortex);
    }

    public registerProxyFactory(factory: MaterialProxyFactory): void {
        this.proxyFactories.set(factory.type, factory);
    }

    public createProxyDriver(material: BaseMaterial, proxyDefs: [string, VKFParamMap][]): MaterialProxyDriver {
        const proxies: MaterialProxy[] = [];
        for (let i = 0; i < proxyDefs.length; i++) {
            const [name, params] = proxyDefs[i];
            const proxyFactory = this.proxyFactories.get(name);
            if (proxyFactory !== undefined) {
                const proxy = new proxyFactory(params);
                proxies.push(proxy);
            } else {
                console.log(`unknown proxy type`, name);
            }
        }
        return new MaterialProxyDriver(material, proxies);
    }
}

class MaterialProxyDriver {
    constructor(private material: BaseMaterial, private proxies: MaterialProxy[]) {
    }

    public update(renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        for (let i = 0; i < this.proxies.length; i++)
            this.proxies[i].update(this.material.param, renderContext, entityParams);
    }
}

interface MaterialProxy {
    update(paramsMap: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void;
}

class MaterialProxy_Equals {
    public static type = 'equals';

    private srcvar1: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const srcvar1 = paramLookup(map, this.srcvar1);
        const resultvar = paramLookup(map, this.resultvar);
        resultvar.set(srcvar1);
    }
}

class MaterialProxy_Add {
    public static type = 'add';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, paramGetNum(map, this.srcvar1) + paramGetNum(map, this.srcvar2));
    }
}

class MaterialProxy_Subtract {
    public static type = 'subtract';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, paramGetNum(map, this.srcvar1) - paramGetNum(map, this.srcvar2));
    }
}

class MaterialProxy_Multiply {
    public static type = 'multiply';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, paramGetNum(map, this.srcvar1) * paramGetNum(map, this.srcvar2));
    }
}

class MaterialProxy_Clamp {
    public static type = 'clamp';

    private srcvar1: ParameterReference;
    private min: ParameterReference;
    private max: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.min = new ParameterReference(params.min, 0.0);
        this.max = new ParameterReference(params.max, 1.0);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, clamp(paramGetNum(map, this.srcvar1), paramGetNum(map, this.min), paramGetNum(map, this.max)));
    }
}

class MaterialProxy_Abs {
    public static type = 'abs';

    private srcvar1: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        paramSetNum(map, this.resultvar, Math.abs(paramGetNum(map, this.srcvar1)));
    }
}

class MaterialProxy_LessOrEqual {
    public static type = 'lessorequal';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private lessequalvar: ParameterReference;
    private greatervar: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.lessequalvar = new ParameterReference(params.lessequalvar);
        this.greatervar = new ParameterReference(params.greatervar);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const src1 = paramGetNum(map, this.srcvar1);
        const src2 = paramGetNum(map, this.srcvar2);
        const p = (src1 <= src2) ? this.lessequalvar : this.greatervar;
        paramLookup(map, this.resultvar).set(paramLookup(map, p));
    }
}

class MaterialProxy_LinearRamp {
    public static type = 'linearramp';

    private rate: ParameterReference;
    private initialvalue: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.rate = new ParameterReference(params.rate);
        this.initialvalue = new ParameterReference(params.initialvalue, 0.0);
        this.resultvar = new ParameterReference(params.resultvar, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const rate = paramGetNum(map, this.rate);
        const initialvalue = paramGetNum(map, this.initialvalue);
        const v = initialvalue + (rate * renderContext.globalTime);
        paramSetNum(map, this.resultvar, v);
    }
}

class MaterialProxy_Sine {
    public static type = 'sine';

    private sineperiod: ParameterReference;
    private sinemin: ParameterReference;
    private sinemax: ParameterReference;
    private timeoffset: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.sineperiod = new ParameterReference(params.sineperiod, 1.0);
        this.sinemin = new ParameterReference(params.sinemin, 0.0);
        this.sinemax = new ParameterReference(params.sinemax, 1.0);
        this.timeoffset = new ParameterReference(params.sinemax, 0.0);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const freq = 1.0 / paramGetNum(map, this.sineperiod);
        const t = (renderContext.globalTime - paramGetNum(map, this.timeoffset));
        const min = paramGetNum(map, this.sinemin);
        const max = paramGetNum(map, this.sinemax);
        const v = lerp(min, max, invlerp(-1.0, 1.0, Math.sin(MathConstants.TAU * freq * t)));
        paramSetNum(map, this.resultvar, v);
    }
}

function gaussianRandom(mean: number, halfwidth: number): number {
    // https://en.wikipedia.org/wiki/Marsaglia_polar_method

    // pick two points inside a circle
    let x = 0, y = 0, s = 100;
    while (s > 1) {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        s = Math.hypot(x, y);
    }

    const f = Math.sqrt(-2 * Math.log(s));

    // return one of the two sampled values
    return mean * halfwidth * x * f;
}

class MaterialProxy_GaussianNoise {
    public static type = 'gaussiannoise';

    private resultvar: ParameterReference;
    private minval: ParameterReference;
    private maxval: ParameterReference;
    private mean: ParameterReference;
    private halfwidth: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.minval = new ParameterReference(params.minval, -Number.MAX_VALUE);
        this.maxval = new ParameterReference(params.maxval, Number.MAX_VALUE);
        this.mean = new ParameterReference(params.mean, 0.0);
        this.halfwidth = new ParameterReference(params.halfwidth, 0.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const r = gaussianRandom(paramGetNum(map, this.mean), paramGetNum(map, this.halfwidth));
        const v = clamp(r, paramGetNum(map, this.minval), paramGetNum(map, this.maxval));
        paramSetNum(map, this.resultvar, v);
    }
}

class MaterialProxy_TextureScroll {
    public static type = 'texturescroll';

    private texturescrollvar: ParameterReference;
    private texturescrollangle: ParameterReference;
    private texturescrollrate: ParameterReference;
    private texturescale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.texturescrollvar = new ParameterReference(params.texturescrollvar);
        this.texturescrollrate = new ParameterReference(params.texturescrollrate, 1.0);
        this.texturescrollangle = new ParameterReference(params.texturescrollangle, 0.0);
        this.texturescale = new ParameterReference(params.texturescale, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const p = paramLookup(map, this.texturescrollvar);

        const scale = paramGetNum(map, this.texturescale);
        const angle = paramGetNum(map, this.texturescrollangle) * MathConstants.DEG_TO_RAD;
        const rate = paramGetNum(map, this.texturescrollrate) * renderContext.globalTime;
        const offsS = (Math.cos(angle) * rate) % 1.0;
        const offsT = (Math.sin(angle) * rate) % 1.0;

        if (p instanceof ParameterMatrix) {
            mat4.identity(p.matrix);
            p.matrix[0] = scale;
            p.matrix[5] = scale;
            p.matrix[12] = offsS;
            p.matrix[13] = offsT;
        } else if (p instanceof ParameterVector) {
            p.index(0)!.value = offsS;
            p.index(1)!.value = offsT;
        } else {
            // not sure
            debugger;
        }
    }
}

class MaterialProxy_PlayerProximity {
    public static type = 'playerproximity';

    private resultvar: ParameterReference;
    private scale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.scale = new ParameterReference(params.scale);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        if (entityParams == null)
            return;

        const scale = paramGetNum(map, this.scale);
        const dist = vec3.distance(renderContext.currentView.cameraPos, entityParams.position);
        paramSetNum(map, this.resultvar, dist * scale);
    }
}

class MaterialProxy_AnimatedTexture {
    public static type = 'animatedtexture';

    private animatedtexturevar: ParameterReference;
    private animatedtextureframenumvar: ParameterReference;
    private animatedtextureframerate: ParameterReference;
    private animationnowrap: ParameterReference;

    constructor(params: VKFParamMap) {
        this.animatedtexturevar = new ParameterReference(params.animatedtexturevar);
        this.animatedtextureframenumvar = new ParameterReference(params.animatedtextureframenumvar);
        this.animatedtextureframerate = new ParameterReference(params.animatedtextureframerate, 15.0);
        this.animationnowrap = new ParameterReference(params.animationnowrap, 0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const ptex = paramLookup<ParameterTexture>(map, this.animatedtexturevar);

        // This can happen if the parameter is not actually a texture, if we haven't implemented something yet.
        if (ptex.texture === undefined)
            return;

        if (ptex.texture === null)
            return;

        const rate = paramGetNum(map, this.animatedtextureframerate);
        const wrap = !paramGetNum(map, this.animationnowrap);

        let animationStartTime = entityParams !== null ? entityParams.animationStartTime : 0;
        let frame = (renderContext.globalTime - animationStartTime) * rate;
        if (wrap) {
            frame = frame % ptex.texture.numFrames;
        } else {
            frame = Math.min(frame, ptex.texture.numFrames);
        }

        paramSetNum(map, this.animatedtextureframenumvar, frame);
    }
}

class MaterialProxy_MaterialModify {
    public static type = 'materialmodify';

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        // Nothing to do
    }
}

class MaterialProxy_MaterialModifyAnimated extends MaterialProxy_AnimatedTexture {
    public static override type = 'materialmodifyanimated';
}

class MaterialProxy_WaterLOD {
    public static type = 'waterlod';

    constructor(params: VKFParamMap) {
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        if (map['$cheapwaterstartdistance'] !== undefined)
            (map['$cheapwaterstartdistance'] as ParameterNumber).value = renderContext.cheapWaterStartDistance;
        if (map['$cheapwaterenddistance'] !== undefined)
            (map['$cheapwaterenddistance'] as ParameterNumber).value = renderContext.cheapWaterEndDistance;
    }
}

class MaterialProxy_TextureTransform {
    public static type = 'texturetransform';

    private centervar: ParameterReference;
    private scalevar: ParameterReference;
    private rotatevar: ParameterReference;
    private translatevar: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.centervar = new ParameterReference(params.centervar, null, false);
        this.scalevar = new ParameterReference(params.scalevar, null, false);
        this.rotatevar = new ParameterReference(params.rotatevar, null, false);
        this.translatevar = new ParameterReference(params.translatevar, null, false);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const center = paramLookupOptional(map, this.centervar);
        const scale = paramLookupOptional(map, this.scalevar);
        const rotate = paramLookupOptional<ParameterNumber>(map, this.rotatevar);
        const translate = paramLookupOptional(map, this.translatevar);

        let cx = 0.5, cy = 0.5;
        if (center instanceof ParameterNumber) {
            cx = cy = center.value;
        } else if (center instanceof ParameterVector) {
            cx = center.index(0)!.value;
            cy = center.index(1)!.value;
        }

        let sx = 1.0, sy = 1.0;
        if (scale instanceof ParameterNumber) {
            sx = sy = scale.value;
        } else if (scale instanceof ParameterVector) {
            sx = scale.index(0)!.value;
            sy = scale.index(1)!.value;
        }

        let r = 0.0;
        if (rotate !== null)
            r = rotate.value;

        let tx = 0.0, ty = 0.0;
        if (translate instanceof ParameterNumber) {
            tx = ty = translate.value;
        } else if (translate instanceof ParameterVector) {
            tx = translate.index(0)!.value;
            ty = translate.index(1)!.value;
        }

        const result = paramLookup<ParameterMatrix>(map, this.resultvar);
        result.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }
}

class MaterialProxy_ToggleTexture {
    public static type = 'toggletexture';

    private toggletexturevar: ParameterReference;
    private toggletextureframenumvar: ParameterReference;
    private toggleshouldwrap: ParameterReference;

    constructor(params: VKFParamMap) {
        this.toggletexturevar = new ParameterReference(params.toggletexturevar);
        this.toggletextureframenumvar = new ParameterReference(params.toggletextureframenumvar);
        this.toggleshouldwrap = new ParameterReference(params.toggleshouldwrap, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const ptex = paramLookup<ParameterTexture>(map, this.toggletexturevar);
        if (ptex.texture === null || entityParams === null)
            return;

        const wrap = !!paramGetNum(map, this.toggleshouldwrap);

        let frame = entityParams.textureFrameIndex;
        if (wrap) {
            frame = frame % ptex.texture.numFrames;
        } else {
            frame = Math.min(frame, ptex.texture.numFrames);
        }

        paramSetNum(map, this.toggletextureframenumvar, frame);
    }
}

class MaterialProxy_EntityRandom {
    public static type = 'entityrandom';

    private scale: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.scale = new ParameterReference(params.scale);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        if (entityParams == null)
            return;

        const scale = paramGetNum(map, this.scale);
        paramSetNum(map, this.resultvar, entityParams.randomNumber * scale);
    }
}

class MaterialProxy_FizzlerVortex {
    public static type = `fizzlervortex`;

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const param = map['$flow_color_intensity'] as ParameterNumber;
        if (param === undefined)
            return;
        param.value = 1.0;
    }
}
//#endregion
