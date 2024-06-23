
import { ReadonlyMat4, vec3, vec2, mat4 } from "gl-matrix";
import { Color, TransparentBlack, White, colorCopy, colorNewCopy, colorNewFromRGBA } from "../../Color.js";
import { dfShow, dfRange } from "../../DebugFloaters.js";
import { AABB } from "../../Geometry.js";
import { scaleMatrix } from "../../MathHelpers.js";
import { TextureMapping } from "../../TextureHolder.js";
import { setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary, glslGenerateFloat } from "../../gfx/helpers/GfxShaderLibrary.js";
import { fillMatrix4x4, fillVec3v, fillVec4, fillMatrix4x2, fillColor, fillMatrix4x3 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxFrontFaceMode, GfxMegaStateDescriptor, GfxSamplerFormatKind, GfxTextureDimension } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderInst, GfxRenderInstList } from "../../gfx/render/GfxRenderInstManager.js";
import { assert, assertExists, nArray, nullify } from "../../util.js";
import { SourceEngineView, SourceRenderContext, SourceEngineViewType } from "../Main.js";
import { UberShaderInstanceBasic, UberShaderTemplateBasic } from "../UberShader.js";
import { VMT } from "../VMT.js";
import { VTF } from "../VTF.js";
import * as P from "./MaterialParameters.js";
import { MaterialCache } from "./MaterialCache.js";
import { LightCache } from "./WorldLight.js";

const BindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 15, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 0
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 1
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 2
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 3
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 4
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 5
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 6
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 7
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 8
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 9
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },             // 10
        { dimension: GfxTextureDimension.Cube, formatKind: GfxSamplerFormatKind.Float, },                 // 11
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Depth, comparison: true }, // 12
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },                  // 13
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },      // 14
    ] },
];

export const RGBM_SCALE = 6.0;

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
    public static a_TexCoord01 = 3;
    public static a_Color = 4;
    public static a_StaticVertexLighting0 = 5;
    public static a_StaticVertexLighting1 = 6;
    public static a_StaticVertexLighting2 = 7;
    public static a_BoneWeights = 8;
    public static a_BoneIDs = 9;

    public static ub_SceneParams = 0;
    public static ub_SkinningParams = 1;

    public static MaxSkinningParamsBoneMatrix = 53;
    public static BindingLayouts = BindingLayouts;

    public override getMaxSamplerBinding(): number {
        return BindingLayouts[0].numSamplers - 1;
    }

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

export function fillScaleBias(d: Float32Array, offs: number, m: ReadonlyMat4): number {
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

export class EntityMaterialParameters {
    public position = vec3.create();
    public animationStartTime = 0;
    public textureFrameIndex = 0;
    public blendColor = colorNewCopy(White);
    public lightCache: LightCache | null = null;
    public randomNumber = Math.random();
}

export const enum AlphaBlendMode {
    None, Blend, Add, Glow,
}

function gammaToLinear(v: number): number {
    const gamma = 2.2;
    return Math.pow(v, gamma);
}

export function fillGammaColor(d: Float32Array, offs: number, c: Color, a: number = c.a): number {
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
    public param: P.ParameterMap = {};
    public entityParams: EntityMaterialParameters | null = null;
    public skinningMode = SkinningMode.None;
    public representativeTexture: VTF | null = null;

    protected loaded = false;
    protected proxyDriver: P.MaterialProxyDriver | null = null;
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
        (this.param[name] as P.ParameterColor).setFromColor(c);
    }

    public paramSetNumber(name: string, v: number): void {
        (this.param[name] as P.ParameterNumber).value = v;
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

        P.setupParametersFromVMT(this.param, this.vmt, materialDefines);

        const shaderTypeName = this.vmt._Root.toLowerCase();
        const fallback = this.findFallbackBlock(shaderTypeName, materialDefines);
        if (fallback !== null)
            P.setupParametersFromVMT(this.param, fallback, materialDefines);
    }

    public paramGetString(name: string): string {
        return (this.param[name] as P.ParameterString).value;
    }

    protected paramGetTexture(name: string): P.ParameterTexture {
        return (this.param[name] as P.ParameterTexture);
    }

    protected paramGetVTF(name: string): VTF | null {
        return this.paramGetTexture(name).texture;
    }

    protected paramGetBoolean(name: string): boolean {
        return (this.param[name] as P.ParameterBoolean).getBool();
    }

    public paramGetNumber(name: string): number {
        return (this.param[name] as P.ParameterNumber).value;
    }

    public paramGetInt(name: string): number {
        return this.paramGetNumber(name) | 0;
    }

    public paramGetVector(name: string): P.ParameterVector {
        return (this.param[name] as P.ParameterVector);
    }

    public paramGetMatrix(name: string): mat4 {
        return (this.param[name] as P.ParameterMatrix).matrix;
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
        const m = (this.param[name] as P.ParameterVector).internal;
        assert(m.length === 4);
        return fillVec4(d, offs, m[0].value, m[1].value, m[2].value, m[3].value);
    }

    protected paramFillScaleBias(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as P.ParameterMatrix).matrix;
        // Make sure there's no rotation. We should definitely handle this eventually, though.
        assert(m[1] === 0.0 && m[2] === 0.0);
        let scaleS = m[0] * this.texCoord0Scale[0];
        let scaleT = m[5] * this.texCoord0Scale[1];
        const transS = m[12];
        const transT = m[13];
        return fillVec4(d, offs, scaleS, scaleT, transS, transT);
    }

    protected paramFillTextureMatrix(d: Float32Array, offs: number, name: string, flipY: boolean = false, extraScale: number = 1.0): number {
        const m = (this.param[name] as P.ParameterMatrix).matrix;
        mat4.copy(MaterialUtil.scratchMat4a, m);
        if (extraScale !== 1.0)
            scaleMatrix(MaterialUtil.scratchMat4a, MaterialUtil.scratchMat4a, extraScale);
        scaleMatrix(MaterialUtil.scratchMat4a, MaterialUtil.scratchMat4a, this.texCoord0Scale[0], this.texCoord0Scale[1]);
        if (flipY) {
            MaterialUtil.scratchMat4a[5] *= -1;
            MaterialUtil.scratchMat4a[13] += 2;
        }
        return fillMatrix4x2(d, offs, MaterialUtil.scratchMat4a);
    }

    protected paramFillGammaColor(d: Float32Array, offs: number, name: string, alpha: number = 1.0): number {
        this.paramGetVector(name).fillColor(MaterialUtil.scratchColor, alpha);
        return fillGammaColor(d, offs, MaterialUtil.scratchColor);
    }

    protected paramFillColor(d: Float32Array, offs: number, name: string, alpha: number = 1.0): number {
        this.paramGetVector(name).fillColor(MaterialUtil.scratchColor, alpha);
        return fillColor(d, offs, MaterialUtil.scratchColor);
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
        p['$selfillum']                    = new P.ParameterBoolean(false, false);
        p['$additive']                     = new P.ParameterBoolean(false, false);
        p['$alphatest']                    = new P.ParameterBoolean(false, false);
        p['$translucent']                  = new P.ParameterBoolean(false, false);
        p['$basealphaenvmapmask']          = new P.ParameterBoolean(false, false);
        p['$normalmapalphaenvmapmask']     = new P.ParameterBoolean(false, false);
        p['$opaquetexture']                = new P.ParameterBoolean(false, false);
        p['$vertexcolor']                  = new P.ParameterBoolean(false, false);
        p['$vertexalpha']                  = new P.ParameterBoolean(false, false);
        p['$nocull']                       = new P.ParameterBoolean(false, false);
        p['$nofog']                        = new P.ParameterBoolean(false, false);
        p['$decal']                        = new P.ParameterBoolean(false, false);
        p['$model']                        = new P.ParameterBoolean(false, false);

        // Base parameters
        p['$basetexture']                  = new P.ParameterTexture(true);
        p['$basetexturetransform']         = new P.ParameterMatrix();
        p['$frame']                        = new P.ParameterNumber(0);
        p['$color']                        = new P.ParameterColor(1, 1, 1);
        p['$color2']                       = new P.ParameterColor(1, 1, 1);
        p['$alpha']                        = new P.ParameterNumber(1);

        // Data passed from entity system.
        p['$rendermode']                   = new P.ParameterNumber(0, false);
    }

    protected async fetchResources(materialCache: MaterialCache) {
        // Load all the texture parameters we have.
        const promises: Promise<void>[] = [];
        for (const k in this.param) {
            const v = this.param[k];
            if (v instanceof P.ParameterTexture)
                promises.push(v.fetch(materialCache, this.entityParams));
        }
        await Promise.all(promises);
        this.loaded = true;
    }

    protected initStaticBeforeResourceFetch(): void {
    }

    private paramGetVTFPossiblyMissing(name: string): VTF | null {
        if (this.param[name] === undefined || !(this.param[name] instanceof P.ParameterTexture))
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

            const alpha = assertExists(this.param['$alpha']) as P.ParameterNumber;
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

            let offs = renderInst.allocateUniformBuffer(MaterialShaderTemplateBase.ub_SkinningParams, 12);
            const d = renderInst.mapUniformBufferF32(MaterialShaderTemplateBase.ub_SkinningParams);

            if (modelMatrix !== null) {
                offs += fillMatrix4x3(d, offs, modelMatrix);
            } else {
                mat4.identity(MaterialUtil.scratchMat4a);
                offs += fillMatrix4x3(d, offs, MaterialUtil.scratchMat4a);
            }
        }
    }

    public setOnRenderInstSkinningParams(renderInst: GfxRenderInst, boneMatrix: ReadonlyMat4[], bonePaletteTable: number[]): void {
        if (this.skinningMode === SkinningMode.Smooth) {
            assert(bonePaletteTable.length <= MaterialShaderTemplateBase.MaxSkinningParamsBoneMatrix);

            let offs = renderInst.allocateUniformBuffer(MaterialShaderTemplateBase.ub_SkinningParams, 12 * MaterialShaderTemplateBase.MaxSkinningParamsBoneMatrix);
            const d = renderInst.mapUniformBufferF32(MaterialShaderTemplateBase.ub_SkinningParams);

            mat4.identity(MaterialUtil.scratchMat4a);
            for (let i = 0; i < MaterialShaderTemplateBase.MaxSkinningParamsBoneMatrix; i++) {
                const boneIndex = bonePaletteTable[i];
                const m = boneIndex !== undefined ? boneMatrix[boneIndex] : MaterialUtil.scratchMat4a;
                offs += fillMatrix4x3(d, offs, m);
            }
        } else if (this.skinningMode === SkinningMode.Rigid) {
            assert(bonePaletteTable.length === 1);

            let offs = renderInst.allocateUniformBuffer(MaterialShaderTemplateBase.ub_SkinningParams, 12);
            const d = renderInst.mapUniformBufferF32(MaterialShaderTemplateBase.ub_SkinningParams);

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

export namespace MaterialUtil {
    export function getDefineString(defines: Map<string, string>, name: string): string | null {
        return nullify(defines.get(name));
    }
    
    export function getDefineBool(defines: Map<string, string>, name: string): boolean {
        const str = getDefineString(defines, name);
        if (str !== null)
            assert(str === '1');
        return str !== null;
    }
    
    export function ifDefineBool(defines: Map<string, string>, name: string, t: string, f: string) {
        return getDefineBool(defines, name) ? t : f;
    }

    export const scratchMat4a = mat4.create();
    export const scratchColor = colorNewCopy(White);
    export const textureMappings = nArray(15, () => new TextureMapping());
    export function resetTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++)
            m[i].reset();
    }
}
