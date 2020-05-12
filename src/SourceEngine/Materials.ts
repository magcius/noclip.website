
import { DeviceProgram } from "../Program";
import { VMT, parseVMT, vmtParseColor, VKFPair } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey } from "../gfx/render/GfxRenderer";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceRenderContext, SourceFileSystem } from "./Scenes_HalfLife2";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { Surface, SurfaceLighting } from "./BSPFile";
import { Color, White, colorNewCopy } from "../Color";
import { MathConstants, invlerp, lerp, clamp } from "../MathHelpers";

export class BaseMaterialProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TangentS = 2;
    public static a_TexCoord = 3;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
};

layout(row_major, std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
#ifdef USE_DETAIL
    vec4 u_DetailScaleBias;
#endif
#ifdef USE_LIGHTMAP
    vec4 u_LightmapScaleBias;
#endif
#ifdef USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
#endif
#ifdef USE_BASE2TEXTURE
    vec4 u_Base2TextureScaleBias;
#endif
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
varying vec3 v_PositionWorld;

#define HAS_FULL_TANGENTSPACE (USE_BUMPMAP)

#ifdef HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;

// Base, Detail, Bumpmap, Lightmap, Envmap Mask, Base 2
uniform sampler2D u_Texture[6];

// Cube Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${BaseMaterialProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${BaseMaterialProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${BaseMaterialProgram.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${BaseMaterialProgram.a_TexCoord}) attribute vec4 a_TexCoord;

vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld = t_PositionWorld;
    vec3 t_NormalWorld = a_Normal;

#ifdef HAS_FULL_TANGENTSPACE
    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    // TODO(jstpierre): BaseScale
    v_TexCoord0.xy = a_TexCoord.xy;
#ifdef USE_DETAIL
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord.xy, u_DetailScaleBias);
#endif
#ifdef USE_LIGHTMAP
    v_TexCoord1.xy = CalcScaleBias(a_TexCoord.zw, u_LightmapScaleBias);
#endif
#ifdef USE_ENVMAP_MASK
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord.xy, u_EnvmapMaskScaleBias);
#endif
#ifdef USE_BUMPMAP
    // TODO(jstpierre): BumpmapScale
    v_TexCoord2.xy = a_TexCoord.xy;
#endif
#ifdef USE_BASE2TEXTURE
    v_TexCoord2.zw = CalcScaleBias(a_TexCoord.xy, u_Base2TextureScaleBias);
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

vec3 CalcReflection(in vec3 t_NormalWorld, in vec3 t_PositionToEye) {
    return (2.0 * (dot(t_NormalWorld, t_PositionToEye)) * t_NormalWorld) - (dot(t_NormalWorld, t_NormalWorld) * t_PositionToEye);
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 1.2247448713915890,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

void mainPS() {
    vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture[0], v_TexCoord0.xy));

    vec4 t_Albedo;
#ifdef USE_DETAIL
    vec4 t_DetailTexture = texture(SAMPLER_2D(u_Texture[1], v_TexCoord0.zw)).rgba;
    t_Albedo = TextureCombine(t_BaseTexture, t_DetailTexture, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#else
    t_Albedo = t_BaseTexture;
#endif

#ifdef USE_BASE2TEXTURE
    vec4 t_Base2Texture = texture(SAMPLER_2D(u_Texture[5], v_TexCoord2.zw)).rgba;
    t_Albedo *= t_Base2Texture;
#endif

#ifdef USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;
#ifdef USE_BUMPMAP
    vec4 t_BumpmapSample = texture(SAMPLER_2D(u_Texture[2], v_TexCoord2.xy));
    vec3 t_BumpmapNormal = t_BumpmapSample.rgb * 2.0 - 1.0;

    t_NormalWorld.x = dot(vec3(v_TangentSpaceBasis0.x, v_TangentSpaceBasis1.x, v_TangentSpaceBasis2.x), t_BumpmapNormal);
    t_NormalWorld.y = dot(vec3(v_TangentSpaceBasis0.y, v_TangentSpaceBasis1.y, v_TangentSpaceBasis2.y), t_BumpmapNormal);
    t_NormalWorld.z = dot(vec3(v_TangentSpaceBasis0.z, v_TangentSpaceBasis1.z, v_TangentSpaceBasis2.z), t_BumpmapNormal);
#else
    t_NormalWorld = v_TangentSpaceBasis2;
#endif

vec3 t_DiffuseLighting;
#ifdef USE_LIGHTMAP
#ifdef USE_DIFFUSE_BUMPMAP
    vec3 t_LightmapColor1 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 1.0))).rgb;
    vec3 t_LightmapColor2 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 2.0))).rgb;
    vec3 t_LightmapColor3 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, u_LightmapOffset * 3.0))).rgb;
    vec3 t_Influence;
    t_Influence.x = clamp(dot(t_NormalWorld, g_RNBasis0), 0.0, 1.0);
    t_Influence.y = clamp(dot(t_NormalWorld, g_RNBasis1), 0.0, 1.0);
    t_Influence.z = clamp(dot(t_NormalWorld, g_RNBasis2), 0.0, 1.0);

    t_DiffuseLighting = vec3(0.0);
    t_DiffuseLighting += t_LightmapColor1 * t_Influence.x;
    t_DiffuseLighting += t_LightmapColor2 * t_Influence.y;
    t_DiffuseLighting += t_LightmapColor3 * t_Influence.z;
#else
    t_DiffuseLighting = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy)).rgb;
#endif
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
    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);
    t_SpecularLighting += texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= t_SpecularFactor;

    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = pow(1.0 - dot(t_NormalWorld, t_WorldDirectionToEye), 5.0);
    t_SpecularLighting *= t_Fresnel;

    t_FinalColor.rgb += t_SpecularLighting.rgb;
#endif

#ifndef USE_BASE_ALPHA_ENVMAP_MASK
    t_FinalColor.a = t_BaseTexture.a;
#endif

    // Gamma correction.
    t_FinalColor.rgb = pow(t_FinalColor.rgb, vec3(1.0 / 2.2));

    gl_FragColor = t_FinalColor;
}
#endif
`;
}

function scaleBiasSet(dst: vec4, scale: number, x: number = 0.0, y: number = 0.0): void {
    vec4.set(dst, scale, scale, x, y);
}

type ParameterMap = { [k: string]: Parameter };

export interface BaseMaterial {
    isMaterialLoaded(): boolean;
    setLightmapAllocation(allocation: LightmapAllocation): void;
    movement(renderContext: SourceRenderContext): void;
    setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: mat4): void;
    visible: boolean;
    wantsLightmap: boolean;
    wantsBumpmappedLightmap: boolean;
    param: ParameterMap;
    entityParams: EntityParameters;
}

interface Parameter {
    parse(S: string): void;
    index(i: number): Parameter;
    set(param: Parameter): void;
}

class ParameterTexture {
    public ref: string | null = null;
    public parse(S: string): void { this.ref = S; }
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

class ParameterMatrix {
    public matrix = mat4.create();

    constructor() { }

    public parse(S: string): void {
        // "center {} {} scale {} {} rotate {} translate {} {}"
        const [cx, cy, sx, sy, r, tx, ty] = assertExists(/center (.+) (.+) scale (.+) (.+) rotate (.+) translate (.+) (.+)/.exec(S));
        // TODO(jstpierre): Matrix
    }

    public index(i: number): Parameter { throw "whoops"; }
    public set(param: Parameter): void { throw "whoops"; }
}

class ParameterColor {
    private internal: ParameterNumber[] = nArray(3, () => new ParameterNumber(0.0));
    private color: Color = colorNewCopy(White);

    constructor(r: number, g: number = r, b: number = r) {
        this.internal[0].value = r;
        this.internal[1].value = g;
        this.internal[2].value = b;
    }

    public parse(S: string): void {
        vmtParseColor(this.color, S);
        this.internal[0].value = this.color.r;
        this.internal[1].value = this.color.g;
        this.internal[2].value = this.color.b;
    }

    public index(i: number): Parameter {
        return this.internal[i];
    }

    public set(param: Parameter): void {
        if (param instanceof ParameterColor) {
            this.internal[0].value = param.internal[0].value;
            this.internal[1].value = param.internal[1].value;
            this.internal[2].value = param.internal[2].value;
        } else {
            throw "whoops";
        }
    }

    public getColor(): Color {
        this.color.r = this.internal[0].value;
        this.color.g = this.internal[1].value;
        this.color.b = this.internal[2].value;
        return this.color;
    }
}

function createParameterAuto(S: string): Parameter | null {
    const n = Number(S);
    if (n !== undefined)
        return new ParameterNumber(n);

    // Try Vector
    if (S.startsWith('[') || S.startsWith('{')) {
        const color = new ParameterColor(0);
        color.parse(S);
    }

    // Unknown.
    return null;
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

class EntityParameters {
    public position = vec3.create();
}

// LightmappedGeneric, UnlitGeneric, VertexLightingGeneric
const scratchVec4 = vec4.create();
class GenericMaterial implements BaseMaterial {
    public visible = true;
    public wantsLightmap = false;
    public wantsBumpmappedLightmap = false;
    public param: ParameterMap = {};
    public entityParams = new EntityParameters();

    private proxySystem: MaterialProxySystem | null = null;
    private loaded: boolean = false;
    private wantsDetail = false;
    private wantsBase2Texture = false;
    private wantsEnvmapMask = false;
    private wantsEnvmap = false;

    private program: BaseMaterialProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    // Texture parameters. TODO(jstpierre): Move to Parameter?
    private baseTexture: VTF | null = null;
    private detailTexture: VTF | null = null;
    private bumpmapTexture: VTF | null = null;
    private envmapMaskTexture: VTF | null = null;
    private base2Texture: VTF | null = null;
    private envmapTexture: VTF | null = null;
    private lightmapAllocation: LightmapAllocation | null = null;

    private textureMapping: TextureMapping[] = nArray(7, () => new TextureMapping());

    constructor(public vmt: VMT) {
    }

    public async init(device: GfxDevice, cache: GfxRenderCache, materialCache: MaterialCache) {
        this.initParameters();
        await this.fetchResources(materialCache);
        this.initStatic();

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private async fetchTextureParam(materialCache: MaterialCache, name: string): Promise<VTF | null> {
        const ref = (this.param[name] as ParameterTexture).ref;
        if (ref !== null)
            return await materialCache.fetchVTF(ref);
        else
            return null;
    }

    protected async fetchResources(materialCache: MaterialCache) {
        // TODO(jstpierre): Fetch in parallel?
        this.baseTexture       = await this.fetchTextureParam(materialCache, '$basetexture');
        this.detailTexture     = await this.fetchTextureParam(materialCache, '$detail');
        this.bumpmapTexture    = await this.fetchTextureParam(materialCache, '$bumpmap');
        this.envmapMaskTexture = await this.fetchTextureParam(materialCache, '$envmapmask');
        this.base2Texture      = await this.fetchTextureParam(materialCache, '$texture2');
        this.envmapTexture     = await this.fetchTextureParam(materialCache, '$envmap');
        this.loaded = true;
    }

    private paramFillScaleBias(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        // Make sure there's no rotation. We should definitely handle this eventually, though.
        assert(m[1] === 0.0 && m[2] === 0.0);
        const scaleS = m[0];
        const scaleT = m[5];
        const transS = m[12];
        const transT = m[13];
        return fillVec4(d, offs, scaleS, scaleT, transS, transT);
    }

    private paramGetBoolean(name: string): boolean {
        return (this.param[name] as ParameterBoolean).getBool();
    }

    private paramGetNumber(name: string): number {
        return (this.param[name] as ParameterNumber).value;
    }

    private paramGetInt(name: string): number {
        return this.paramGetNumber(name) | 0;
    }

    private textureIsTranslucent(texture: VTF): boolean {
        if (texture === this.baseTexture) {
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

    protected initParameters(): void {
        const p = this.param;

        // Base parameters
        p['$basetexture']                  = new ParameterTexture();
        p['$basetexturetransform']         = new ParameterMatrix();
        p['$frame']                        = new ParameterNumber(0);
        p['$color']                        = new ParameterColor(1, 1, 1);
        p['$alpha']                        = new ParameterNumber(1);

        // Material vars
        p['$selfillum']                    = new ParameterBoolean(false, false);
        p['$additive']                     = new ParameterBoolean(false, false);
        p['$alphatest']                    = new ParameterBoolean(false, false);
        p['$translucent']                  = new ParameterBoolean(false, false);
        p['$basealphaenvmapmask']          = new ParameterBoolean(false, false);
        p['$normalmapalphaenvmapmask']     = new ParameterBoolean(false, false);

        // Generic
        p['$opaquetexture']                = new ParameterBoolean(false, false);
        p['$envmap']                       = new ParameterTexture();
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$envmapmask']                   = new ParameterTexture();
        p['$envmapmaskframe']              = new ParameterNumber(0);
        p['$envmapmasktransform']          = new ParameterMatrix();
        p['$envmaptint']                   = new ParameterColor(1, 1, 1);
        p['$detail']                       = new ParameterTexture();
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

        // Unlit Two Texture
        // TODO(jstpierre): Break out into a separate class?
        p['$texture2']                     = new ParameterTexture();
        p['$texture2transform']            = new ParameterMatrix();
        p['$frame2']                       = new ParameterNumber(0.0);

        setupParametersFromVMT(p, this.vmt);
        if (this.vmt.proxies !== undefined)
            this.proxySystem = new MaterialProxySystem(this, this.vmt.proxies);
    }

    protected initStatic() {
        // Init static portions of the material.

        const vmt = this.vmt;

        const shaderType = vmt._Root.toLowerCase();

        this.program = new BaseMaterialProgram();
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.baseTexture !== null)
            this.baseTexture.fillTextureMapping(this.textureMapping[0]);

        if (this.detailTexture !== null) {
            this.wantsDetail = true;
            this.program.defines.set('USE_DETAIL', '1');
            this.program.defines.set('DETAIL_COMBINE_MODE', '' + this.paramGetNumber('$detailblendmode'));
        }

        if (this.bumpmapTexture !== null) {
            this.program.defines.set('USE_BUMPMAP', '1');
            const wantsDiffuseBumpmap = !this.paramGetBoolean('$nodiffusebumplighting');
            this.program.defines.set('USE_DIFFUSE_BUMPMAP', wantsDiffuseBumpmap ? '1' : '0');
            this.wantsBumpmappedLightmap = wantsDiffuseBumpmap;
        }

        // Lightmap = 3

        if (this.envmapMaskTexture !== null) {
            this.wantsEnvmapMask = true;
            this.program.defines.set('USE_ENVMAP_MASK', '1');
        }

        if (this.base2Texture !== null) {
            this.wantsBase2Texture = true;
            this.program.defines.set('USE_BASE2TEXTURE', '1');
        }

        if (this.envmapTexture !== null) {
            this.wantsEnvmap = true;
            this.program.defines.set('USE_ENVMAP', '1');
        }

        if (shaderType === 'lightmappedgeneric') {
            // Use lightmap. We don't support bump-mapped lighting yet.
            this.program.defines.set('USE_LIGHTMAP', '1');
            this.wantsLightmap = true;
        }

        if (this.paramGetBoolean('$basealphaenvmapmask'))
            this.program.defines.set('USE_BASE_ALPHA_ENVMAP_MASK', '1');

        if (this.paramGetBoolean('$normalmapalphaenvmapmask'))
            this.program.defines.set('USE_NORMALMAP_ALPHA_ENVMAP_MASK', '1');

        if (this.paramGetBoolean('$alphatest')) {
            this.program.defines.set('USE_ALPHATEST', '1');
        } else {
            let isTranslucent = false;

            if (this.baseTexture !== null && this.textureIsTranslucent(this.baseTexture))
                isTranslucent = true;

            if (isTranslucent && this.paramGetBoolean('$additive')) {
                // BLENDADD
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            } else if (isTranslucent) {
                // BLEND
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                });
            } else if (this.paramGetBoolean('$additive')) {
                // ADD
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.ONE,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            }

            let sortLayer: GfxRendererLayer;
            if (isTranslucent || this.paramGetBoolean('$additive')) {
                this.megaStateFlags.depthWrite = false;
                sortLayer = GfxRendererLayer.TRANSLUCENT;
            } else {
                sortLayer = GfxRendererLayer.OPAQUE;
            }

            this.sortKeyBase = makeSortKey(sortLayer);
        }
    }

    public isMaterialLoaded(): boolean {
        return this.loaded;
    }

    public setLightmapAllocation(lightmapAllocation: LightmapAllocation): void {
        this.lightmapAllocation = lightmapAllocation;
        const lightmapTextureMapping = this.textureMapping[3];
        lightmapTextureMapping.gfxTexture = this.lightmapAllocation.gfxTexture;
        lightmapTextureMapping.gfxSampler = this.lightmapAllocation.gfxSampler;
    }

    private updateTextureMappings(): void {
        if (this.baseTexture !== null)
            this.baseTexture.fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        if (this.detailTexture !== null)
            this.detailTexture.fillTextureMapping(this.textureMapping[1], this.paramGetInt('$detailframe'));
        if (this.bumpmapTexture !== null)
            this.bumpmapTexture.fillTextureMapping(this.textureMapping[2], this.paramGetInt('$bumpframe'));
        // Lightmap is supplied by entity.
        if (this.envmapMaskTexture !== null)
            this.envmapMaskTexture.fillTextureMapping(this.textureMapping[4], this.paramGetInt('$envmapmaskframe'));
        if (this.base2Texture !== null)
            this.base2Texture.fillTextureMapping(this.textureMapping[5], this.paramGetInt('$frame2'));
        if (this.envmapTexture !== null)
            this.envmapTexture.fillTextureMapping(this.textureMapping[6], this.paramGetInt('$envmapframe'));
    }

    public movement(renderContext: SourceRenderContext): void {
        // Update the proxy system.
        if (this.proxySystem !== null)
            this.proxySystem.update(renderContext, this.entityParams);
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: mat4): void {
        // Update texture mappings from frames.
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(BaseMaterialProgram.ub_ObjectParams, 4*3+4+4+4+4+4+4+4);
        const d = renderInst.mapUniformBufferF32(BaseMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix);

        if (this.wantsDetail) {
            scaleBiasSet(scratchVec4, this.paramGetNumber('$detailscale'));
            offs += fillVec4v(d, offs, scratchVec4);
        }

        if (this.wantsLightmap)
            offs += fillVec4v(d, offs, this.lightmapAllocation!.scaleBias);

        if (this.wantsEnvmapMask)
            offs += this.paramFillScaleBias(d, offs, '$envmapmasktransform');

        if (this.wantsEnvmap)
            offs += fillColor(d, offs, (this.param['$envmaptint'] as ParameterColor).getColor());

        if (this.wantsBase2Texture)
            offs += this.paramFillScaleBias(d, offs, '$texture2transform');

        const alphaTestReference = this.paramGetNumber('$alphatestreference');
        const detailBlendFactor = this.paramGetNumber('$detailblendfactor');
        const lightmapOffset = this.lightmapAllocation !== null ? this.lightmapAllocation.bumpPageOffset : 0.0;
        offs += fillVec4(d, offs, alphaTestReference, detailBlendFactor, lightmapOffset);

        assert(this.isMaterialLoaded());
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public destroy(device: GfxDevice): void {
    }
}

class HiddenMaterial extends GenericMaterial {
    protected initStatic() {
        super.initStatic();
        this.visible = false;
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        this.textureCache.set('_rt_Camera', new VTF(device, cache, null, '_rt_Camera'));
    }

    private resolvePath(path: string, ext: string): string {
        return this.filesystem.resolvePath(`materials/${path}${ext}`);
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

    private createMaterialInstanceInternal(vmt: VMT): GenericMaterial {
        // Hacks for now. I believe these are normally hidden by not actually being in the BSP tree.
        if (vmt['%compilesky'] || vmt['%compiletrigger']) {
            return new HiddenMaterial(vmt);
        }

        // const shaderType = vmt._Root.toLowerCase();

        // Dispatch based on shader type.
        return new GenericMaterial(vmt);
    }

    public async createMaterialInstance(path: string): Promise<GenericMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        await materialInstance.init(this.device, this.cache, this);
        return materialInstance;
    }

    private async fetchVTFInternal(name: string): Promise<VTF> {
        const path = this.resolvePath(name, '.vtf');
        const data = await this.filesystem.fetchFileData(path);
        const vtf = new VTF(this.device, this.cache, data, path);
        this.textureCache.set(name, vtf);
        return vtf;
    }

    public fetchVTF(name: string): Promise<VTF> {
        if (this.textureCache.has(name))
            return Promise.resolve(this.textureCache.get(name)!);

        if (!this.texturePromiseCache.has(name))
            this.texturePromiseCache.set(name, this.fetchVTFInternal(name));
        return this.texturePromiseCache.get(name)!;
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}

//#region Lightmap / Lighting data
export class LightmapAllocation {
    public width: number = 0;
    public height: number = 0;
    public scaleBias = vec4.create();
    public bumpPageOffset: number = 0;
    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler | null = null;
}

export class LightmapManager {
    private lightmapTextures: GfxTexture[] = [];
    public gfxSampler: GfxSampler;
    public scratchpad = new Float32Array(4 * 128 * 128 * 4);

    constructor(private device: GfxDevice, cache: GfxRenderCache) {
        this.gfxSampler = cache.createSampler(device, {
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 100,
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
        })
    }

    public allocate(allocation: LightmapAllocation): void {
        assert(allocation.gfxTexture === null);

        const gfxFormat = GfxFormat.U8_RGBA_SRGB;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(gfxFormat, allocation.width, allocation.height, 1));
        allocation.gfxTexture = gfxTexture;
        allocation.gfxSampler = this.gfxSampler;
        this.lightmapTextures.push(gfxTexture);

        const textureWidth = allocation.width;
        const textureHeight = allocation.height;

        const scaleX = 1.0 / textureWidth;
        const scaleY = 1.0 / textureHeight;
        const offsX = 0.0;
        const offsY = 0.0;
        vec4.set(allocation.scaleBias, scaleX, scaleY, offsX, offsY);

        allocation.bumpPageOffset = scaleY * (allocation.height / 4);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapTextures.length; i++)
            device.destroyTexture(this.lightmapTextures[i]);
    }
}

// Convert from RGBM-esque storage to linear light
function lightmapUnpackTexelStorage(v: number, exp: number): number {
    // exp comes in unsigned, sign extend
    exp = (exp << 24) >> 24;
    const m = Math.pow(2.0, exp) / 255.0;
    return v * m;
}

function lightmapAccumLight(dst: Float32Array, dstOffs: number, src: Uint8Array, srcOffs: number, size: number, m: number): void {
    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], exp = src[srcOffs + i + 3];
        dst[dstOffs++] = m * lightmapUnpackTexelStorage(sr, exp);
        dst[dstOffs++] = m * lightmapUnpackTexelStorage(sg, exp);
        dst[dstOffs++] = m * lightmapUnpackTexelStorage(sb, exp);
        // TODO(jstpierre): Drop this.
        dst[dstOffs++] = 1.0;
    }
}

// Convert from linear light to runtime lightmap storage space (currently gamma 2.2).
function lightmapPackTexelRuntime(v: number): number {
    const gamma = 2.2;
    return Math.pow(v, 1.0 / gamma);
}

function lightmapPackRuntime(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, size: number): void {
    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], alpha = src[srcOffs + i + 3];
        dst[dstOffs++] = (lightmapPackTexelRuntime(sr) * 255.0) | 0;
        dst[dstOffs++] = (lightmapPackTexelRuntime(sg) * 255.0) | 0;
        dst[dstOffs++] = (lightmapPackTexelRuntime(sb) * 255.0) | 0;
        dst[dstOffs++] = (alpha * 255.0) | 0;
    }
}

export class WorldLightingState {
    public styleIntensities = new Float32Array(255);

    constructor() {
        this.styleIntensities.fill(1.0);
    }
}

function createRuntimeLightmap(width: number, height: number, wantsLightmap: boolean, wantsBumpmap: boolean): Uint8ClampedArray[] {
    if (!wantsLightmap && !wantsBumpmap) {
        return [];
    }

    let numLightmaps = 1;
    if (wantsLightmap && wantsBumpmap) {
        numLightmaps = 4;
    }

    const lightmapSize = (width * height * 4);
    return [new Uint8ClampedArray(numLightmaps * lightmapSize)];
}

export class SurfaceLightingInstance {
    public allocation = new LightmapAllocation();
    public lightmapDirty: boolean = true;

    private lighting: SurfaceLighting;
    private runtimeLightmapData: Uint8ClampedArray[];
    private scratchpad: Float32Array;

    constructor(lightmapManager: LightmapManager, surface: Surface, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.scratchpad = lightmapManager.scratchpad;

        this.lighting = assertExists(surface.lighting);
        this.runtimeLightmapData = createRuntimeLightmap(this.lighting.width, this.lighting.height, this.wantsLightmap, this.wantsBumpmap);

        // Allocate texture.
        if (this.wantsLightmap) {
            const numLightmaps = this.wantsBumpmap ? 4 : 1;
            this.allocation.width = this.lighting.width;
            this.allocation.height = this.lighting.height * numLightmaps;
            lightmapManager.allocate(this.allocation);
        }
    }

    public buildLightmap(worldLightingState: WorldLightingState): void {
        if (!this.lightmapDirty)
            return;

        const hasLightmap = this.lighting.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const dstSize = this.allocation.width * this.allocation.height * 4;
            const srcNumLightmaps = (this.wantsBumpmap && this.lighting.hasBumpmapSamples) ? 4 : 1
            const srcSize = srcNumLightmaps * this.lighting.width * this.lighting.height * 4;

            const scratchpad = this.scratchpad;
            scratchpad.fill(0);
            assert(scratchpad.byteLength >= dstSize);

            let srcOffs = 0;
            for (let i = 0; i < this.lighting.styles.length; i++) {
                const styleIdx = this.lighting.styles[i];
                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lighting.samples!, srcOffs, srcSize, intensity);
                srcOffs += srcSize;
            }

            if (this.wantsBumpmap && !this.lighting.hasBumpmapSamples) {
                // Game wants bumpmap samples but has none. Copy from primary lightsource.
                const src = new Float32Array(scratchpad.buffer, 0, srcSize * 4);
                for (let i = 1; i < 4; i++) {
                    const dst = new Float32Array(scratchpad.buffer, i * srcSize * 4, srcSize * 4);
                    dst.set(src);
                }
            }

            lightmapPackRuntime(this.runtimeLightmapData[0], 0, scratchpad, 0, dstSize);
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
            this.runtimeLightmapData[0].fill(255);
        }

        this.lightmapDirty = false;
    }

    public uploadLightmap(device: GfxDevice): void {
        if (!this.wantsLightmap)
            return;

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(this.allocation.gfxTexture!, 0, this.runtimeLightmapData);
        device.submitPass(hostAccessPass);
    }
}
//#endregion

//#region Material Proxy System
class ParameterReference {
    public name: string | null = null;
    public index: number = -1;
    public value: Parameter | null = null;

    constructor(str: string, defaultValue: number | null = null) {
        if (str === undefined) {
            this.value = new ParameterNumber(assertExists(defaultValue));
        } else if (str.startsWith('$')) {
            // '$envmaptint', '$envmaptint[1]'
            const [, name, index] = assertExists(/([a-z0-9$]+)(?:\[(\d+)\])?/.exec(str));
            this.name = name;
            if (index !== undefined)
                this.index = Number(index);
        } else {
            this.value = createParameterAuto(str);
        }
    }
}

function paramLookup<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T {
    if (ref.name !== null) {
        const pm = map[ref.name];
        if (ref.index !== -1)
            return pm.index(ref.index) as T;
        else
            return pm as T;
    } else {
        return assertExists(ref.value as T);
    }
}

function paramGetNum(map: ParameterMap, ref: ParameterReference): number {
    return paramLookup<ParameterNumber>(map, ref).value;
}

function paramSetNum(map: ParameterMap, ref: ParameterReference, v: number): void {
    paramLookup<ParameterNumber>(map, ref).value = v;
}

class MaterialProxySystem {
    private proxies: MaterialProxy[] = [];

    constructor(private material: BaseMaterial, proxies: VKFPair[]) {
        for (let i = 0; i < proxies.length; i++) {
            const [name, params] = proxies[i];
            const proxy = buildMaterialProxy(name, params);
            if (proxy !== null) {
                this.proxies.push(proxy);
            } else {
                console.log(`unknown proxy type`, name);
            }
        }
    }

    public update(renderContext: SourceRenderContext, entityParams: EntityParameters): void {
        for (let i = 0; i < this.proxies.length; i++)
            this.proxies[i].update(this.material.param, renderContext, entityParams);
    }
}

type VKFParamMap = { [k: string]: string };

function buildMaterialProxy(name: string, params: VKFParamMap): MaterialProxy | null {
    if (name === 'equals')
        return new MaterialProxy_Equals(params);
    else if (name === 'add')
        return new MaterialProxy_Add(params);
    else if (name === 'subtract')
        return new MaterialProxy_Subtract(params);
    else if (name === 'multiply')
        return new MaterialProxy_Multiply(params);
    else if (name === 'clamp')
        return new MaterialProxy_Clamp(params);
    else if (name === 'sine')
        return new MaterialProxy_Sine(params);
    else if (name === 'texturescroll')
        return new MaterialProxy_TextureScroll(params);
    else if (name === 'playerproximity')
        return new MaterialProxy_PlayerProximity(params);
    else if (name === 'gaussiannoise')
        return new MaterialProxy_GaussianNoise(params);
    else
        return null;
}

interface MaterialProxy {
    update(paramsMap: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityParameters): void;
}

class MaterialProxy_Equals {
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

class MaterialProxy_Sine {
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

class MaterialProxy_GaussianNoise {
    private resultvar: ParameterReference;
    private minval: ParameterReference;
    private maxval: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.minval = new ParameterReference(params.minval);
        this.maxval = new ParameterReference(params.maxval);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityParameters): void {
        // TODO(jstpierre): Proper Gaussian noise.
        const r = lerp(paramGetNum(map, this.minval), paramGetNum(map, this.maxval), Math.random());
        paramSetNum(map, this.resultvar, r);
    }
}

class MaterialProxy_TextureScroll {
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
    private resultvar: ParameterReference;
    private scale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.scale = new ParameterReference(params.scale);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityParameters): void {
        const scale = paramGetNum(map, this.scale);
        const dist = vec3.distance(renderContext.cameraPos, entityParams.position);
        paramSetNum(map, this.resultvar, dist * scale);
    }
}
//#endregion
