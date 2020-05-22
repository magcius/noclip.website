
import { DeviceProgram } from "../Program";
import { VMT, parseVMT, VKFPair, vmtParseVector } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey } from "../gfx/render/GfxRenderer";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v, fillMatrix4x2, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { VTF, VTFFlags } from "./VTF";
import { SourceRenderContext, SourceFileSystem } from "./Main";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { Surface, SurfaceLighting, LightmapPackerManager, LightmapPackerPage } from "./BSPFile";
import { MathConstants, invlerp, lerp, clamp } from "../MathHelpers";
import { colorNewCopy, White, Color, colorCopy, colorScaleAndAdd, TransparentWhite } from "../Color";

//#region Base Classes
const scratchVec4 = vec4.create();
const scratchColor = colorNewCopy(White);

export class MaterialProgramBase extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TangentS = 2;
    public static a_TexCoord = 3;
    public static a_Color = 4;

    public static ub_SceneParams = 0;

    public Common = `
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
};

// Utilities.
vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

vec3 CalcReflection(in vec3 t_NormalWorld, in vec3 t_PositionToEye) {
    return (2.0 * (dot(t_NormalWorld, t_PositionToEye)) * t_NormalWorld) - (dot(t_NormalWorld, t_NormalWorld) * t_PositionToEye);
}

vec3 CalcNormalWorld(in vec3 t_MapNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return vec3(
        dot(vec3(t_Basis0.x, t_Basis1.x, t_Basis2.x), t_MapNormal),
        dot(vec3(t_Basis0.y, t_Basis1.y, t_Basis2.y), t_MapNormal),
        dot(vec3(t_Basis0.z, t_Basis1.z, t_Basis2.z), t_MapNormal)
    );
}

float CalcFresnelTerm(float t_DotProduct) {
    return pow(1.0 - max(0.0, t_DotProduct), 5.0);
}

vec3 UnpackUnsignedNormalMap(in vec3 t_NormalMapSample) {
    return t_NormalMapSample * 2.0 - 1.0;
}

#ifdef FRAG
void OutputLinearColor(in vec4 t_Color) {
    // Gamma Correction
    gl_FragColor.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));
    gl_FragColor.a = t_Color.a;
}
#endif
`;
}

function scaleBiasSet(dst: vec4, scale: number, x: number = 0.0, y: number = 0.0): void {
    vec4.set(dst, scale, scale, x, y);
}

type ParameterMap = { [k: string]: Parameter };

interface Parameter {
    parse(S: string): void;
    index(i: number): Parameter;
    set(param: Parameter): void;
}

class ParameterTexture {
    public ref: string | null = null;
    public texture: VTF | null = null;

    constructor(public additionalFlags: VTFFlags = 0) {
    }

    public parse(S: string): void { this.ref = S; }
    public index(i: number): Parameter { throw "whoops"; }
    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }

    public async fetch(materialCache: MaterialCache): Promise<void> {
        if (this.ref !== null)
            this.texture = await materialCache.fetchVTF(this.ref, this.additionalFlags);
    }

    public fillTextureMapping(m: TextureMapping, frame: number): void {
        if (this.texture !== null)
            this.texture.fillTextureMapping(m, frame);
    }
}

class ParameterString {
    public value: string = '';
    public parse(S: string): void { this.value = S; }
    public index(i: number): Parameter { throw "whoops"; }
    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }
}

class ParameterNumber {
    constructor(public value: number, private dynamic: boolean = true) { }
    public parse(S: string): void { this.value = Number(S); }
    public index(i: number): Parameter { throw "whoops"; }
    public set(param: Parameter): void {
        assert(param instanceof ParameterNumber);
        assert(this.dynamic);
        this.value = param.value;
    }
}

class ParameterBoolean extends ParameterNumber {
    constructor(value: boolean, dynamic: boolean = true) { super(value ? 1 : 0, dynamic); }
    public getBool(): boolean { return !!this.value; }
}

const scratchMatrix = mat4.create();
class ParameterMatrix {
    public matrix = mat4.create();

    constructor() { }

    public setMatrix(cx: number, cy: number, sx: number, sy: number, r: number, tx: number, ty: number): void {
        mat4.identity(this.matrix);
        this.matrix[12] = -cx;
        this.matrix[13] = -cy;
        this.matrix[0] = sx;
        this.matrix[5] = sy;
        mat4.fromZRotation(scratchMatrix, MathConstants.DEG_TO_RAD * r);
        mat4.mul(this.matrix, scratchMatrix, this.matrix);
        mat4.identity(scratchMatrix);
        scratchMatrix[12] = cx + tx;
        scratchMatrix[13] = cy + ty;
        mat4.mul(this.matrix, scratchMatrix, this.matrix);
    }

    public parse(S: string): void {
        // "center {} {} scale {} {} rotate {} translate {} {}"
        const [, cx, cy, sx, sy, r, tx, ty] = assertExists(/center (.+) (.+) scale (.+) (.+) rotate (.+) translate (.+) (.+)/.exec(S)).map((v) => Number(v));
        this.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }

    public index(i: number): Parameter { throw "whoops"; }
    public set(param: Parameter): void { throw "whoops"; }
}

class ParameterVector {
    protected internal: ParameterNumber[];

    constructor(length: number) {
        this.internal = nArray(length, () => new ParameterNumber(0));
    }

    public parse(S: string): void {
        const numbers = vmtParseVector(S);
        this.internal.length = numbers.length;
        for (let i = 0; i < numbers.length; i++)
            this.internal[i] = new ParameterNumber(numbers[i]);
    }

    public index(i: number): ParameterNumber {
        return this.internal[i];
    }

    public set(param: Parameter): void {
        if (param instanceof ParameterVector) {
            this.internal
            this.internal[0].value = param.internal[0].value;
            this.internal[1].value = param.internal[1].value;
            this.internal[2].value = param.internal[2].value;
        } else {
            throw "whoops";
        }
    }

    public fillColor(d: Float32Array, offs: number, a: number): number {
        assert(this.internal.length === 3);
        return fillVec4(d, offs, this.internal[0].value, this.internal[1].value, this.internal[2].value, a);
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

function createParameterAuto(S: string): Parameter | null {
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

function setupParametersFromVMT(param: ParameterMap, vmt: VMT): void {
    for (const key in vmt) {
        if (!key.startsWith('$'))
            continue;
        const value = vmt[key];
        if (key in param) {
            // Easy case -- existing parameter.
            param[key].parse(value);
        } else {
            // Hard case -- auto-detect type from string.
            const p = createParameterAuto(value);
            if (p !== null) {
                param[key] = p;
            } else {
                console.warn("Could not parse parameter", key, value);
            }
        }
    }
}

export class EntityMaterialParameters {
    public position = vec3.create();
    public animationStartTime = 0;
    public textureFrameIndex = 0;
    public blendColor = colorNewCopy(White);
}

const enum AlphaBlendMode {
    None, Blend, Add, BlendAdd,
}

export abstract class BaseMaterial {
    public visible = true;
    public wantsLightmap = false;
    public wantsBumpmappedLightmap = false;
    public param: ParameterMap = {};
    public entityParams: EntityMaterialParameters | null = null;

    protected loaded = false;
    protected proxyDriver: MaterialProxyDriver | null = null;

    constructor(public vmt: VMT) {
    }

    public async init(renderContext: SourceRenderContext) {
        this.initParameters();

        this.setupParametersFromVMT();
        if (this.vmt.proxies !== undefined)
            this.proxyDriver = renderContext.materialProxySystem.createProxyDriver(this, this.vmt.proxies);

        await this.fetchResources(renderContext.materialCache);
        this.initStatic(renderContext.device, renderContext.cache);
    }

    protected setupParametersFromVMT(): void {
        setupParametersFromVMT(this.param, this.vmt);
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

    protected paramGetInt(name: string): number {
        return this.paramGetNumber(name) | 0;
    }

    protected paramGetVector(name: string): ParameterVector {
        return (this.param[name] as ParameterVector);
    }

    protected paramFillScaleBias(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        // Make sure there's no rotation. We should definitely handle this eventually, though.
        // assert(m[1] === 0.0 && m[2] === 0.0);
        const scaleS = m[0];
        const scaleT = m[5];
        const transS = m[12];
        const transT = m[13];
        return fillVec4(d, offs, scaleS, scaleT, transS, transT);
    }

    protected paramFillTextureMatrix(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        return fillMatrix4x2(d, offs, m);
    }

    protected paramFillColor(d: Float32Array, offs: number, name: string, alphaname: string | null = null): number {
        const alpha = alphaname !== null ? this.paramGetNumber(alphaname) : 1.0;
        return (this.param[name] as ParameterVector).fillColor(d, offs, alpha);
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

    protected setCullMode(megaStateFlags: Partial<GfxMegaStateDescriptor>): void {
        megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.paramGetBoolean('$nocull'))
            megaStateFlags.cullMode = GfxCullMode.NONE;
    }

    protected setAlphaBlendMode(megaStateFlags: Partial<GfxMegaStateDescriptor>, alphaBlendMode: AlphaBlendMode): boolean {
        if (alphaBlendMode === AlphaBlendMode.BlendAdd) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.Blend) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.Add) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ONE,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.None) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ZERO,
            });
            megaStateFlags.depthWrite = true;
            return false;
        } else {
            throw "whoops";
        }
    }

    protected getAlphaBlendModeFromTexture(isTranslucent: boolean): AlphaBlendMode {
        if (isTranslucent && this.paramGetBoolean('$additive'))
            return AlphaBlendMode.BlendAdd;
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

        // Base parameters
        p['$basetexture']                  = new ParameterTexture(VTFFlags.SRGB);
        p['$basetexturetransform']         = new ParameterMatrix();
        p['$frame']                        = new ParameterNumber(0);
        p['$color']                        = new ParameterColor(1, 1, 1);
        p['$alpha']                        = new ParameterNumber(1);
    }

    protected async fetchResources(materialCache: MaterialCache) {
        // Load all the texture parameters we have.
        const promises: Promise<void>[] = [];
        for (const k in this.param) {
            const v = this.param[k];
            if (v instanceof ParameterTexture)
                promises.push(v.fetch(materialCache));
        }
        await Promise.all(promises);
        this.loaded = true;
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
    }

    public isMaterialLoaded(): boolean {
        return this.loaded;
    }

    public setLightmapAllocation(lightmapAllocation: SurfaceLightingInstance): void {
        // Nothing by default.
    }

    public movement(renderContext: SourceRenderContext): void {
        if (this.proxyDriver !== null)
            this.proxyDriver.update(renderContext, this.entityParams);
    }

    public abstract setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: mat4): void;
}
//#endregion

//#region Generic (LightmappedGeneric, UnlitGeneric, VertexLightingGeneric, VertexWorldTransition)
class GenericMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_BaseTextureScaleBias;
#ifdef USE_DETAIL
    vec4 u_DetailScaleBias;
#endif
#ifdef USE_BUMPMAP
    Mat4x2 u_BumpmapTransform;
#endif
#ifdef USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
    vec4 u_ModulationColor;
    vec4 u_Misc[1];
};

#define u_AlphaTestReference (u_Misc[0].x)
#define u_DetailBlendFactor  (u_Misc[0].y)
#define u_LightmapOffset     (u_Misc[0].z)

// Base, Detail
varying vec4 v_TexCoord0;
// Lightmap (0), Envmap Mask
varying vec4 v_TexCoord1;
// Bumpmap
varying vec4 v_TexCoord2;

// w contains BaseTexture2 blend factor.
varying vec4 v_PositionWorld;
varying vec4 v_Color;

#define HAS_FULL_TANGENTSPACE (USE_BUMPMAP)

#ifdef HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;

// Base, Detail, Bumpmap, Lightmap, Envmap Mask, BaseTexture2
uniform sampler2D u_Texture[6];
// Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;
#ifdef USE_VERTEX_COLOR
layout(location = ${MaterialProgramBase.a_Color}) attribute vec4 a_Color;
#endif

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = a_Normal.xyz;

#ifdef USE_VERTEX_COLOR
    v_Color = a_Color;
#else
    v_Color = vec4(1.0);
#endif

#ifdef USE_MODULATIONCOLOR_COLOR
    v_Color.rgb *= u_ModulationColor.rgb;
#endif

#ifdef USE_MODULATIONCOLOR_ALPHA
    v_Color.a *= u_ModulationColor.a;
#endif

#ifdef USE_BASETEXTURE2
    // This is the BaseTexture2 blend factor, smuggled through using unobvious means.
    v_PositionWorld.w = a_Normal.w;
#endif

#ifdef HAS_FULL_TANGENTSPACE
    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = CalcScaleBias(a_TexCoord.xy, u_BaseTextureScaleBias);
#ifdef USE_DETAIL
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord.xy, u_DetailScaleBias);
#endif
#ifdef USE_LIGHTMAP
    v_TexCoord1.xy = a_TexCoord.zw;
#endif
#ifdef USE_ENVMAP_MASK
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord.xy, u_EnvmapMaskScaleBias);
#endif
#ifdef USE_BUMPMAP
    v_TexCoord2.xy = Mul(u_BumpmapTransform, vec4(a_TexCoord.xy, 1.0, 1.0));
#endif
}
#endif

#ifdef FRAG

#define COMBINE_MODE_MUL_DETAIL2        (0)
vec4 TextureCombine(in vec4 t_BaseTexture, in vec4 t_DetailTexture, in int t_CombineMode, in float t_BlendFactor) {
    if (t_CombineMode == COMBINE_MODE_MUL_DETAIL2) {
        return t_BaseTexture * mix(vec4(1.0), t_DetailTexture * 2.0, t_BlendFactor);
    } else {
        // Unknown.
        return t_BaseTexture + vec4(1.0, 0.0, 1.0, 0.0);
    }
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 0.8660254037844386,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

void mainPS() {
    vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture[0], v_TexCoord0.xy));

    vec4 t_Albedo, t_BlendedAlpha;
#ifdef USE_DETAIL
    vec4 t_DetailTexture = texture(SAMPLER_2D(u_Texture[1], v_TexCoord0.zw));
    t_Albedo = TextureCombine(t_BaseTexture, t_DetailTexture, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#else
    t_Albedo = t_BaseTexture;
#endif

#ifdef USE_BASETEXTURE2
    // Blend in BaseTexture2 using blend factor.
    vec4 t_BaseTexture2 = texture(SAMPLER_2D(u_Texture[5]), v_TexCoord0.xy);
    t_Albedo = mix(t_Albedo, t_BaseTexture2, v_PositionWorld.w);
#endif

    t_Albedo *= v_Color;

#ifdef USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;
#ifdef USE_BUMPMAP
    vec4 t_BumpmapSample = texture(SAMPLER_2D(u_Texture[2], v_TexCoord2.xy));

#ifdef USE_SSBUMP
    // In SSBUMP, the bumpmap is pre-convolved with the basis. Compute the normal by re-applying our basis.
    vec3 t_BumpmapNormal = normalize(g_RNBasis0*t_BumpmapSample.x + g_RNBasis1*t_BumpmapSample.y + g_RNBasis2*t_BumpmapSample.z);
#else
    // In non-SSBUMP, this is a traditional normal map with signed offsets.
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample.rgb);
#endif

    // Transform from tangent space into world-space.
    t_NormalWorld = CalcNormalWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
#else
    t_NormalWorld = v_TangentSpaceBasis2;
#endif

    vec3 t_DiffuseLighting;

#ifdef USE_LIGHTMAP

    vec3 t_DiffuseLightingScale = u_ModulationColor.xyz;

#ifdef USE_DIFFUSE_BUMPMAP
    vec3 t_LightmapColor1 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 1.0))).rgb;
    vec3 t_LightmapColor2 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 2.0))).rgb;
    vec3 t_LightmapColor3 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 3.0))).rgb;

    vec3 t_Influence;

#ifdef USE_SSBUMP
    // SSBUMP precomputes the elements of t_Influence (calculated below) offline.
    t_Influence = t_BumpmapSample.rgb;
#else
    t_Influence.x = clamp(dot(t_BumpmapNormal, g_RNBasis0), 0.0, 1.0);
    t_Influence.y = clamp(dot(t_BumpmapNormal, g_RNBasis1), 0.0, 1.0);
    t_Influence.z = clamp(dot(t_BumpmapNormal, g_RNBasis2), 0.0, 1.0);

    // According to https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_EfficientSelfShadowedRadiosityNormalMapping.pdf
    // even without SSBUMP, the engine squares and re-normalizes the results. Not sure why, and why it doesn't match the original
    // Radiosity Normal Mapping text.
    t_Influence *= t_Influence;
    t_DiffuseLightingScale /= dot(t_Influence, vec3(1.0));
#endif

    t_DiffuseLighting = vec3(0.0);
    t_DiffuseLighting += t_LightmapColor1 * t_Influence.x;
    t_DiffuseLighting += t_LightmapColor2 * t_Influence.y;
    t_DiffuseLighting += t_LightmapColor3 * t_Influence.z;
#else
    t_DiffuseLighting = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy)).rgb;
#endif

    t_DiffuseLighting *= t_DiffuseLightingScale;

#else
    t_DiffuseLighting = vec3(1.0);
#endif

    t_FinalColor.rgb += t_DiffuseLighting * t_Albedo.rgb;

#ifdef USE_ENVMAP
    vec3 t_SpecularFactor = vec3(u_EnvmapTint);

#ifdef USE_ENVMAP_MASK
    t_SpecularFactor *= texture(SAMPLER_2D(u_Texture[4], v_TexCoord1.zw)).rgb;
#endif

#ifdef USE_NORMALMAP_ALPHA_ENVMAP_MASK
    t_SpecularFactor *= t_BumpmapSample.a;
#endif
#ifdef USE_BASE_ALPHA_ENVMAP_MASK
    t_SpecularFactor *= 1.0 - t_BaseTexture.a;
#endif

    vec3 t_SpecularLighting = vec3(0.0);
    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);
    t_SpecularLighting += texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= t_SpecularFactor;

    t_SpecularLighting = mix(t_SpecularLighting, t_SpecularLighting*t_SpecularLighting, u_EnvmapContrastSaturationFresnel.x);
    t_SpecularLighting = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_SpecularLighting)), t_SpecularLighting, u_EnvmapContrastSaturationFresnel.y);

    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = CalcFresnelTerm(dot(t_NormalWorld, t_WorldDirectionToEye));
    t_Fresnel = mix(u_EnvmapContrastSaturationFresnel.z, 1.0, t_Fresnel);
    t_SpecularLighting *= t_Fresnel;

    t_FinalColor.rgb += t_SpecularLighting.rgb;
#endif

#ifndef USE_BASE_ALPHA_ENVMAP_MASK
    t_FinalColor.a = t_BaseTexture.a;
#endif

    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Generic extends BaseMaterial {
    private wantsDetail = false;
    private wantsBumpmap = false;
    private wantsEnvmapMask = false;
    private wantsBaseTexture2 = false;
    private wantsEnvmap = false;
    private lightmapAllocation: SurfaceLightingInstance | null = null;

    private program: GenericMaterialProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(7, () => new TextureMapping());

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        // Generic
        p['$envmap']                       = new ParameterTexture(VTFFlags.SRGB);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$envmapmask']                   = new ParameterTexture();
        p['$envmapmaskframe']              = new ParameterNumber(0);
        p['$envmapmasktransform']          = new ParameterMatrix();
        p['$envmaptint']                   = new ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new ParameterNumber(0);
        p['$envmapsaturation']             = new ParameterNumber(1);
        p['$fresnelreflection']            = new ParameterNumber(1);
        p['$detail']                       = new ParameterTexture(VTFFlags.SRGB);
        p['$detailframe']                  = new ParameterNumber(0);
        p['$detailblendmode']              = new ParameterNumber(0, false);
        p['$detailblendfactor']            = new ParameterNumber(1);
        p['$detailtint']                   = new ParameterColor(1, 1, 1);
        p['$detailscale']                  = new ParameterNumber(4);
        p['$bumpmap']                      = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        // TODO(jstpierre): This default isn't right
        p['$alphatestreference']           = new ParameterNumber(0.4);
        p['$nodiffusebumplighting']        = new ParameterBoolean(false, false);
        p['$ssbump']                       = new ParameterBoolean(false, false);

        // World Vertex Transition
        p['$basetexture2']                 = new ParameterTexture(VTFFlags.SRGB);
        p['$frame2']                       = new ParameterNumber(0.0);
    }

    protected setupParametersFromVMT(): void {
        super.setupParametersFromVMT();

        if (this.vmt.lightmappedgeneric_dx9 !== undefined)
            setupParametersFromVMT(this.param, this.vmt.lightmappedgeneric_dx9);
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        const shaderType = this.vmt._Root.toLowerCase();

        this.program = new GenericMaterialProgram();

        if (this.paramGetVTF('$detail') !== null) {
            this.wantsDetail = true;
            this.program.setDefineBool('USE_DETAIL', true);
            this.program.defines.set('DETAIL_COMBINE_MODE', '' + this.paramGetNumber('$detailblendmode'));
        }

        if (this.paramGetVTF('$bumpmap') !== null) {
            this.wantsBumpmap = true;
            this.program.setDefineBool('USE_BUMPMAP', true);
            const wantsDiffuseBumpmap = !this.paramGetBoolean('$nodiffusebumplighting');
            this.program.setDefineBool('USE_DIFFUSE_BUMPMAP', wantsDiffuseBumpmap);
            this.wantsBumpmappedLightmap = wantsDiffuseBumpmap;
        }

        // Lightmap = 3

        if (this.paramGetVTF('$envmapmask') !== null) {
            this.wantsEnvmapMask = true;
            this.program.setDefineBool('USE_ENVMAP_MASK', true);
        }

        if (this.paramGetVTF('$envmap') !== null) {
            this.wantsEnvmap = true;
            this.program.setDefineBool('USE_ENVMAP', true);
        }

        // Use modulation by default.
        // TODO(jstpierre): Figure out where modulation is actually used.
        this.program.setDefineBool('USE_MODULATIONCOLOR_COLOR', false);
        this.program.setDefineBool('USE_MODULATIONCOLOR_ALPHA', false);

        if (shaderType === 'lightmappedgeneric' || shaderType === 'worldvertextransition') {
            this.wantsLightmap = true;
            this.program.setDefineBool('USE_LIGHTMAP', true);
        }

        if (shaderType === 'worldvertextransition') {
            this.wantsBaseTexture2 = true;
            this.program.setDefineBool('USE_BASETEXTURE2', true);
        }

        if (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha'))
            this.program.setDefineBool('USE_VERTEX_COLOR', true);

        if (this.paramGetBoolean('$basealphaenvmapmask'))
            this.program.setDefineBool('USE_BASE_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$normalmapalphaenvmapmask'))
            this.program.setDefineBool('USE_NORMALMAP_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$ssbump'))
            this.program.setDefineBool('USE_SSBUMP', true);

        if (this.paramGetBoolean('$alphatest')) {
            this.program.setDefineBool('USE_ALPHATEST', true);
        } else {
            let isTranslucent = false;

            if (this.textureIsTranslucent('$basetexture'))
                isTranslucent = true;

            const translucentLayer = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendModeFromTexture(isTranslucent));
            const sortLayer = translucentLayer ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
            this.sortKeyBase = makeSortKey(sortLayer);
        }

        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    public isMaterialLoaded(): boolean {
        return this.loaded;
    }

    public setLightmapAllocation(lightmapAllocation: SurfaceLightingInstance): void {
        this.lightmapAllocation = lightmapAllocation;
        const lightmapTextureMapping = this.textureMapping[3];
        lightmapTextureMapping.gfxTexture = this.lightmapAllocation.gfxTexture;
        lightmapTextureMapping.gfxSampler = this.lightmapAllocation.gfxSampler;
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$detail').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$detailframe'));
        this.paramGetTexture('$bumpmap').fillTextureMapping(this.textureMapping[2], this.paramGetInt('$bumpframe'));
        // Lightmap is supplied by entity.
        this.paramGetTexture('$envmapmask').fillTextureMapping(this.textureMapping[4], this.paramGetInt('$envmapmaskframe'));
        if (this.wantsBaseTexture2)
            this.paramGetTexture('$basetexture2').fillTextureMapping(this.textureMapping[5], this.paramGetInt('$frame2'));
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[6], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: mat4): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(GenericMaterialProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(GenericMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += this.paramFillScaleBias(d, offs, '$basetexturetransform');

        if (this.wantsDetail) {
            scaleBiasSet(scratchVec4, this.paramGetNumber('$detailscale'));
            offs += fillVec4v(d, offs, scratchVec4);
        }

        if (this.wantsBumpmap)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform');

        if (this.wantsEnvmapMask)
            offs += this.paramFillScaleBias(d, offs, '$envmapmasktransform');

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        // Compute modulation color.
        colorCopy(scratchColor, this.entityParams !== null ? this.entityParams.blendColor : White);
        this.paramGetVector('$color').mulColor(scratchColor);

        const lightMapScale = gammaToLinear(2.0);
        colorScaleAndAdd(scratchColor, scratchColor, TransparentWhite, lightMapScale);
        scratchColor.a *= this.paramGetNumber('$alpha');
        offs += fillColor(d, offs, scratchColor);

        const alphaTestReference = this.paramGetNumber('$alphatestreference');
        const detailBlendFactor = this.paramGetNumber('$detailblendfactor');
        const lightmapOffset = this.lightmapAllocation !== null ? this.lightmapAllocation.bumpPageOffset : 0.0;
        offs += fillVec4(d, offs, alphaTestReference, detailBlendFactor, lightmapOffset);

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public destroy(device: GfxDevice): void {
    }
}

// UnlitTwoTexture
class UnlitTwoTextureProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_Texture2ScaleBias;
    vec4 u_ModulationColor;
};

// Texture1, Texture2
varying vec4 v_TexCoord0;

// Texture1, Texture2
uniform sampler2D u_Texture[2];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    // TODO(jstpierre): BaseTransform
    v_TexCoord0.xy = a_TexCoord.xy;
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord.xy, u_Texture2ScaleBias);
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_Texture1 = texture(SAMPLER_2D(u_Texture[0], v_TexCoord0.xy));
    vec4 t_Texture2 = texture(SAMPLER_2D(u_Texture[1], v_TexCoord0.zw));
    vec4 t_FinalColor = t_Texture1 * t_Texture2 * u_ModulationColor;
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_UnlitTwoTexture extends BaseMaterial {
    private program: UnlitTwoTextureProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$texture2']                     = new ParameterTexture(VTFFlags.SRGB);
        p['$texture2transform']            = new ParameterMatrix();
        p['$frame2']                       = new ParameterNumber(0.0);

        // TODO(jstpierre): MonitorScreen tint/constrast/saturation.
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        this.program = new UnlitTwoTextureProgram();

        const isTranslucent = this.textureIsTranslucent('$basetexture') || this.textureIsTranslucent('$texture2');
        const translucentLayer = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendModeFromTexture(isTranslucent));
        const sortLayer = translucentLayer ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$texture2').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$frame2'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: mat4): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(GenericMaterialProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(GenericMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix);
        offs += this.paramFillScaleBias(d, offs, '$texture2transform');
        offs += this.paramFillColor(d, offs, '$color', '$alpha');

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}

// Hide Tool materials by default. I don't think we need to do this now that we use the BSP, but just in case...
class HiddenMaterial extends Material_Generic {
    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        super.initStatic(device, cache);
        this.visible = false;
    }
}
//#endregion

//#region Water
class WaterCheapMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
#ifdef USE_TEXSCROLL
    vec4 u_TexScroll;
#endif
    vec4 u_ReflectTint;
    vec4 u_Misc[1];
};

#define u_DistanceStart (u_Misc[0].x)
#define u_DistanceEnd   (u_Misc[0].y)

// Normal Map Coordinates
varying vec2 v_TexCoord0;
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Normalmap
uniform sampler2D u_Texture[1];
// Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = a_Normal.xyz;

    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = a_TexCoord.xy;
}
#endif

#ifdef FRAG
void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord0.xy;
    vec3 t_BumpmapSample0 = texture(SAMPLER_2D(u_Texture[0], t_BumpmapCoord0)).rgb;
#ifdef USE_TEXSCROLL
    vec2 t_BumpmapCoord1 = vec2(t_BumpmapCoord0.x + t_BumpmapCoord0.y, -t_BumpmapCoord0.x + t_BumpmapCoord0.y) + 0.1 * u_TexScroll.xy;
    vec3 t_BumpmapSample1 = texture(SAMPLER_2D(u_Texture[0], t_BumpmapCoord1)).rgb;
    vec2 t_BumpmapCoord2 = t_BumpmapCoord0.yx + 0.45 * u_TexScroll.zw;
    vec3 t_BumpmapSample2 = texture(SAMPLER_2D(u_Texture[0], t_BumpmapCoord2)).rgb;
    vec3 t_BumpmapNormal = 0.33 * (t_BumpmapSample0 + t_BumpmapSample1 + t_BumpmapSample2);
#else
    vec3 t_BumpmapNormal = t_BumpmapSample0;
#endif
    t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapNormal);

    vec3 t_NormalWorld = CalcNormalWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec4 t_FinalColor;

    vec3 t_SpecularLighting = vec3(0.0);
    t_SpecularLighting = texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= u_ReflectTint.rgb;
    t_FinalColor.rgb = t_SpecularLighting;

#ifdef USE_FRESNEL
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = CalcFresnelTerm(dot(t_NormalWorld, t_WorldDirectionToEye));
#else
    float t_Fresnel = u_ReflectTint.a;
#endif

    float t_Distance = length(t_PositionToEye);
    float t_ReflectAmount = (t_Distance - u_DistanceStart) / (u_DistanceEnd - u_DistanceStart);
    t_FinalColor.a = clamp(t_Fresnel + t_ReflectAmount, 0.0, 1.0);

    // TODO(jstpierre): RefractWater

    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Water extends BaseMaterial {
    private program: GenericMaterialProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    private wantsTexScroll = false;

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$envmap']                       = new ParameterTexture(VTFFlags.SRGB);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$reflecttint']                  = new ParameterColor(1, 1, 1);
        p['$reflectamount']                = new ParameterNumber(0.8);
        p['$scroll1']                      = new ParameterVector(3);
        p['$scroll2']                      = new ParameterVector(3);
        p['$nofresnel']                    = new ParameterBoolean(false, false);
        p['$cheapwaterstartdistance']      = new ParameterNumber(500.0);
        p['$cheapwaterenddistance']        = new ParameterNumber(1000.0);
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        // Use Cheap water for now.
        this.program = new WaterCheapMaterialProgram();
        this.program.setDefineBool('USE_FRESNEL', !this.paramGetBoolean('$nofresnel'));

        if (this.paramGetVector('$scroll1').get(0) !== 0) {
            this.wantsTexScroll = true;
            this.program.setDefineBool('USE_TEXSCROLL', true);
        }

        const translucentLayer = this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Blend);
        const sortLayer = translucentLayer ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$normalmap').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: mat4): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(GenericMaterialProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(GenericMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix);

        if (this.wantsTexScroll) {
            const scroll1x = this.paramGetVector('$scroll1').get(0) * renderContext.globalTime;
            const scroll1y = this.paramGetVector('$scroll1').get(1) * renderContext.globalTime;
            const scroll2x = this.paramGetVector('$scroll2').get(0) * renderContext.globalTime;
            const scroll2y = this.paramGetVector('$scroll2').get(1) * renderContext.globalTime;
            offs += fillVec4(d, offs, scroll1x, scroll1y, scroll2x, scroll2y);
        }

        offs += this.paramFillColor(d, offs, '$reflecttint', '$reflectamount');

        const cheapwaterstartdistance = this.paramGetNumber('$cheapwaterstartdistance');
        const cheapwaterenddistance = this.paramGetNumber('$cheapwaterenddistance');
        offs += fillVec4(d, offs, cheapwaterstartdistance, cheapwaterenddistance);

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Material Cache
export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        // Install render targets
        this.textureCache.set('_rt_Camera', new VTF(device, cache, null, '_rt_Camera', 0));
    }

    public async bindLocalCubemap(path: string) {
        const vtf = await this.fetchVTF(path, VTFFlags.SRGB);
        this.textureCache.set('env_cubemap', vtf);
    }

    private resolvePath(path: string, ext: string): string {
        if (!path.endsWith(ext))
            path = `${path}${ext}`;
        return this.filesystem.resolvePath(`materials/${path}`);
    }

    private async fetchMaterialDataInternal(name: string): Promise<VMT> {
        const path = this.resolvePath(name, '.vmt');
        return parseVMT(this.filesystem, path);
    }

    private fetchMaterialData(path: string): Promise<VMT> {
        if (!this.materialPromiseCache.has(path))
            this.materialPromiseCache.set(path, this.fetchMaterialDataInternal(path));
        return this.materialPromiseCache.get(path)!;
    }

    private createMaterialInstanceInternal(vmt: VMT): BaseMaterial {
        // Hacks for now. I believe these are normally hidden by not actually being in the BSP tree.
        if (vmt['%compilesky'] || vmt['%compiletrigger']) {
            return new HiddenMaterial(vmt);
        }

        // Dispatch based on shader type.
        const shaderType = vmt._Root.toLowerCase();
        if (shaderType === 'water')
            return new Material_Water(vmt);
        else if (shaderType === 'unlittwotexture' || shaderType === 'monitorscreen')
            return new Material_UnlitTwoTexture(vmt);
        else
            return new Material_Generic(vmt);
    }

    public async createMaterialInstance(renderContext: SourceRenderContext, path: string): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        await materialInstance.init(renderContext);
        return materialInstance;
    }

    private async fetchVTFInternal(name: string, additionalFlags: VTFFlags): Promise<VTF> {
        const path = this.resolvePath(name, '.vtf');
        const data = await this.filesystem.fetchFileData(path);
        const vtf = new VTF(this.device, this.cache, data, path, additionalFlags);
        this.textureCache.set(name, vtf);
        return vtf;
    }

    public fetchVTF(name: string, additionalFlags: VTFFlags = 0): Promise<VTF> {
        if (this.textureCache.has(name))
            return Promise.resolve(this.textureCache.get(name)!);

        if (!this.texturePromiseCache.has(name))
            this.texturePromiseCache.set(name, this.fetchVTFInternal(name, additionalFlags));
        return this.texturePromiseCache.get(name)!;
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
//#endregion

//#region Lightmap / Lighting data
class LightmapPage {
    public gfxTexture: GfxTexture;
    public data: Uint8Array;
    public instances: SurfaceLightingInstance[] = [];

    constructor(device: GfxDevice, private packer: LightmapPackerPage) {
        const width = this.packer.width, height = this.packer.height;
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_SRGB, width, height, 1));
        this.data = new Uint8Array(width * height * 4);
    }

    public registerInstance(instance: SurfaceLightingInstance): void {
        this.instances.push(instance);
        instance.page = this;
        instance.gfxTexture = this.gfxTexture;
        instance.bumpPageOffset = (instance.lighting.height / 4) / this.packer.height;
    }

    public prepareToRender(device: GfxDevice): void {
        const data = this.data;

        // Go through and stamp each surface into the page at the right location.

        // TODO(jstpierre): Maybe it makes more sense for packRuntimeLightmapData to do this positioning.
        let anyDirty = false;
        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];
            if (!instance.lightmapUploadDirty)
                continue;

            const alloc = instance.lighting;
            const pixelData = instance.pixelData!;

            let srcOffs = 0;
            for (let y = alloc.pagePosY; y < alloc.pagePosY + alloc.height; y++) {
                for (let x = alloc.pagePosX; x < alloc.pagePosX + alloc.width; x++) {
                    let dstOffs = (y * this.packer.width + x) * 4;
                    // Copy one pixel.
                    data[dstOffs++] = pixelData[srcOffs++];
                    data[dstOffs++] = pixelData[srcOffs++];
                    data[dstOffs++] = pixelData[srcOffs++];
                    data[dstOffs++] = pixelData[srcOffs++];
                }
            }

            // Not dirty anymore.
            anyDirty = true;
            instance.lightmapUploadDirty = false;
        }

        if (anyDirty) {
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(this.gfxTexture, 0, [data]);
            device.submitPass(hostAccessPass);
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
        this.gfxSampler = cache.createSampler(device, {
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 100,
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
        });
    }

    public appendPackerManager(manager: LightmapPackerManager): void {
        for (let i = 0; i < manager.pages.length; i++)
            this.lightmapPages.push(new LightmapPage(this.device, manager.pages[i]));
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].prepareToRender(device);
    }

    public registerInstance(instance: SurfaceLightingInstance): void {
        // TODO(jstpierre): PageIndex isn't unique / won't work with multiple BSP files.
        this.lightmapPages[instance.lighting.pageIndex].registerInstance(instance);
        instance.gfxSampler = this.gfxSampler;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].destroy(device);
    }
}

// Convert from RGBM-esque storage to linear light
export function unpackColorRGB32Exp(v: number, exp: number): number {
    // exp comes in unsigned, sign extend
    exp = (exp << 24) >> 24;
    const m = Math.pow(2.0, exp) / 0xFF;
    return v * m;
}

function lightmapAccumLight(dst: Float32Array, dstOffs: number, src: Uint8Array, srcOffs: number, size: number, m: number): void {
    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], exp = src[srcOffs + i + 3];
        dst[dstOffs++] += m * unpackColorRGB32Exp(sr, exp);
        dst[dstOffs++] += m * unpackColorRGB32Exp(sg, exp);
        dst[dstOffs++] += m * unpackColorRGB32Exp(sb, exp);
    }
}

function gammaToLinear(v: number): number {
    const gamma = 2.2;
    return Math.pow(v, gamma);
}

// Convert from linear light to runtime lightmap storage light (currently gamma 2.2).
function linearToLightmap(v: number): number {
    const gamma = 2.2;
    // 0.5 factor here is overbright.
    return Math.pow(v, 1.0 / gamma) * 0.5;
}

function lightmapPackRuntime(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, texelCount: number): void {
    for (let i = 0; i < texelCount; i++) {
        const sr = linearToLightmap(src[srcOffs++]), sg = linearToLightmap(src[srcOffs++]), sb = linearToLightmap(src[srcOffs++]);
        dst[dstOffs++] = (sr * 255.0) | 0;
        dst[dstOffs++] = (sg * 255.0) | 0;
        dst[dstOffs++] = (sb * 255.0) | 0;
        dstOffs++;
    }
}

function lightmapPackRuntimeBumpmap(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, texelCount: number): void {
    const srcSize = texelCount * 3;
    const dstSize = texelCount * 4;

    let srcOffs0 = srcOffs, srcOffs1 = srcOffs + srcSize * 1, srcOffs2 = srcOffs + srcSize * 2, srcOffs3 = srcOffs + srcSize * 3;
    let dstOffs0 = dstOffs, dstOffs1 = dstOffs + dstSize * 1, dstOffs2 = dstOffs + dstSize * 2, dstOffs3 = dstOffs + dstSize * 3;
    for (let i = 0; i < texelCount; i++) {
        const sr = linearToLightmap(src[srcOffs0++]), sg = linearToLightmap(src[srcOffs0++]), sb = linearToLightmap(src[srcOffs0++]);

        // Lightmap 0 is easy (unused tho).
        dst[dstOffs0++] = (sr * 255.0) | 0;
        dst[dstOffs0++] = (sg * 255.0) | 0;
        dst[dstOffs0++] = (sb * 255.0) | 0;
        dstOffs0++;

        let b0r = src[srcOffs1++], b0g = src[srcOffs1++], b0b = src[srcOffs1++];
        let b1r = src[srcOffs2++], b1g = src[srcOffs2++], b1b = src[srcOffs2++];
        let b2r = src[srcOffs3++], b2g = src[srcOffs3++], b2b = src[srcOffs3++];
        const avgr = sr / Math.max((b0r + b1r + b2r) / 3.0, MathConstants.EPSILON);
        const avgg = sg / Math.max((b0g + b1g + b2g) / 3.0, MathConstants.EPSILON);
        const avgb = sb / Math.max((b0b + b1b + b2b) / 3.0, MathConstants.EPSILON);

        b0r *= avgr; b0g *= avgg; b0b *= avgb;
        b1r *= avgr; b1g *= avgg; b1b *= avgb;
        b2r *= avgr; b2g *= avgg; b2b *= avgb;

        // Clamp & redistribute colors if necessary
        const b0m = Math.max(b0r, b0g, b0b), b1m = Math.max(b1r, b1g, b1b), b2m = Math.max(b2r, b2g, b2b);
        if (b0m > 1.0 || b1m > 1.0 || b2m > 1.0) {
            // Slow path, just allocate here to save our sanity.
            const colors = [[0, b0m, b0r, b0g, b0b], [1, b1m, b1r, b1g, b1b], [2, b2m, b2r, b2g, b2b]];
            colors.sort((a, b) => b[1] - a[1]);

            for (let j = 0; j < colors.length; j++) {
                if (colors[j][1] > 1.0) {
                    const max = Math.max(colors[j][2], colors[j][2], colors[j][3]);
                    const m = (max - 1.0) / max;
                    colors[j][2] -= m;
                    colors[j][3] -= m;
                    colors[j][4] -= m;

                    colors[(j+1)%3][2] += m * 0.5;
                    colors[(j+1)%3][3] += m * 0.5;
                    colors[(j+1)%3][4] += m * 0.5;

                    colors[(j+2)%3][2] += m * 0.5;
                    colors[(j+2)%3][3] += m * 0.5;
                    colors[(j+2)%3][4] += m * 0.5;
                }
            }

            for (let j = 0; j < colors.length; j++) {
                if (colors[j][2] > 1.0 || colors[j][3] > 1.0 || colors[j][3] > 1.0) {
                    const m = Math.max(colors[j][2], colors[j][2], colors[j][3]);
                    colors[j][2] /= m;
                    colors[j][3] /= m;
                    colors[j][4] /= m;
                }

                if (colors[j][0] === 0) {
                    b0r = colors[j][2];
                    b0g = colors[j][3];
                    b0b = colors[j][4];
                } else if (colors[j][0] === 1) {
                    b1r = colors[j][2];
                    b1g = colors[j][3];
                    b1b = colors[j][4];
                } else if (colors[j][0] === 2) {
                    b2r = colors[j][2];
                    b2g = colors[j][3];
                    b2b = colors[j][4];
                }
            }
        }

        dst[dstOffs1++] = (b0r * 255.0) | 0;
        dst[dstOffs1++] = (b0g * 255.0) | 0;
        dst[dstOffs1++] = (b0b * 255.0) | 0;
        dstOffs1++;

        dst[dstOffs2++] = (b1r * 255.0) | 0;
        dst[dstOffs2++] = (b1g * 255.0) | 0;
        dst[dstOffs2++] = (b1b * 255.0) | 0;
        dstOffs2++;

        dst[dstOffs3++] = (b2r * 255.0) | 0;
        dst[dstOffs3++] = (b2g * 255.0) | 0;
        dst[dstOffs3++] = (b2b * 255.0) | 0;
        dstOffs3++;
    }
}

export class WorldLightingState {
    public styleIntensities = new Float32Array(255);

    constructor() {
        this.styleIntensities.fill(1.0);
    }
}

function createRuntimeLightmap(width: number, height: number, wantsLightmap: boolean, wantsBumpmap: boolean): Uint8ClampedArray | null {
    if (!wantsLightmap && !wantsBumpmap) {
        return null;
    }

    let numLightmaps = 1;
    if (wantsLightmap && wantsBumpmap) {
        numLightmaps = 4;
    }

    const lightmapSize = (width * height * 4);
    return new Uint8ClampedArray(numLightmaps * lightmapSize);
}

export class SurfaceLightingInstance {
    // The styles that we built our lightmaps for.
    public lightmapStyleIntensities: number[];
    public lightmapUploadDirty: boolean = false;
    public lighting: SurfaceLighting;
    public pixelData: Uint8ClampedArray | null;

    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler | null = null;
    public page: LightmapPage | null = null;
    public bumpPageOffset: number = 0;

    private scratchpad: Float32Array;

    constructor(lightmapManager: LightmapManager, surface: Surface, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.scratchpad = lightmapManager.scratchpad;

        this.lighting = assertExists(surface.lighting);
        this.pixelData = createRuntimeLightmap(this.lighting.width, this.lighting.height, this.wantsLightmap, this.wantsBumpmap);

        this.lightmapStyleIntensities = nArray(this.lighting.styles.length, () => -1);

        if (this.wantsLightmap) {
            // Associate ourselves with the right page.
            lightmapManager.registerInstance(this);
        }
    }

    public buildLightmap(worldLightingState: WorldLightingState): void {
        // Check if our lightmap needs rebuilding.
        let dirty = false;
        for (let i = 0; i < this.lighting.styles.length; i++) {
            const styleIdx = this.lighting.styles[i];
            if (worldLightingState.styleIntensities[styleIdx] !== this.lightmapStyleIntensities[i]) {
                this.lightmapStyleIntensities[i] = worldLightingState.styleIntensities[styleIdx];
                dirty = true;
            }
        }

        if (!dirty)
            return;

        const hasLightmap = this.lighting.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const texelCount = this.lighting.mapWidth * this.lighting.mapHeight;
            const srcNumLightmaps = (this.wantsBumpmap && this.lighting.hasBumpmapSamples) ? 4 : 1;
            const srcSize = srcNumLightmaps * texelCount * 4;

            const scratchpad = this.scratchpad;
            scratchpad.fill(0);
            assert(scratchpad.byteLength >= srcSize);

            let srcOffs = 0;
            for (let i = 0; i < this.lighting.styles.length; i++) {
                const styleIdx = this.lighting.styles[i];
                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lighting.samples!, srcOffs, srcSize, intensity);
                srcOffs += srcSize;
            }

            if (this.wantsBumpmap && !this.lighting.hasBumpmapSamples) {
                // Game wants bumpmap samples but has none. Copy from primary lightsource.
                const src = new Float32Array(scratchpad.buffer, 0, srcSize * 3);
                for (let i = 1; i < 4; i++) {
                    const dst = new Float32Array(scratchpad.buffer, i * srcSize * 3, srcSize * 3);
                    dst.set(src);
                }
            }

            if (this.wantsBumpmap) {
                lightmapPackRuntimeBumpmap(this.pixelData!, 0, scratchpad, 0, texelCount);
            } else {
                lightmapPackRuntime(this.pixelData!, 0, scratchpad, 0, texelCount);
            }
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
            this.pixelData!.fill(255);
        }

        this.lightmapUploadDirty = true;
    }
}
//#endregion

//#region Material Proxy System
class ParameterReference {
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
        if (ref.index !== -1)
            return pm.index(ref.index) as T;
        else
            return pm as T;
    } else {
        return ref.value as T;
    }
}

function paramLookup<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T {
    return assertExists(paramLookupOptional<T>(map, ref));
}

function paramGetNum(map: ParameterMap, ref: ParameterReference): number {
    return paramLookup<ParameterNumber>(map, ref).value;
}

function paramSetNum(map: ParameterMap, ref: ParameterReference, v: number): void {
    paramLookup<ParameterNumber>(map, ref).value = v;
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
        this.registerProxyFactory(MaterialProxy_WaterLOD);
        this.registerProxyFactory(MaterialProxy_TextureTransform);
        this.registerProxyFactory(MaterialProxy_ToggleTexture);
    }

    public registerProxyFactory(factory: MaterialProxyFactory): void {
        this.proxyFactories.set(factory.type, factory);
    }

    public createProxyDriver(material: BaseMaterial, proxyDefs: VKFPair[]): MaterialProxyDriver {
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

type VKFParamMap = { [k: string]: string };

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
        // TODO(jstpierre): Proximity.
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
        const dist = vec3.distance(renderContext.cameraPos, entityParams.position);
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

class MaterialProxy_WaterLOD {
    public static type = 'waterlod';

    constructor(params: VKFParamMap) {
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        (map['$cheapwaterstartdistance'] as ParameterNumber).value = renderContext.cheapWaterStartDistance;
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
            cx = center.index(0).value;
            cy = center.index(1).value;
        }

        let sx = 1.0, sy = 1.0;
        if (scale instanceof ParameterNumber) {
            sx = sy = scale.value;
        } else if (scale instanceof ParameterVector) {
            sx = scale.index(0).value;
            sy = scale.index(1).value;
        }

        let r = 0.0;
        if (rotate !== null)
            r = rotate.value;

        let tx = 0.0, ty = 0.0;
        if (translate instanceof ParameterNumber) {
            tx = ty = translate.value;
        } else if (translate instanceof ParameterVector) {
            tx = translate.index(0).value;
            ty = translate.index(1).value;
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
//#endregion
