
import { DeviceProgram } from "../Program";
import { VMT, parseVMT, vmtParseVector, VKFParamMap } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3, ReadonlyMat4, ReadonlyVec3, vec2 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v, fillMatrix4x2, fillColor, fillVec3v, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { VTF } from "./VTF";
import { SourceRenderContext, SourceFileSystem, SourceEngineView } from "./Main";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { SurfaceLightmapData, LightmapPackerManager, LightmapPackerPage, Cubemap, BSPFile, AmbientCube, WorldLight, WorldLightType, BSPLeaf, WorldLightFlags } from "./BSPFile";
import { MathConstants, invlerp, lerp, clamp, Vec3Zero, Vec3UnitX, Vec3NegX, Vec3UnitY, Vec3NegY, Vec3UnitZ, Vec3NegZ, scaleMatrix } from "../MathHelpers";
import { colorNewCopy, White, Color, colorCopy, colorScaleAndAdd, colorFromRGBA, colorNewFromRGBA, TransparentBlack, colorScale, OpaqueBlack } from "../Color";
import { AABB } from "../Geometry";
import { drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";
import { IS_DEPTH_REVERSED } from "../gfx/helpers/ReversedDepthHelpers";

//#region Base Classes
const scratchColor = colorNewCopy(White);

export const enum StaticLightingMode {
    None,
    StudioVertexLighting,
    StudioAmbientCube,
}

export const enum SkinningMode {
    None,
    Rigid,
    Smooth,
};

export const enum LateBindingTexture {
    FramebufferColor = `framebuffer-color`,
    FramebufferDepth = `framebuffer-depth`,
    WaterReflection  = `water-reflection`,
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

export class MaterialProgramBase extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TangentS = 2;
    public static a_TexCoord = 3;
    public static a_Color = 4;
    public static a_StaticVertexLighting = 5;
    public static a_BoneWeights = 6;
    public static a_BoneIDs = 7;

    public static ub_SceneParams = 0;

    public Common = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
    vec4 u_FogColor;
    vec4 u_FogParams;
    vec4 u_ClipPlaneWorld[1];
};

#define u_FogStart      (u_FogParams.x)
#define u_FogEnd        (u_FogParams.y)
#define u_FogMaxDensity (u_FogParams.z)

// Utilities.
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}

vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

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
    return t_NormalMapSample * 2.0 - 1.0;
}

// For vertex colors and other places without native sRGB data.
vec3 GammaToLinear(in vec3 t_Color) {
    return pow(t_Color, vec3(2.2));
}

void CalcFog(inout vec4 t_Color, in vec3 t_PositionWorld) {
#ifdef USE_FOG
    float t_DistanceWorld = distance(t_PositionWorld.xyz, u_CameraPosWorld.xyz);
    float t_FogFactor = saturate(invlerp(u_FogStart, u_FogEnd, t_DistanceWorld));
    t_FogFactor = min(t_FogFactor, u_FogMaxDensity);

    // Square the fog factor to better approximate fixed-function HW (which happens all in clip space)
    t_FogFactor *= t_FogFactor;

    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, t_FogFactor);
#endif
}

#ifdef FRAG
layout(location = 0) out vec4 o_Color0;

void OutputLinearColor(in vec4 t_Color) {
    // We do gamma correction in post now, as we need linear blending.
    o_Color0.rgba = t_Color.rgba;
}
#endif
`;
}

function fillFogParams(d: Float32Array, offs: number, params: Readonly<FogParams>): number {
    const baseOffs = offs;
    offs += fillGammaColor(d, offs, params.color);
    offs += fillVec4(d, offs, params.start, params.end, params.maxdensity);
    return offs - baseOffs;
}

function fillSceneParams(d: Float32Array, offs: number, view: Readonly<SourceEngineView>, fogParams: Readonly<FogParams>): number {
    const baseOffs = offs;
    offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);
    offs += fillVec3v(d, offs, view.cameraPos);
    offs += fillFogParams(d, offs, fogParams);
    for (let i = 0; i < 1; i++) {
        const clipPlaneWorld = view.clipPlaneWorld[i];
        if (clipPlaneWorld)
            offs += fillVec4v(d, offs, view.clipPlaneWorld[i]);
        else
            offs += fillVec4(d, offs, 0, 0, 0, 0);
    }
    return offs - baseOffs;
}

export function fillSceneParamsOnRenderInst(renderInst: GfxRenderInst, view: Readonly<SourceEngineView>, fogParams: Readonly<FogParams> = view.fogParams): void {
    let offs = renderInst.allocateUniformBuffer(MaterialProgramBase.ub_SceneParams, 32);
    const d = renderInst.mapUniformBufferF32(MaterialProgramBase.ub_SceneParams);
    fillSceneParams(d, offs, view, fogParams);
}

interface Parameter {
    parse(S: string): void;
    index(i: number): Parameter;
    set(param: Parameter): void;
}

class ParameterTexture {
    public ref: string | null = null;
    public texture: VTF | null = null;

    constructor(public isSRGB: boolean = false, public isEnvmap: boolean = false) {
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
                if (filename === 'env_cubemap' && entityParams !== null && entityParams.lightCache !== null)
                    filename = entityParams.lightCache.envCubemap.filename;
                else if (materialCache.isUsingHDR())
                    filename = `${filename}.hdr`;
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
    public value: string = '';

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

const scratchMatrix = mat4.create();
class ParameterMatrix {
    public matrix = mat4.create();

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
    protected internal: ParameterNumber[];

    constructor(length: number) {
        this.internal = nArray(length, () => new ParameterNumber(0));
    }

    public parse(S: string): void {
        const numbers = vmtParseVector(S);
        if (this.internal.length !== 0)
            assert(numbers.length === this.internal.length || numbers.length === 1);
        else
            this.internal.length = numbers.length;

        for (let i = 0; i < this.internal.length; i++)
            this.internal[i] = new ParameterNumber(i > numbers.length - 1 ? numbers[0] : numbers[i]);
    }

    public index(i: number): ParameterNumber {
        return this.internal[i];
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
}

const enum AlphaBlendMode {
    None, Blend, Add, BlendAdd,
}

function colorGammaToLinear(c: Color, src: Color): void {
    c.r = gammaToLinear(src.r);
    c.g = gammaToLinear(src.g);
    c.b = gammaToLinear(src.b);
    c.a = src.a;
}

function fillGammaColor(d: Float32Array, offs: number, c: Color): number {
    colorGammaToLinear(scratchColor, c);
    return fillColor(d, offs, scratchColor);
}

const blackFogParams = new FogParams(TransparentBlack);

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

    protected loaded = false;
    protected proxyDriver: MaterialProxyDriver | null = null;
    protected representativeTexture: VTF | null = null;
    protected texCoord0Scale = vec2.create();
    protected isAdditive = false;

    constructor(public vmt: VMT) {
    }

    public async init(renderContext: SourceRenderContext) {
        this.initParameters();

        this.setupParametersFromVMT(renderContext);
        if (this.vmt.proxies !== undefined)
            this.proxyDriver = renderContext.materialProxySystem.createProxyDriver(this, this.vmt.proxies);

        this.initStaticBeforeResourceFetch();
        await this.fetchResources(renderContext.materialCache);
        this.initStatic(renderContext.device, renderContext.renderCache);
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

        return true;
    }

    public setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        // Nothing by default.
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

    protected paramFillScaleBias(d: Float32Array, offs: number, name: string, useMappingTransform: boolean = true): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        // Make sure there's no rotation. We should definitely handle this eventually, though.
        assert(m[1] === 0.0 && m[2] === 0.0);
        let scaleS = m[0];
        let scaleT = m[5];
        if (useMappingTransform) {
            scaleS *= this.texCoord0Scale[0];
            scaleT *= this.texCoord0Scale[1];
        }
        const transS = m[12];
        const transT = m[13];
        return fillVec4(d, offs, scaleS, scaleT, transS, transT);
    }

    protected paramFillTextureMatrix(d: Float32Array, offs: number, name: string, useMappingTransform: boolean = true): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        if (useMappingTransform) {
            scaleMatrix(scratchMatrix, m, this.texCoord0Scale[0], this.texCoord0Scale[1]);
            return fillMatrix4x2(d, offs, scratchMatrix);
        } else {
            return fillMatrix4x2(d, offs, m);
        }
    }

    protected paramFillGammaColor(d: Float32Array, offs: number, name: string, alphaname: string | null = null): number {
        const alpha = alphaname !== null ? this.paramGetNumber(alphaname) : 1.0;
        this.paramGetVector(name).fillColor(scratchColor, alpha);
        return fillGammaColor(d, offs, scratchColor);
    }

    protected paramFillColor(d: Float32Array, offs: number, name: string, alphaname: string | null = null): number {
        const alpha = alphaname !== null ? this.paramGetNumber(alphaname) : 1.0;
        this.paramGetVector(name).fillColor(scratchColor, alpha);
        return fillColor(d, offs, scratchColor);
    }

    protected vtfIsIndirect(vtf: VTF): boolean {
        return vtf.lateBinding === LateBindingTexture.FramebufferColor;
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

    protected setCullMode(megaStateFlags: Partial<GfxMegaStateDescriptor>): void {
        megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.paramGetBoolean('$nocull'))
            megaStateFlags.cullMode = GfxCullMode.None;
    }

    protected setAlphaBlendMode(megaStateFlags: Partial<GfxMegaStateDescriptor>, alphaBlendMode: AlphaBlendMode): boolean {
        if (alphaBlendMode === AlphaBlendMode.BlendAdd) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.Blend) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.Add) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.One,
            });
            megaStateFlags.depthWrite = false;
            this.isAdditive = true;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.None) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero,
            });
            megaStateFlags.depthWrite = true;
            return false;
        } else {
            throw "whoops";
        }
    }

    protected getAlphaBlendMode(isTextureTranslucent: boolean): AlphaBlendMode {
        let isTranslucent = isTextureTranslucent;

        if (this.paramGetBoolean('$vertexalpha'))
            isTranslucent = true;

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
        p['$nofog']                        = new ParameterBoolean(false, false);
        p['$decal']                        = new ParameterBoolean(false, false);

        // Base parameters
        p['$basetexture']                  = new ParameterTexture(true);
        p['$basetexturetransform']         = new ParameterMatrix();
        p['$frame']                        = new ParameterNumber(0);
        p['$color']                        = new ParameterColor(1, 1, 1);
        p['$color2']                       = new ParameterColor(1, 1, 1);
        p['$alpha']                        = new ParameterNumber(1);
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
        if (this.representativeTexture === null)
            this.representativeTexture = this.calcRepresentativeTexture();

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

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
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

    protected setupFogParams(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        if (this.isAdditive) {
            // We need to swap out the fog for additive materials, so allocate a new scene params...
            fillSceneParamsOnRenderInst(renderInst, renderContext.currentView, blackFogParams);
        }
    }

    public abstract setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null, lightmapPageIndex?: number): void;

    public setOnRenderInstSkinningParams(renderInst: GfxRenderInst, boneMatrix: ReadonlyMat4[], bonePaletteTable: number[]): void {
        // Nothing by default.
    }

    public getRenderInstListForView(view: SourceEngineView): GfxRenderInstList {
        // Choose the right list.
        if (this.isIndirect)
            return view.indirectList;

        return view.mainList;
    }
}
//#endregion

//#region Generic (LightmappedGeneric, UnlitGeneric, VertexLightingGeneric, WorldVertexTransition)
const enum ShaderWorldLightType {
    None, Point, Spot, Directional,
}

class Material_Generic_Program extends MaterialProgramBase {
    public static ub_ObjectParams = 1;
    public static ub_SkinningParams = 2;

    public static MaxDynamicWorldLights = 4;
    public static MaxSkinningParamsBoneMatrix = 53;

    public both = `
precision mediump float;

${this.Common}

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
#if SKINNING_MODE == ${SkinningMode.None}
    Mat4x3 u_ModelMatrix;
#endif

#ifdef USE_AMBIENT_CUBE
    // TODO(jstpierre): Pack this more efficiently?
    vec4 u_AmbientCube[6];
#endif
#ifdef USE_DYNAMIC_LIGHTING
    // We support up to N lights.
    WorldLight u_WorldLights[${Material_Generic_Program.MaxDynamicWorldLights}];
#endif
    Mat4x2 u_BaseTextureTransform;
#ifdef USE_BUMPMAP
    Mat4x2 u_BumpmapTransform;
#endif
#ifdef USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#ifdef USE_BLEND_MODULATE
    vec4 u_BlendModulateScaleBias;
#endif
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
#ifdef USE_SELFILLUM
    vec4 u_SelfIllumTint;
#endif
#ifdef USE_PHONG
    vec4 u_FresnelRangeSpecBoost;
#endif
    vec4 u_ModulationColor;
    vec4 u_Misc[1];
};

#define u_AlphaTestReference (u_Misc[0].x)
#define u_DetailBlendFactor  (u_Misc[0].y)
#define u_DetailScale        (u_Misc[0].z)

#if SKINNING_MODE != ${SkinningMode.None}
layout(std140) uniform ub_SkinningParams {
#if SKINNING_MODE == ${SkinningMode.Rigid}
    Mat4x3 u_ModelMatrix;
#elif SKINNING_MODE == ${SkinningMode.Smooth}
    Mat4x3 u_BoneMatrix[${Material_Generic_Program.MaxSkinningParamsBoneMatrix}];
#endif
};
#endif

#define HAS_FULL_TANGENTSPACE (USE_BUMPMAP)

// Base, Bumpmap
varying vec4 v_TexCoord0;
// Lightmap (0), Envmap Mask
varying vec4 v_TexCoord1;
// Blend Modulate
varying vec4 v_TexCoord2;

// w contains BaseTexture2 blend factor.
varying vec4 v_PositionWorld;
varying vec4 v_Color;
varying vec3 v_DiffuseLighting;

#ifdef HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;
#ifdef USE_BUMPMAP
varying float v_LightmapOffset;
#endif
#ifdef USE_DYNAMIC_PIXEL_LIGHTING
varying vec4 v_LightAtten;
#endif

// Base, Detail, Bumpmap, Lightmap, Envmap Mask, BaseTexture2, SpecularExponent, SelfIllum, BlendModulate
uniform sampler2D u_TextureBase;
uniform sampler2D u_TextureDetail;
uniform sampler2D u_TextureBumpmap;
uniform sampler2D u_TextureLightmap;
uniform sampler2D u_TextureEnvmapMask;
uniform sampler2D u_TextureBase2;
uniform sampler2D u_TextureSpecularExponent;
uniform sampler2D u_TextureSelfIllum;
uniform sampler2D u_TextureBlendModulate;
// Envmap
uniform samplerCube u_TextureEnvmap;

// #define DEBUG_DIFFUSEONLY 1
// #define DEBUG_FULLBRIGHT 1

float ApplyAttenuation(vec3 t_Coeff, float t_Value) {
    return dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value));
}

#ifdef USE_DYNAMIC_LIGHTING
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
            float t_CosAngle = dot(t_WorldLight.Direction.xyz, -t_LightDirectionWorld);

            // invlerp
            float t_AngleAttenuation = max((t_CosAngle - t_Stopdot2) / (t_Stopdot - t_Stopdot2), 0.01);
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

vec4 WorldLightCalcAllAttenuation(in vec3 t_PositionWorld) {
    vec4 t_FinalAtten = vec4(0.0);
    for (int i = 0; i < ${Material_Generic_Program.MaxDynamicWorldLights}; i++)
        t_FinalAtten[i] = WorldLightCalcAttenuation(u_WorldLights[i], t_PositionWorld);
    return t_FinalAtten;
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

struct DiffuseLightInput {
    vec3 PositionWorld;
    vec3 NormalWorld;
    vec4 LightAttenuation;
    bool HalfLambert;
};

vec3 WorldLightCalcAllDiffuse(in DiffuseLightInput t_DiffuseLightInput) {
#ifdef DEBUG_FULLBRIGHT
    return vec3(0.0);
#else
    vec3 t_FinalLight = vec3(0.0);
    for (int i = 0; i < ${Material_Generic_Program.MaxDynamicWorldLights}; i++)
        t_FinalLight += WorldLightCalcDiffuse(t_DiffuseLightInput.PositionWorld, t_DiffuseLightInput.NormalWorld, t_DiffuseLightInput.HalfLambert, t_DiffuseLightInput.LightAttenuation[i], u_WorldLights[i]);
    return t_FinalLight;
#endif
}
#endif

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;
#ifdef USE_VERTEX_COLOR
layout(location = ${MaterialProgramBase.a_Color}) attribute vec4 a_Color;
#endif
#ifdef USE_STATIC_VERTEX_LIGHTING
layout(location = ${MaterialProgramBase.a_StaticVertexLighting}) attribute vec3 a_StaticVertexLighting;
#endif
#if SKINNING_MODE == ${SkinningMode.Smooth}
layout(location = ${MaterialProgramBase.a_BoneWeights}) attribute vec4 a_BoneWeights;
layout(location = ${MaterialProgramBase.a_BoneIDs}) attribute vec4 a_BoneIndices;
#endif

#ifdef USE_AMBIENT_CUBE
vec3 AmbientLight(in vec3 t_NormalWorld) {
#ifdef DEBUG_FULLBRIGHT
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

Mat4x3 WorldFromLocalMatrixCalc() {
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

void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = WorldFromLocalMatrixCalc();

    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Normal.xyz, 0.0));

#ifdef USE_VERTEX_COLOR
    v_Color = a_Color;
#else
    v_Color = vec4(1.0);
#endif

    v_DiffuseLighting.rgb = vec3(1.0);

#ifdef USE_STATIC_VERTEX_LIGHTING
    // Static vertex lighting should already include ambient lighting.
    // 2.0 here is overbright.
    v_DiffuseLighting.rgb = GammaToLinear(a_StaticVertexLighting) * 2.0;
#endif

// Mutually exclusive with above.
#ifdef USE_AMBIENT_CUBE
    v_DiffuseLighting.rgb = AmbientLight(t_NormalWorld);
#endif

#ifdef USE_DYNAMIC_LIGHTING
    vec4 t_LightAtten = WorldLightCalcAllAttenuation(t_PositionWorld.xyz);
#endif

#ifdef USE_DYNAMIC_VERTEX_LIGHTING
    bool t_HalfLambert = false;
#ifdef USE_HALF_LAMBERT
    t_HalfLambert = true;
#endif

    DiffuseLightInput t_DiffuseLightInput;
    t_DiffuseLightInput.PositionWorld = t_PositionWorld.xyz;
    t_DiffuseLightInput.NormalWorld = t_NormalWorld.xyz;
    t_DiffuseLightInput.LightAttenuation = t_LightAtten.xyzw;
    t_DiffuseLightInput.HalfLambert = t_HalfLambert;
    vec3 t_DiffuseLighting = WorldLightCalcAllDiffuse(t_DiffuseLightInput);
    v_DiffuseLighting.rgb += t_DiffuseLighting;
#endif

#ifdef USE_DYNAMIC_PIXEL_LIGHTING
    v_LightAtten.xyzw = t_LightAtten;
#endif

// TODO(jstpierre): Move ModulationColor to PS, support $blendtintbybasealpha and $blendtintcoloroverbase
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
    vec3 t_TangentSWorld = Mul(t_WorldFromLocalMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * sign(a_TangentS.w);
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = Mul(u_BaseTextureTransform, vec4(a_TexCoord.xy, 1.0, 0.0));
#ifdef USE_BUMPMAP
    v_LightmapOffset = abs(a_TangentS.w);
    v_TexCoord0.zw = Mul(u_BumpmapTransform, vec4(a_TexCoord.xy, 1.0, 0.0));
#endif
#ifdef USE_LIGHTMAP
    v_TexCoord1.xy = a_TexCoord.zw;
#endif
#ifdef USE_ENVMAP_MASK
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord.xy, u_EnvmapMaskScaleBias);
#endif
#ifdef USE_BLEND_MODULATE
    v_TexCoord2.xy = CalcScaleBias(a_TexCoord.xy, u_BlendModulateScaleBias);
#endif
}
#endif

#ifdef FRAG

#define COMBINE_MODE_MUL_DETAIL2                             (0)
#define COMBINE_MODE_RGB_ADDITIVE                            (1)
#define COMBINE_MODE_DETAIL_OVER_BASE                        (2)
#define COMBINE_MODE_FADE                                    (3)
#define COMBINE_MODE_BASE_OVER_DETAIL                        (4)
#define COMBINE_MODE_RGB_ADDITIVE_SELFILLUM                  (5)
#define COMBINE_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE   (6)
#define COMBINE_MODE_MOD2X_SELECT_TWO_PATTERNS               (7)
#define COMBINE_MODE_SSBUMP_BUMP                             (10)

vec4 TextureCombine(in vec4 t_BaseTexture, in vec4 t_DetailTexture, in int t_CombineMode, in float t_BlendFactor) {
    if (t_CombineMode == COMBINE_MODE_MUL_DETAIL2) {
        return t_BaseTexture * mix(vec4(1.0), t_DetailTexture * 2.0, t_BlendFactor);
    } else if (t_CombineMode == COMBINE_MODE_RGB_ADDITIVE) {
        return t_BaseTexture + t_DetailTexture * t_BlendFactor;
    } else if (t_CombineMode == COMBINE_MODE_BASE_OVER_DETAIL) {
        return vec4(mix(t_BaseTexture.rgb, t_DetailTexture.rgb, (t_BlendFactor * (1.0 - t_BaseTexture.a))), t_DetailTexture.a);
    } else if (t_CombineMode == COMBINE_MODE_MOD2X_SELECT_TWO_PATTERNS) {
        vec4 t_DetailPattern = vec4(mix(t_DetailTexture.r, t_DetailTexture.a, t_BaseTexture.a));
        return t_BaseTexture * mix(vec4(1.0), t_DetailPattern * 2.0, t_BlendFactor);
    } else if (t_CombineMode == COMBINE_MODE_RGB_ADDITIVE_SELFILLUM || t_CombineMode == COMBINE_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Done in Post-Lighting.
        return t_BaseTexture;
    } else if (t_CombineMode == COMBINE_MODE_SSBUMP_BUMP) {
        // Done as part of bumpmapping.
        return t_BaseTexture;
    } else {
        // Unknown.
        return t_BaseTexture + vec4(1.0, 0.0, 1.0, 0.0);
    }
}

vec3 TextureCombinePostLighting(in vec3 t_DiffuseColor, in vec3 t_DetailTexture, in int t_CombineMode, in float t_BlendFactor) {
    if (t_CombineMode == COMBINE_MODE_RGB_ADDITIVE_SELFILLUM) {
        return t_DiffuseColor.rgb + t_DetailTexture.rgb * t_BlendFactor;
    } else if (t_CombineMode == COMBINE_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Remap.
        if (t_BlendFactor >= 0.5) {
            float t_Mult = (1.0 / t_BlendFactor);
            return t_DiffuseColor.rgb + clamp((t_Mult * t_DetailTexture.rgb) + (1.0 - t_Mult), 0.0, 1.0);
        } else {
            float t_Mult = (4.0 * t_BlendFactor);
            return t_DiffuseColor.rgb + clamp((t_Mult * t_DetailTexture.rgb) + (-0.5 * t_Mult), 0.0, 1.0);
        }
    } else {
        // Nothing to do.
        return t_DiffuseColor.rgb;
    }
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 0.8660254037844386,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

#ifdef USE_DYNAMIC_PIXEL_LIGHTING
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

    const bool t_HalfLambert = false;
    float t_NoL = saturate(dot(t_Input.NormalWorld, t_LightDirectionWorld));
    float t_RoL = saturate(dot(t_Reflect, t_LightDirectionWorld));

    SpecularLightResult t_Result = SpecularLightResult_New();

    float t_Attenuation = WorldLightCalcAttenuation(t_WorldLight, t_Input.PositionWorld);

    t_Result.SpecularLight += vec3(pow(t_RoL, t_Input.SpecularExponent));
    // TODO(jstpierre): Specular Warp
    t_Result.SpecularLight *= t_NoL * t_WorldLight.Color.rgb * t_Attenuation;

    t_Result.RimLight += vec3(pow(t_RoL, t_Input.RimExponent));
    t_Result.RimLight *= t_NoL * t_WorldLight.Color.rgb * t_Attenuation;

    return t_Result;
}

SpecularLightResult WorldLightCalcAllSpecular(in SpecularLightInput t_Input) {
    SpecularLightResult t_FinalLight = SpecularLightResult_New();
    for (int i = 0; i < ${Material_Generic_Program.MaxDynamicWorldLights}; i++)
        SpecularLightResult_Sum(t_FinalLight, WorldLightCalcSpecular(t_Input, u_WorldLights[i]));
    return t_FinalLight;
}

#endif

vec4 DebugColorTexture(vec4 t_TextureSample) {
#ifdef DEBUG_DIFFUSEONLY
    t_TextureSample.rgb = vec3(0.5);
#endif
    return t_TextureSample;
}

vec4 DebugLightmapTexture(vec4 t_TextureSample) {
#ifdef DEBUG_FULLBRIGHT
    // A "fullbright" lightmap is 0x80 sRGB (because of overbright). Convert to linear.
    t_TextureSample.rgb = GammaToLinear(vec3(0.5));
#endif
    return t_TextureSample;
}

bool CheckClipPlanes(vec3 t_PositionWorld) {
#ifdef USE_CLIP_PLANES
    // TODO(jstpierre): Optimize this if we have hardware clip plane in vertex shader (GL extension?)
    for (int i = 0; i < 1; i++) {
        if (dot(u_ClipPlaneWorld[i].xyz, t_PositionWorld.xyz) + u_ClipPlaneWorld[i].w < 0.0)
            return false;
    }
#endif

    return true;
}

void mainPS() {
    if (!CheckClipPlanes(v_PositionWorld.xyz)) {
        discard;
        return;
    }

    vec4 t_Albedo, t_BlendedAlpha;

    vec4 t_BaseTexture = DebugColorTexture(texture(SAMPLER_2D(u_TextureBase), v_TexCoord0.xy));

#ifdef USE_BASETEXTURE2
    // Blend in BaseTexture2 using blend factor.
    float t_BlendFactor = v_PositionWorld.w;

#ifdef USE_BLEND_MODULATE
    vec4 t_BlendModulateSample = texture(SAMPLER_2D(u_TextureBlendModulate), v_TexCoord2.xy);
    float t_BlendModulateMin = t_BlendModulateSample.g - t_BlendModulateSample.r;
    float t_BlendModulateMax = t_BlendModulateSample.g + t_BlendModulateSample.r;
    t_BlendFactor = smoothstep(t_BlendModulateMin, t_BlendModulateMax, t_BlendFactor);
#endif

    vec4 t_BaseTexture2 = DebugColorTexture(texture(SAMPLER_2D(u_TextureBase2), v_TexCoord0.xy));
    t_Albedo = mix(t_BaseTexture, t_BaseTexture2, t_BlendFactor);
#else
    t_Albedo = t_BaseTexture;
#endif

#ifdef USE_DETAIL
    vec2 t_DetailTexCoord = v_TexCoord0.xy * u_DetailScale;
    vec4 t_DetailTexture = DebugColorTexture(texture(SAMPLER_2D(u_TextureDetail, t_DetailTexCoord)));
    t_Albedo = TextureCombine(t_Albedo, t_DetailTexture, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;
#ifdef USE_BUMPMAP
    vec4 t_BumpmapSample = texture(SAMPLER_2D(u_TextureBumpmap, v_TexCoord0.zw));

#ifdef USE_SSBUMP
    // In SSBUMP, the bumpmap is pre-convolved with the basis. Compute the normal by re-applying our basis.
    vec3 t_BumpmapNormal = normalize(g_RNBasis0*t_BumpmapSample.x + g_RNBasis1*t_BumpmapSample.y + g_RNBasis2*t_BumpmapSample.z);
#else
    // In non-SSBUMP, this is a traditional normal map with signed offsets.
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample).rgb;
#endif

    // Transform from tangent space into world-space.
    t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
#else
    t_NormalWorld = v_TangentSpaceBasis2;
#endif

    vec3 t_DiffuseLighting = vec3(0.0);

    vec3 t_DeferredLightmapOutput = vec3(0.0);

#ifdef USE_LIGHTMAP
    vec3 t_DiffuseLightingScale = u_ModulationColor.xyz;

    vec3 t_LightmapColor0 = DebugLightmapTexture(texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord1.xy)).rgb;
#ifdef USE_DIFFUSE_BUMPMAP
    vec3 t_LightmapColor1 = DebugLightmapTexture(texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord1.xy + vec2(0.0, v_LightmapOffset * 1.0))).rgb;
    vec3 t_LightmapColor2 = DebugLightmapTexture(texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord1.xy + vec2(0.0, v_LightmapOffset * 2.0))).rgb;
    vec3 t_LightmapColor3 = DebugLightmapTexture(texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord1.xy + vec2(0.0, v_LightmapOffset * 3.0))).rgb;

    vec3 t_Influence;

#ifdef USE_SSBUMP
    // SSBUMP precomputes the elements of t_Influence (calculated below) offline.
    t_Influence = t_BumpmapSample.rgb;

#ifdef USE_DETAIL
    if (DETAIL_COMBINE_MODE == COMBINE_MODE_SSBUMP_BUMP) {
        t_Influence.xyz *= mix(vec3(1.0), 2.0 * t_DetailTexture.rgb, t_BaseTexture.a);
        t_Albedo.a = 1.0; // Reset alpha
    }
#endif
#else
    t_Influence.x = clamp(dot(t_BumpmapNormal, g_RNBasis0), 0.0, 1.0);
    t_Influence.y = clamp(dot(t_BumpmapNormal, g_RNBasis1), 0.0, 1.0);
    t_Influence.z = clamp(dot(t_BumpmapNormal, g_RNBasis2), 0.0, 1.0);

#ifdef USE_DETAIL
    if (DETAIL_COMBINE_MODE == COMBINE_MODE_SSBUMP_BUMP) {
        t_Influence.xyz *= t_DetailTexture.rgb * 2.0;
    }
#endif

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
    t_DiffuseLighting.rgb = t_LightmapColor0;
#endif

    t_DiffuseLighting.rgb = t_DiffuseLighting.rgb * t_DiffuseLightingScale;

    // Decals can't get bumpmapping, I don't believe...
    t_DeferredLightmapOutput.rgb = t_LightmapColor0.rgb;
#else
    // Diffuse lighting comes from vertex shader.
    t_DiffuseLighting.rgb = v_DiffuseLighting.rgb;
#endif

    t_Albedo *= v_Color;

#ifdef USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

#ifdef USE_DYNAMIC_PIXEL_LIGHTING
    bool t_HalfLambert = false;
#ifdef USE_HALF_LAMBERT
    t_HalfLambert = true;
#endif

#ifdef USE_PHONG
    // Skin shader forces half-lambert on.
    t_HalfLambert = true;
#endif

    // TODO(jstpierre): Add in ambient cube? Or is that in the vertex color already...
    DiffuseLightInput t_DiffuseLightInput;
    t_DiffuseLightInput.PositionWorld = v_PositionWorld.xyz;
    t_DiffuseLightInput.NormalWorld = t_NormalWorld.xyz;
    t_DiffuseLightInput.LightAttenuation = v_LightAtten.xyzw;
    t_DiffuseLightInput.HalfLambert = t_HalfLambert;
    t_DiffuseLighting.rgb *= WorldLightCalcAllDiffuse(t_DiffuseLightInput);
#endif

    vec3 t_FinalDiffuse = t_DiffuseLighting * t_Albedo.rgb;

#ifdef USE_DETAIL
    t_FinalDiffuse = TextureCombinePostLighting(t_FinalDiffuse, t_DetailTexture.rgb, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#endif

#ifdef USE_SELFILLUM
    vec3 t_SelfIllumMask;

#ifdef USE_SELFILLUM_ENVMAPMASK_ALPHA
    // TODO(jstpierre): Implement this
    t_SelfIllumMask = vec3(0);
#else
#ifdef USE_SELFILLUM_MASK
    t_SelfIllumMask = texture(SAMPLER_2D(u_TextureSelfIllum), v_TexCoord1.xy).rgb;
#else
    t_SelfIllumMask = t_BaseTexture.aaa;
#endif
#endif

    t_FinalDiffuse.rgb = mix(t_FinalDiffuse.rgb, u_SelfIllumTint.rgb * t_Albedo.rgb, t_SelfIllumMask.rgb);
#endif

    t_FinalColor.rgb += t_FinalDiffuse;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    vec3 t_SpecularLighting = vec3(0.0);

    float t_Fresnel;
    float t_FresnelDot = dot(t_NormalWorld, t_WorldDirectionToEye);
#ifdef USE_PHONG
    t_Fresnel = CalcFresnelTerm2Ranges(t_FresnelDot, u_FresnelRangeSpecBoost.xyz);
#else
    t_Fresnel = CalcFresnelTerm5(t_FresnelDot);
#endif

#ifdef USE_ENVMAP
    vec3 t_EnvmapFactor = u_EnvmapTint.rgb;

#ifdef USE_ENVMAP_MASK
    t_EnvmapFactor *= texture(SAMPLER_2D(u_TextureEnvmapMask), v_TexCoord1.zw).rgb;
#endif

#ifdef USE_NORMALMAP_ALPHA_ENVMAP_MASK
    t_EnvmapFactor *= t_BumpmapSample.a;
#endif
#ifdef USE_BASE_ALPHA_ENVMAP_MASK
    t_EnvmapFactor *= 1.0 - t_BaseTexture.a;
#endif

    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec3 t_EnvmapColor = texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgb;
    t_EnvmapColor *= t_EnvmapFactor;

    // TODO(jstpierre): Double-check all of this with Phong. I don't think it's 100% right...

    t_EnvmapColor = mix(t_EnvmapColor, t_EnvmapColor*t_EnvmapColor, u_EnvmapContrastSaturationFresnel.x);
    t_EnvmapColor = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_EnvmapColor)), t_EnvmapColor, u_EnvmapContrastSaturationFresnel.y);
    t_EnvmapColor *= mix(t_Fresnel, 1.0, u_EnvmapContrastSaturationFresnel.z);

    t_SpecularLighting.rgb += t_EnvmapColor.rgb;
#endif

#ifdef USE_PHONG
#ifdef USE_DYNAMIC_PIXEL_LIGHTING
    SpecularLightInput t_SpecularLightInput;
    t_SpecularLightInput.PositionWorld = v_PositionWorld.xyz;
    t_SpecularLightInput.NormalWorld = t_NormalWorld;
    t_SpecularLightInput.WorldDirectionToEye = t_WorldDirectionToEye;
    t_SpecularLightInput.Fresnel = t_Fresnel;

    // TODO(jstpierre): Support $phongexponentfactor override
    vec4 t_SpecularMapSample = texture(SAMPLER_2D(u_TextureSpecularExponent), v_TexCoord0.xy);
    t_SpecularLightInput.SpecularExponent = mix(1.0, 150.0, t_SpecularMapSample.r);
    t_SpecularLightInput.RimExponent = 1.0;

    // Specular mask is either in base map or normal map alpha.
    float t_SpecularMask;
#ifdef USE_BASE_ALPHA_PHONG_MASK
    t_SpecularMask = t_BaseTexture.a;
#else
#ifdef USE_BUMPMAP
    t_SpecularMask = t_BumpmapSample.a;
#else
    t_SpecularMask = 1.0;
#endif
#endif

#ifdef USE_PHONG_MASK_INVERT
    t_SpecularMask = 1.0 - t_SpecularMask;
#endif

    SpecularLightResult t_SpecularLightResult = WorldLightCalcAllSpecular(t_SpecularLightInput);

    t_SpecularLighting.rgb += t_SpecularLightResult.SpecularLight * t_SpecularMask * u_FresnelRangeSpecBoost.w;
#endif
#endif

    t_FinalColor.rgb += t_SpecularLighting.rgb;

#ifndef USE_BASE_ALPHA_ENVMAP_MASK
    t_FinalColor.a = t_BaseTexture.a;
#endif

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

const enum GenericShaderType {
    LightmappedGeneric, VertexLitGeneric, UnlitGeneric, WorldVertexTransition, Skin, Black, DecalModulate, Unknown,
};

class Material_Generic extends BaseMaterial {
    private wantsDetail = false;
    private wantsBumpmap = false;
    private wantsEnvmapMask = false;
    private wantsBaseTexture2 = false;
    private wantsEnvmap = false;
    private wantsSelfIllum = false;
    private wantsBlendModulate = false;
    private wantsPhong = false;
    private wantsStaticVertexLighting = false;
    private wantsDynamicLighting = false;
    private wantsAmbientCube = false;
    private shaderType: GenericShaderType;

    private program: Material_Generic_Program;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(10, () => new TextureMapping());

    public setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        let wantsDynamicVertexLighting: boolean;
        let wantsDynamicPixelLighting: boolean;

        if (this.shaderType === GenericShaderType.VertexLitGeneric) {
            this.wantsStaticVertexLighting = staticLightingMode === StaticLightingMode.StudioVertexLighting;
            this.wantsAmbientCube = staticLightingMode === StaticLightingMode.StudioAmbientCube;
            wantsDynamicVertexLighting = staticLightingMode === StaticLightingMode.StudioAmbientCube;
            wantsDynamicPixelLighting = false;
        } else if (this.shaderType === GenericShaderType.Skin) {
            this.wantsStaticVertexLighting = false;
            this.wantsAmbientCube = false;
            wantsDynamicVertexLighting = false;
            wantsDynamicPixelLighting = true;
        } else {
            this.wantsStaticVertexLighting = false;
            this.wantsAmbientCube = false;
            wantsDynamicVertexLighting = false;
            wantsDynamicPixelLighting = false;
        }

        this.wantsDynamicLighting = wantsDynamicVertexLighting || wantsDynamicPixelLighting;

        // Ensure that we never have a lightmap at the same time as "studio model" lighting, as they're exclusive...
        if (this.wantsStaticVertexLighting || this.wantsDynamicLighting || this.wantsAmbientCube) {
            assert(!this.wantsLightmap);
        }

        let changed = false;
        changed = this.program.setDefineBool('USE_STATIC_VERTEX_LIGHTING', this.wantsStaticVertexLighting) || changed;
        changed = this.program.setDefineBool('USE_DYNAMIC_VERTEX_LIGHTING', wantsDynamicVertexLighting) || changed;
        changed = this.program.setDefineBool('USE_DYNAMIC_PIXEL_LIGHTING', wantsDynamicPixelLighting) || changed;
        changed = this.program.setDefineBool('USE_DYNAMIC_LIGHTING', this.wantsDynamicLighting) || changed;
        changed = this.program.setDefineBool('USE_AMBIENT_CUBE', this.wantsAmbientCube) || changed;

        if (changed)
            this.gfxProgram = null;
    }

    protected initParameters(): void {
        super.initParameters();

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
        p['$fresnelreflection']            = new ParameterNumber(1);
        p['$detail']                       = new ParameterTexture();
        p['$detailframe']                  = new ParameterNumber(0);
        p['$detailblendmode']              = new ParameterNumber(0, false);
        p['$detailblendfactor']            = new ParameterNumber(1);
        p['$detailtint']                   = new ParameterColor(1, 1, 1);
        p['$detailscale']                  = new ParameterNumber(4);
        p['$bumpmap']                      = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$alphatestreference']           = new ParameterNumber(0.7);
        p['$nodiffusebumplighting']        = new ParameterBoolean(false, false);
        p['$ssbump']                       = new ParameterBoolean(false, false);
        p['$halflambert']                  = new ParameterBoolean(false, false);
        p['$selfillumtint']                = new ParameterColor(1, 1, 1);
        p['$selfillummask']                = new ParameterTexture(false, false);

        // World Vertex Transition
        p['$basetexture2']                 = new ParameterTexture(true);
        p['$frame2']                       = new ParameterNumber(0.0);
        p['$blendmodulatetexture']         = new ParameterTexture(true);
        p['$blendmasktransform']           = new ParameterMatrix();

        // Phong (Skin)
        p['$phong']                        = new ParameterBoolean(false, false);
        p['$phongboost']                   = new ParameterNumber(1.0);
        p['$phongexponenttexture']         = new ParameterTexture(false);
        p['$phongfresnelranges']           = new ParameterVector(3);
        p['$basemapalphaphongmask']        = new ParameterBoolean(false, false);
        p['$invertphongmask']              = new ParameterBoolean(false, false);

        // SolidEnergy (probably doesn't make sense on this..., basically only to get Portal 2 to load...)
        p['$flow_color_intensity']         = new ParameterNumber(0.0);
    }

    private recacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(this.program);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected initStaticBeforeResourceFetch() {
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
        else
            this.shaderType = GenericShaderType.Unknown;

        // The detailBlendMode parameter determines whether we load an SRGB texture or not.
        const detailBlendMode = this.paramGetNumber('$detailblendmode');
        this.paramGetTexture('$detail').isSRGB = (detailBlendMode === 1);

        // decalmodulate doesn't load basetexture as sRGB.
        if (this.shaderType === GenericShaderType.DecalModulate)
            this.paramGetTexture('$basetexture').isSRGB = false;
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        super.initStatic(device, cache);

        this.program = new Material_Generic_Program();

        this.program.setDefineString('SKINNING_MODE', '' + this.skinningMode);

        if (this.shaderType === GenericShaderType.VertexLitGeneric && this.paramGetBoolean('$phong')) {
            // $phong on a vertexlitgeneric tells it to use the Skin shader instead.
            this.shaderType = GenericShaderType.Skin;
            this.wantsPhong = true;
            this.program.setDefineBool('USE_PHONG', true);
        }

        if (this.paramGetVTF('$detail') !== null) {
            this.wantsDetail = true;
            this.program.setDefineBool('USE_DETAIL', true);
            const detailBlendMode = this.paramGetNumber('$detailblendmode');
            this.program.defines.set('DETAIL_COMBINE_MODE', '' + detailBlendMode);
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

        if (this.paramGetBoolean('$selfillum')) {
            this.wantsSelfIllum = true;
            this.program.setDefineBool('USE_SELFILLUM', true);

            if (this.paramGetVTF('$selfillummask')) {
                this.program.setDefineBool('USE_SELFILLUM_MASK', true);
            }
        }

        if (this.shaderType === GenericShaderType.LightmappedGeneric || this.shaderType === GenericShaderType.WorldVertexTransition) {
            this.wantsLightmap = true;
            this.program.setDefineBool('USE_LIGHTMAP', true);
        }

        if (this.shaderType === GenericShaderType.WorldVertexTransition) {
            this.wantsBaseTexture2 = true;
            this.program.setDefineBool('USE_BASETEXTURE2', true);
        }

        if (this.wantsBaseTexture2 && this.paramGetVTF('$blendmodulatetexture') !== null) {
            this.wantsBlendModulate = true;
            this.program.setDefineBool('USE_BLEND_MODULATE', true);
        }
    
        // Modulation color is used differently between lightmapped and non-lightmapped.
        // In vertexlit / unlit, then the modulation color is multiplied in with the texture (and possibly blended).
        // In lightmappedgeneric, then the modulation color is used as the diffuse lightmap scale, and contains the
        // lightmap scale factor.
        // USE_MODULATIONCOLOR_COLOR only handles the vertexlit / unlit case. USE_LIGHTMAP will also use the modulation
        // color if necessary.
        if (this.wantsLightmap) {
            this.program.setDefineBool('USE_MODULATIONCOLOR_COLOR', false);
            // TODO(jstpierre): Figure out if modulation alpha is used in lightmappedgeneric.
            this.program.setDefineBool('USE_MODULATIONCOLOR_ALPHA', false);
        } else {
            this.program.setDefineBool('USE_MODULATIONCOLOR_COLOR', true);
            this.program.setDefineBool('USE_MODULATIONCOLOR_ALPHA', true);
        }

        if (this.hasVertexColorInput && (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha')))
            this.program.setDefineBool('USE_VERTEX_COLOR', true);

        if (this.paramGetBoolean('$basealphaenvmapmask'))
            this.program.setDefineBool('USE_BASE_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$normalmapalphaenvmapmask') && this.wantsBumpmap)
            this.program.setDefineBool('USE_NORMALMAP_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$basemapalphaphongmask'))
            this.program.setDefineBool('USE_BASE_ALPHA_PHONG_MASK', true);

        if (this.paramGetBoolean('$invertphongmask'))
            this.program.setDefineBool('USE_PHONG_MASK_INVERT', true);

        if (this.paramGetBoolean('$ssbump'))
            this.program.setDefineBool('USE_SSBUMP', true);

        if (this.paramGetBoolean('$halflambert'))
            this.program.setDefineBool('USE_HALF_LAMBERT', true);

        if (this.paramGetBoolean('$alphatest')) {
            this.program.setDefineBool('USE_ALPHATEST', true);
        } else if (this.shaderType === GenericShaderType.DecalModulate) {
            this.isTranslucent = true;

            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Dst,
                blendDstFactor: GfxBlendFactor.Src,
            });
            this.megaStateFlags.depthWrite = false;
        } else {
            let isTranslucent = false;

            if (this.textureIsTranslucent('$basetexture'))
                isTranslucent = true;

            this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        }

        if (!this.paramGetBoolean('$nofog'))
            this.program.setDefineBool('USE_FOG', true);

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        this.recacheProgram(cache);
    }

    private updateTextureMappings(renderContext: SourceRenderContext): void {
        const systemTextures = renderContext.materialCache.systemTextures;
        if (!this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'))) {
            // If we don't have a base texture, then it depends on $envmap. With an $envmap, we bind black, otherwise
            // we bind white.
            if (this.wantsEnvmap)
                this.textureMapping[0].gfxTexture = systemTextures.opaqueBlackTexture2D;
            else
                this.textureMapping[0].gfxTexture = systemTextures.whiteTexture2D;
        }

        this.paramGetTexture('$detail').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$detailframe'));
        this.paramGetTexture('$bumpmap').fillTextureMapping(this.textureMapping[2], this.paramGetInt('$bumpframe'));
        // Lightmap is supplied by entity.
        this.paramGetTexture('$envmapmask').fillTextureMapping(this.textureMapping[4], this.paramGetInt('$envmapmaskframe'));
        if (this.wantsBaseTexture2)
            this.paramGetTexture('$basetexture2').fillTextureMapping(this.textureMapping[5], this.paramGetInt('$frame2'));
        this.paramGetTexture('$phongexponenttexture').fillTextureMapping(this.textureMapping[6], 0);
        this.paramGetTexture('$selfillummask').fillTextureMapping(this.textureMapping[7], 0);
        this.paramGetTexture('$blendmodulatetexture').fillTextureMapping(this.textureMapping[8], 0);
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[9], this.paramGetInt('$envmapframe'));
    }

    private fillModelMatrix(d: Float32Array, offs: number, modelMatrix: ReadonlyMat4 | null): number {
        let origOffs = offs;

        // Rigid/smooth skinning do not use the model matrix.
        if (this.skinningMode === SkinningMode.None)
            offs += fillMatrix4x3(d, offs, modelMatrix!);

        return offs - origOffs;
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null, lightmapPageIndex: number | null = null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(renderContext);
        if (this.wantsLightmap)
            renderContext.lightmapManager.fillTextureMapping(this.textureMapping[3], lightmapPageIndex);

        this.setupFogParams(renderContext, renderInst);

        // TODO(jstpierre): The cost of reprocessing shaders every frame toggling between clip planes and not-clip planes is too massive right now...
        // GfxRenderCache happens *post*-preprocess, and the expensive thing appears to be preprocessGLSL.
        const useClipPlanes = true; // renderContext.currentView.clipPlaneWorld.length > 0;
        if (this.program.setDefineBool('USE_CLIP_PLANES', useClipPlanes))
            this.gfxProgram = null;

        let offs = renderInst.allocateUniformBuffer(Material_Generic_Program.ub_ObjectParams, 136);
        const d = renderInst.mapUniformBufferF32(Material_Generic_Program.ub_ObjectParams);
        offs += this.fillModelMatrix(d, offs, modelMatrix);

        if (this.wantsAmbientCube) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillAmbientCube(d, offs);
        }

        if (this.wantsDynamicLighting) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillWorldLights(d, offs, renderContext.worldLightingState);
        }

        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform');

        if (this.wantsBumpmap)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform');

        if (this.wantsEnvmapMask)
            offs += this.paramFillScaleBias(d, offs, '$envmapmasktransform');

        if (this.wantsBlendModulate)
            offs += this.paramFillScaleBias(d, offs, '$blendmasktransform');

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        if (this.wantsSelfIllum)
            offs += this.paramFillGammaColor(d, offs, '$selfillumtint');

        if (this.wantsPhong) {
            const fresnelRanges = this.paramGetVector('$phongfresnelranges');
            const r0 = fresnelRanges.get(0), r1 = fresnelRanges.get(1), r2 = fresnelRanges.get(2);
            offs += fillVec4(d, offs, r0, r1, r2, this.paramGetNumber('$phongboost'));
        }

        // Compute modulation color.
        if (this.shaderType === GenericShaderType.Black) {
            colorCopy(scratchColor, OpaqueBlack);
        } else {
            colorCopy(scratchColor, White);
            this.paramGetVector('$color').mulColor(scratchColor);
            this.paramGetVector('$color2').mulColor(scratchColor);
        }

        if (this.wantsLightmap) {
            const lightMapScale = gammaToLinear(2.0);
            colorScale(scratchColor, scratchColor, lightMapScale);
        }

        scratchColor.a *= this.paramGetNumber('$alpha');
        offs += fillColor(d, offs, scratchColor);

        const alphaTestReference = this.paramGetNumber('$alphatestreference');
        const detailBlendFactor = this.paramGetNumber('$detailblendfactor');
        const detailScale = this.paramGetNumber('$detailscale');
        offs += fillVec4(d, offs, alphaTestReference, detailBlendFactor, detailScale);

        this.recacheProgram(renderContext.renderCache);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public setOnRenderInstSkinningParams(renderInst: GfxRenderInst, boneMatrix: ReadonlyMat4[], bonePaletteTable: number[]): void {
        if (this.skinningMode === SkinningMode.Smooth) {
            assert(bonePaletteTable.length <= Material_Generic_Program.MaxSkinningParamsBoneMatrix);

            let offs = renderInst.allocateUniformBuffer(Material_Generic_Program.ub_SkinningParams, 16 * Material_Generic_Program.MaxSkinningParamsBoneMatrix);
            const d = renderInst.mapUniformBufferF32(Material_Generic_Program.ub_SkinningParams);

            mat4.identity(scratchMatrix);
            for (let i = 0; i < Material_Generic_Program.MaxSkinningParamsBoneMatrix; i++) {
                const boneIndex = bonePaletteTable[i];
                const m = boneIndex !== undefined ? boneMatrix[boneIndex] : scratchMatrix;
                offs += fillMatrix4x3(d, offs, m);
            }
        } else if (this.skinningMode === SkinningMode.Rigid) {
            assert(bonePaletteTable.length === 1);

            let offs = renderInst.allocateUniformBuffer(Material_Generic_Program.ub_SkinningParams, 16);
            const d = renderInst.mapUniformBufferF32(Material_Generic_Program.ub_SkinningParams);

            const boneIndex = bonePaletteTable[0];
            const m = boneMatrix[boneIndex];
            offs += fillMatrix4x3(d, offs, m);
        }
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

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
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

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_TexCoord0.xy = Mul(u_Texture1Transform, vec4(a_TexCoord.xy, 1.0, 1.0));
    v_TexCoord0.zw = Mul(u_Texture2Transform, vec4(a_TexCoord.xy, 1.0, 1.0));
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_Texture1 = texture(SAMPLER_2D(u_Texture1, v_TexCoord0.xy));
    vec4 t_Texture2 = texture(SAMPLER_2D(u_Texture2, v_TexCoord0.zw));
    vec4 t_FinalColor = t_Texture1 * t_Texture2 * u_ModulationColor;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
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

        p['$texture2']                     = new ParameterTexture(true);
        p['$texture2transform']            = new ParameterMatrix();
        p['$frame2']                       = new ParameterNumber(0.0);

        // TODO(jstpierre): MonitorScreen tint/constrast/saturation.
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        super.initStatic(device, cache);

        this.program = new UnlitTwoTextureProgram();

        const isTranslucent = this.paramGetBoolean('$translucent') || this.textureIsTranslucent('$basetexture') || this.textureIsTranslucent('$texture2');
        this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        if (!this.paramGetBoolean('$nofog'))
            this.program.setDefineBool('USE_FOG', true);

        this.gfxProgram = cache.createProgram(this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$texture2').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$frame2'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        this.setupFogParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(UnlitTwoTextureProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(UnlitTwoTextureProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix!);
        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform');
        offs += this.paramFillTextureMatrix(d, offs, '$texture2transform');
        offs += this.paramFillColor(d, offs, '$color', '$alpha');

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Water
const enum WaterShaderType { Normal, Flow }

class WaterMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_BumpScaleBias;
#ifdef USE_TEXSCROLL
    vec4 u_TexScroll;
#endif
    vec4 u_RefractTint;
    vec4 u_ReflectTint;
    vec4 u_WaterFogColor;
    Mat4x4 u_ProjectedDepthToWorld;
};

#define u_RefractAmount (u_RefractTint.a)
#define u_ReflectAmount (u_ReflectTint.a)
#define u_WaterFogRange (u_WaterFogColor.a)

// Refract Coordinates
varying vec3 v_TexCoord0;
// Normal Map Coordinates
varying vec2 v_TexCoord1;
varying vec4 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Refract Texture, Normalmap, Framebuffer Depth Texture, Reflect Texture (Expensive Water)
uniform sampler2D u_TextureRefract;
uniform sampler2D u_TextureNormalmap;
uniform sampler2D u_TextureFramebufferDepth;
uniform sampler2D u_TextureReflect;
// Envmap ("Cheap" Water)
uniform samplerCube u_TextureEnvmap;

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    v_PositionWorld.w = gl_Position.z; // Clip-space Z
    vec3 t_NormalWorld = Mul(u_ModelMatrix, vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = Mul(u_ModelMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    // Convert from projected position to texture space.
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xy = CalcScaleBias(a_TexCoord.xy, u_BumpScaleBias);
}
#endif

#ifdef FRAG
float SampleFramebufferDepth(vec2 t_ProjTexCoord) {
    return texture(SAMPLER_2D(u_TextureFramebufferDepth), t_ProjTexCoord).r;
}

bool IsSomethingInFront(float t_DepthSample) {
    if (t_DepthSample ${IS_DEPTH_REVERSED ? `>` : `<`} gl_FragCoord.z)
        return true;

    return false;
}

float CalcFogAmountFromScreenPos(vec2 t_ProjTexCoord, float t_DepthSample) {
    // Reconstruct world-space position for the sample.
    vec3 t_DepthSamplePosViewport = vec3(t_ProjTexCoord.x, t_ProjTexCoord.y, t_DepthSample);
    vec4 t_DepthSamplePosClip = vec4(t_DepthSamplePosViewport * vec3(2.0) - vec3(1.0), 1.0);
    vec4 t_DepthSamplePosWorld = Mul(u_ProjectedDepthToWorld, t_DepthSamplePosClip);
    // Divide by W.
    t_DepthSamplePosWorld.xyz /= t_DepthSamplePosWorld.www;

    // Now retrieve the height different (+Z is up in Source Engine BSP space)
    float t_HeightDifference = v_PositionWorld.z - t_DepthSamplePosWorld.z;

    // Also account for the distance from the eye (emulate "traditional" scattering fog)
    float t_DistanceFromEye = u_CameraPosWorld.z - v_PositionWorld.z;
    float t_FogDepth = saturate(t_HeightDifference / t_DistanceFromEye);

    float t_PositionClipZ = v_PositionWorld.w;
    float t_FogAmount = saturate((t_FogDepth * -t_PositionClipZ) / u_WaterFogRange);

    return t_FogAmount;
}

void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord1.xy;
    vec4 t_BumpmapSample0 = texture(SAMPLER_2D(u_TextureNormalmap, t_BumpmapCoord0));
#ifdef USE_TEXSCROLL
    vec2 t_BumpmapCoord1 = vec2(t_BumpmapCoord0.x + t_BumpmapCoord0.y, -t_BumpmapCoord0.x + t_BumpmapCoord0.y) + 0.1 * u_TexScroll.xy;
    vec4 t_BumpmapSample1 = texture(SAMPLER_2D(u_TextureNormalmap, t_BumpmapCoord1));
    vec2 t_BumpmapCoord2 = t_BumpmapCoord0.yx + 0.45 * u_TexScroll.zw;
    vec4 t_BumpmapSample2 = texture(SAMPLER_2D(u_TextureNormalmap, t_BumpmapCoord2));
    vec4 t_BumpmapSample = (0.33 * (t_BumpmapSample0 + t_BumpmapSample1 + t_BumpmapSample2));
#else
    vec4 t_BumpmapSample = t_BumpmapSample0;
#endif
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample).rgb;
    float t_BumpmapStrength = t_BumpmapSample.a;

    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;

    vec2 t_TexCoordBumpOffset = t_BumpmapNormal.xy * t_BumpmapStrength;

    float t_RefractFogBendAmount = CalcFogAmountFromScreenPos(t_ProjTexCoord, SampleFramebufferDepth(t_ProjTexCoord));
    float t_RefractAmount = u_RefractAmount * t_RefractFogBendAmount;
    vec2 t_RefractTexCoord = t_ProjTexCoord + (t_TexCoordBumpOffset.xy * t_RefractAmount);

    float t_RefractFogAmount;
    float t_RefractDepthSample = SampleFramebufferDepth(t_RefractTexCoord);
    if (IsSomethingInFront(t_RefractDepthSample)) {
        // Something's in front, just use the original...
        t_RefractTexCoord = t_ProjTexCoord;
        t_RefractFogAmount = t_RefractFogBendAmount;
    } else {
        t_RefractFogAmount = CalcFogAmountFromScreenPos(t_RefractTexCoord, t_RefractDepthSample);
    }

    vec4 t_RefractSample = texture(SAMPLER_2D(u_TextureRefract, t_RefractTexCoord));
    vec3 t_RefractColor = t_RefractSample.rgb * u_RefractTint.rgb;

    t_RefractColor.rgb = mix(t_RefractColor.rgb, u_WaterFogColor.rgb, t_RefractFogAmount);

    vec3 t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec3 t_ReflectColor = vec3(0.0);
#ifdef USE_EXPENSIVE_REFLECT
    float t_ReflectAmount = u_ReflectAmount * 0.25;
    vec2 t_ReflectTexCoord = t_ProjTexCoord + (t_TexCoordBumpOffset.xy * t_ReflectAmount);
    // Reflection texture is stored upside down
    t_ReflectTexCoord.y = 1.0 - t_ReflectTexCoord.y;

    vec4 t_ReflectSample = texture(SAMPLER_2D(u_TextureReflect), t_ReflectTexCoord);
    t_ReflectColor = t_ReflectSample.rgb * u_ReflectTint.rgb;
#else
    vec4 t_ReflectSample = texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection);
    t_ReflectColor = t_ReflectSample.rgb * u_ReflectTint.rgb;
#endif

    vec4 t_FinalColor;

    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = CalcFresnelTerm5(dot(t_NormalWorld, t_WorldDirectionToEye));
    t_FinalColor.rgb = mix(t_RefractColor, t_ReflectColor, t_Fresnel);

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class WaterFlowMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_BaseTextureScaleBias;
    vec4 u_WaterFogColor;
    vec4 u_Misc[3];
};

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

// Base Texture, Lightmap
varying vec4 v_TexCoord0;
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// BaseTexture, Lightmap, Normal Map, Flow Map, Flow Noise
uniform sampler2D u_TextureBase;
uniform sampler2D u_TextureLightmap;
uniform sampler2D u_TextureNormalmap;
uniform sampler2D u_TextureFlowmap;
uniform sampler2D u_TextureFlowNoise;
// Envmap
uniform samplerCube u_TextureEnvmap;

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = Mul(u_ModelMatrix, vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = Mul(u_ModelMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = CalcScaleBias(a_TexCoord.xy, u_BaseTextureScaleBias);
    v_TexCoord0.zw = a_TexCoord.zw;
}
#endif

#ifdef FRAG
vec3 ReconstructNormal(in vec2 t_NormalXY) {
    float t_NormalZ = sqrt(saturate(1.0 - dot(t_NormalXY, t_NormalXY.xy)));
    return vec3(t_NormalXY.xy, t_NormalZ);
}

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

void mainPS() {
    vec4 t_FinalColor;

    vec2 t_FlowTexCoord = v_TexCoord0.xy * u_FlowTexCoordScale;

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
    vec4 t_NormalWorld = vec4(ReconstructNormal(t_FlowNormalXY), 1.0);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_LookDir = normalize(t_PositionToEye.xyz);

    float t_NoV = saturate(dot(t_LookDir.xyz, t_NormalWorld.xyz));
    float t_Reflectance = 0.2;
    float t_Fresnel = mix(CalcFresnelTerm5(t_NoV), 1.0, t_Reflectance);

    // Compute reflection and refraction colors...
    vec4 t_ReflectColor = vec4(0.0);
    vec4 t_RefractColor = vec4(0.0);

    vec3 t_DiffuseLight = vec3(1.0, 1.0, 1.0);
    vec3 t_WaterFogColor = u_WaterFogColor.rgb;

#ifdef USE_LIGHTMAP_WATER_FOG
    vec3 t_LightmapColor = texture(SAMPLER_2D(u_TextureLightmap), v_TexCoord0.zw).rgb;
    float t_LightmapScale = 2.0; // TODO(HDR)
    t_LightmapColor *= t_LightmapScale;

    t_DiffuseLight *= t_LightmapColor;
#endif

    t_WaterFogColor *= t_DiffuseLight;
    t_RefractColor.rgb += t_WaterFogColor;

    vec3 t_Reflection = CalcReflection(t_NormalWorld.xyz, t_PositionToEye.xyz);
    t_ReflectColor += texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgba;

    float t_RefractAmount = t_Fresnel;

#ifdef USE_BASETEXTURE
    // Parallax scum layer
    float t_ParallaxStrength = t_FlowNormalSample.a * u_FlowColorDisplacementStrength;
    vec3 t_InteriorDirection = t_ParallaxStrength * (t_LookDir.xyz - t_NormalWorld.xyz);
    vec2 t_FlowColorTexCoordBase = t_TexCoordWorldBase.xy * u_FlowColorTexCoordScale + t_InteriorDirection.xy;
    float t_FlowColorTimeInIntervals = u_FlowColorTimeInIntervals + t_FlowNoiseSample.g;
    vec4 t_FlowColorSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureBase), t_FlowColorTexCoordBase, t_FlowColorTimeInIntervals, u_FlowColorTexCoordScrollDistance, t_FlowVectorTangent.xy, u_FlowColorLerpExp);

    vec4 t_FlowColor = t_FlowColorSample.rgba;

    // Mask by flowmap alpha and apply light
    t_FlowColor.rgba *= t_FlowSample.a;
    t_FlowColor.rgb *= t_DiffuseLight.rgb;

    // Sludge can either be below or on top of the water, according to base texture alpha.
    //   0.0 - 0.5 = translucency, and 0.5 - 1.0 = above water
    // Compute transparency from 
    t_RefractColor.rgb = mix(t_RefractColor.rgb, t_FlowColor.rgb, saturate(invlerp(0.0, 0.5, t_FlowColor.a)));

    // Now compute above water
    float t_AboveWater = 1.0 - smoothstep(0.5, 0.7, t_FlowColor.a);
    t_RefractAmount = saturate(t_Fresnel * t_AboveWater);
#endif

    t_FinalColor.rgb = mix(t_RefractColor.rgb, t_ReflectColor.rgb, t_RefractAmount);
    t_FinalColor.a = u_WaterBlendFactor;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Water extends BaseMaterial {
    private shaderType: WaterShaderType;
    private program: MaterialProgramBase;
    private gfxProgram: GfxProgram | null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(6, () => new TextureMapping());

    private wantsTexScroll = false;

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$envmap']                       = new ParameterTexture(true, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$refracttexture']               = new ParameterTexture(true, false);
        p['$refracttint']                  = new ParameterColor(1, 1, 1);
        p['$reflecttexture']               = new ParameterTexture(true, false);
        p['$refractamount']                = new ParameterNumber(0);
        p['$reflecttint']                  = new ParameterColor(1, 1, 1);
        p['$reflectamount']                = new ParameterNumber(0.8);
        p['$scroll1']                      = new ParameterVector(3);
        p['$scroll2']                      = new ParameterVector(3);
        p['$cheapwaterstartdistance']      = new ParameterNumber(500.0);
        p['$cheapwaterenddistance']        = new ParameterNumber(1000.0);

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
        p['$depthtexture']                 = new ParameterTexture(false, false);
        this.paramGetTexture('$depthtexture').ref = '_rt_Depth';
    }

    private recacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(this.program);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        super.initStatic(device, cache);

        if (this.paramGetVTF('$flowmap') !== null) {
            this.shaderType = WaterShaderType.Flow;
            this.program = new WaterFlowMaterialProgram();

            if (this.paramGetVTF('$basetexture') !== null)
                this.program.setDefineBool('USE_BASETEXTURE', true);

            if (this.paramGetBoolean('$lightmapwaterfog')) {
                this.program.setDefineBool('USE_LIGHTMAP_WATER_FOG', true);
                this.wantsLightmap = true;
            }

            this.isTranslucent = false;
        } else {
            this.shaderType = WaterShaderType.Normal;
            this.program = new WaterMaterialProgram();

            if (this.paramGetVector('$scroll1').get(0) !== 0) {
                this.wantsTexScroll = true;
                this.program.setDefineBool('USE_TEXSCROLL', true);
            }

            this.isIndirect = this.textureIsIndirect('$refracttexture');
        }

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        if (!this.paramGetBoolean('$nofog'))
            this.program.setDefineBool('USE_FOG', true);

        this.gfxProgram = cache.createProgram(this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null, lightmapPageIndex: number | null = null): void {
        assert(this.isMaterialLoaded());

        this.setupFogParams(renderContext, renderInst);

        if (this.shaderType === WaterShaderType.Flow) {
            this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
            renderContext.lightmapManager.fillTextureMapping(this.textureMapping[1], lightmapPageIndex);
            this.paramGetTexture('$normalmap').fillTextureMapping(this.textureMapping[2], this.paramGetInt('$bumpframe'));
            this.paramGetTexture('$flowmap').fillTextureMapping(this.textureMapping[3], this.paramGetInt('$flowmapframe'));
            this.paramGetTexture('$flow_noise_texture').fillTextureMapping(this.textureMapping[4], 0);
            this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[5], this.paramGetInt('$envmapframe'));

            let offs = renderInst.allocateUniformBuffer(WaterFlowMaterialProgram.ub_ObjectParams, 64);
            const d = renderInst.mapUniformBufferF32(WaterFlowMaterialProgram.ub_ObjectParams);
            offs += fillMatrix4x3(d, offs, modelMatrix!);

            offs += this.paramFillScaleBias(d, offs, '$basetexturetransform');
            offs += this.paramFillGammaColor(d, offs, '$fogcolor');

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
        } else if (this.shaderType === WaterShaderType.Normal) {
            this.paramGetTexture('$refracttexture').fillTextureMapping(this.textureMapping[0], 0);
            this.paramGetTexture('$normalmap').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$bumpframe'));
            this.paramGetTexture('$depthtexture').fillTextureMapping(this.textureMapping[2], 0);
            this.paramGetTexture('$reflecttexture').fillTextureMapping(this.textureMapping[3], 0);
            this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[4], this.paramGetInt('$envmapframe'));

            let offs = renderInst.allocateUniformBuffer(WaterMaterialProgram.ub_ObjectParams, 64);
            const d = renderInst.mapUniformBufferF32(WaterMaterialProgram.ub_ObjectParams);
            offs += fillMatrix4x3(d, offs, modelMatrix!);
            offs += this.paramFillScaleBias(d, offs, '$bumptransform');

            if (this.wantsTexScroll) {
                const scroll1x = this.paramGetVector('$scroll1').get(0) * renderContext.globalTime;
                const scroll1y = this.paramGetVector('$scroll1').get(1) * renderContext.globalTime;
                const scroll2x = this.paramGetVector('$scroll2').get(0) * renderContext.globalTime;
                const scroll2y = this.paramGetVector('$scroll2').get(1) * renderContext.globalTime;
                offs += fillVec4(d, offs, scroll1x, scroll1y, scroll2x, scroll2y);
            }

            const useExpensiveReflect = renderContext.currentView.useExpensiveWater;
            if (this.program.setDefineBool('USE_EXPENSIVE_REFLECT', useExpensiveReflect))
                this.gfxProgram = null;

            offs += this.paramFillGammaColor(d, offs, '$refracttint', '$refractamount');
            offs += this.paramFillGammaColor(d, offs, '$reflecttint', '$reflectamount');

            const fogStart = this.paramGetNumber('$fogstart');
            const fogEnd = this.paramGetNumber('$fogend');
            // The start is actually unused, only the range is used...
            const fogRange = fogEnd - fogStart;

            this.paramGetVector('$fogcolor').fillColor(scratchColor, fogRange);
            offs += fillGammaColor(d, offs, scratchColor);

            // This will take us from -1...1 to world space position.
            mat4.invert(scratchMatrix, renderContext.currentView.clipFromWorldMatrix);
            offs += fillMatrix4x4(d, offs, scratchMatrix);
        }

        this.recacheProgram(renderContext.renderCache);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Refract
class RefractMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_BumpScaleBias;
    vec4 u_RefractTint;
    vec4 u_Misc[1];
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
};

#define u_RefractAmount (u_RefractTint.a)
#define u_RefractDepth  (u_Misc[0].x)

// Base Texture Coordinates
varying vec3 v_TexCoord0;
// Normal Map Coordinates
varying vec2 v_TexCoord1;
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Base Texture, Normalmap, Refract Tint Texture
uniform sampler2D u_TextureBase;
uniform sampler2D u_TextureNormalmap;
uniform sampler2D u_TextureRefractTint;
// Envmap
uniform samplerCube u_TextureEnvmap;

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = Mul(u_ModelMatrix, vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = Mul(u_ModelMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    // Convert from projected position to texture space.
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xy = CalcScaleBias(a_TexCoord.xy, u_BumpScaleBias);
}
#endif

#ifdef FRAG
void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord1.xy;
    vec4 t_BumpmapSample = UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureNormalmap), t_BumpmapCoord0));
    vec3 t_BumpmapNormal = t_BumpmapSample.rgb;

    vec4 t_FinalColor = vec4(0);

    vec3 t_RefractTint = u_RefractTint.rgb;
#ifdef USE_REFRACT_TINT_TEXTURE
    vec4 t_RefractTintTextureSample = texture(SAMPLER_2D(u_TextureRefractTint), t_BumpmapCoord0);
    t_RefractTint *= 2.0 * t_RefractTintTextureSample.rgb;
#endif

#ifdef USE_LOCAL_REFRACT
    vec3 t_LookDirWorld = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    // Get the tangent-space look direction so we can refract into the texture.
    vec3 t_LookDirTangent = normalize(CalcWorldToTangent(t_LookDirWorld, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2));
    // "Refract" it. Currently, that doesn't do anything.
    vec3 t_LookDirRefract = t_LookDirTangent;
    // Refracted look direction dot surface normal. Since we're in tangent space, N is just (0,0,1)
    float t_RoN = -t_LookDirRefract.z;

    // Intersect with plane.
    vec2 t_RefractPointOnPlane = t_LookDirRefract.xy / t_RoN;
    // Compute our bent texture coordinates into the texture.
    vec2 t_RefractTexCoordOffs = vec2(0.0);
    t_RefractTexCoordOffs += t_RefractPointOnPlane.xy;
    t_RefractTexCoordOffs += t_BumpmapNormal.xy;
    t_RefractTexCoordOffs += (1.0 - t_BumpmapNormal.z) * t_RefractPointOnPlane;

    vec2 t_TexSize = vec2(textureSize(u_TextureBase, 0));
    vec2 t_Aspect = vec2(-t_TexSize.y / t_TexSize.x, 1.0);
    t_RefractTexCoordOffs *= t_Aspect * u_RefractDepth;
    vec2 t_RefractTexCoord = v_TexCoord1.xy + t_RefractTexCoordOffs.xy;

    vec4 t_Refract1 = texture(SAMPLER_2D(u_TextureBase), saturate(t_RefractTexCoord));
    vec4 t_Refract2 = texture(SAMPLER_2D(u_TextureBase), saturate(v_TexCoord1.xy + t_BumpmapNormal.xy * 0.1));
    vec3 t_Refract = mix(t_Refract1.rgb, t_Refract2.aaa, 0.025);
    float t_Fresnel = pow(t_BumpmapNormal.z, 3.0);

    t_FinalColor.rgb += t_Refract.rgb * t_Fresnel * t_RefractTint.rgb;
#else
    // "Classic" refract
    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;
    vec2 t_RefractTexCoord = t_ProjTexCoord + (u_RefractAmount * t_BumpmapSample.a) * t_BumpmapNormal.xy;

    vec4 t_BlurAccum = vec4(0);
    int g_BlurAmount = BLUR_AMOUNT;
    int g_BlurWidth = g_BlurAmount * 2 + 1;
    float g_BlurWeight = 1.0 / float(g_BlurWidth * g_BlurWidth);

    vec2 t_FramebufferSize = vec2(textureSize(u_TextureBase, 0));
    vec2 t_BlurSampleOffset = vec2(1.0) / t_FramebufferSize;
    for (int y = -g_BlurAmount; y <= g_BlurAmount; y++) {
        for (int x = -g_BlurAmount; x <= g_BlurAmount; x++) {
            vec2 t_TexCoord = t_RefractTexCoord + vec2(t_BlurSampleOffset.x * float(x), t_BlurSampleOffset.y * float(y));
            t_BlurAccum += g_BlurWeight * texture(SAMPLER_2D(u_TextureBase), t_TexCoord);
        }
    }

    t_FinalColor.rgb += t_BlurAccum.rgb * t_RefractTint.rgb;
#endif

#ifdef USE_ENVMAP
    vec3 t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec3 t_SpecularFactor = vec3(u_EnvmapTint);
    t_SpecularFactor.rgb *= t_BumpmapSample.a;

    vec3 t_SpecularLighting = vec3(0.0);
    t_SpecularLighting += texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgb;
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

    private program: RefractMaterialProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(4, () => new TextureMapping());

    protected initParameters(): void {
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

        this.paramGetTexture('$basetexture').ref = '_rt_Camera';
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        super.initStatic(device, cache);

        this.program = new RefractMaterialProgram();

        if (this.paramGetVTF('$envmap') !== null) {
            this.program.setDefineBool('USE_ENVMAP', true);
            this.wantsEnvmap = true;
        }

        if (this.paramGetVTF('$refracttinttexture') !== null) {
            this.program.setDefineBool('USE_REFRACT_TINT_TEXTURE', true);
        }

        if (this.paramGetBoolean('$localrefract')) {
            this.program.setDefineBool('USE_LOCAL_REFRACT', true);
            this.wantsLocalRefract = true;
        }

        const blurAmount = this.paramGetNumber('$bluramount') | 0;
        this.program.defines.set('BLUR_AMOUNT', '' + blurAmount);

        const isTranslucent = this.textureIsTranslucent('$basetexture');
        this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);
        this.isIndirect = this.textureIsIndirect('$basetexture');

        this.setCullMode(this.megaStateFlags);

        if (!this.paramGetBoolean('$nofog'))
            this.program.setDefineBool('USE_FOG', true);

        this.gfxProgram = cache.createProgram(this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$normalmap').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$refracttinttexture').fillTextureMapping(this.textureMapping[2], this.paramGetInt('$refracttinttextureframe'));
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[3], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        this.setupFogParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(RefractMaterialProgram.ub_ObjectParams, 68);
        const d = renderInst.mapUniformBufferF32(RefractMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix!);

        offs += this.paramFillScaleBias(d, offs, '$bumptransform');
        offs += this.paramFillGammaColor(d, offs, '$refracttint', '$refractamount');
        offs += fillVec4(d, offs, this.paramGetNumber('$localrefractdepth'));

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Material Cache
function makeSolidColorTexture2D(device: GfxDevice, color: Color): GfxTexture {
    const tex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
    const data = new Uint8Array(4);
    data[0] = color.r * 0xFF;
    data[1] = color.g * 0xFF;
    data[2] = color.b * 0xFF;
    data[3] = color.a * 0xFF;
    device.uploadTextureData(tex, 0, [data]);
    return tex;
}

class SystemTextures {
    public whiteTexture2D: GfxTexture;
    public opaqueBlackTexture2D: GfxTexture;
    public transparentBlackTexture2D: GfxTexture;

    constructor(device: GfxDevice) {
        this.whiteTexture2D = makeSolidColorTexture2D(device, White);
        this.opaqueBlackTexture2D = makeSolidColorTexture2D(device, OpaqueBlack);
        this.transparentBlackTexture2D = makeSolidColorTexture2D(device, TransparentBlack);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.whiteTexture2D);
        device.destroyTexture(this.opaqueBlackTexture2D);
        device.destroyTexture(this.transparentBlackTexture2D);
    }
}

export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();
    private usingHDR: boolean = false;
    public systemTextures: SystemTextures;
    public materialDefines: string[] = [];

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        // Install render targets
        this.textureCache.set('_rt_Camera', new VTF(device, cache, null, '_rt_Camera', false, LateBindingTexture.FramebufferColor));
        this.textureCache.set('_rt_WaterRefraction', new VTF(device, cache, null, '_rt_WaterRefraction', false, LateBindingTexture.FramebufferColor));
        this.textureCache.set('_rt_WaterReflection', new VTF(device, cache, null, '_rt_WaterReflection', false, LateBindingTexture.WaterReflection));
        this.textureCache.set('_rt_Depth', new VTF(device, cache, null, '_rt_Depth', false, LateBindingTexture.FramebufferDepth));
        this.systemTextures = new SystemTextures(device);
    }

    public setUsingHDR(hdr: boolean): void {
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
        else if (shaderType === 'unlittwotexture' || shaderType === 'monitorscreen')
            return new Material_UnlitTwoTexture(vmt);
        else if (shaderType === 'refract')
            return new Material_Refract(vmt);
        else
            return new Material_Generic(vmt);
    }

    public async createMaterialInstance(path: string): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        if (vmt['%compilesky'] || vmt['%compiletrigger'])
            materialInstance.isToolMaterial = true;
        return materialInstance;
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
        this.systemTextures.destroy(device);
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
//#endregion

//#region Runtime Lighting / LightCache
function findEnvCubemapTexture(bspfile: BSPFile, pos: ReadonlyVec3): Cubemap {
    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < bspfile.cubemaps.length; i++) {
        const distance = vec3.distance(pos, bspfile.cubemaps[i].pos);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    assert(bestIndex >= 0);
    return bspfile.cubemaps[bestIndex];
}

function worldLightInsideRadius(light: WorldLight, delta: ReadonlyVec3): boolean {
    return light.radius <= 0.0 || vec3.squaredLength(delta) <= light.radius**2;
}

function worldLightDistanceFalloff(light: WorldLight, delta: ReadonlyVec3): number {
    if (light.type === WorldLightType.Surface) {
        if (!worldLightInsideRadius(light, delta))
            return 0.0;
        return 1.0 / Math.max(1.0, vec3.squaredLength(delta));
    } else if (light.type === WorldLightType.Point || light.type === WorldLightType.Spotlight) {
        if (!worldLightInsideRadius(light, delta))
            return 0.0;

        // Compute quadratic attn falloff.
        const sqdist = vec3.squaredLength(delta), dist = Math.sqrt(sqdist);
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

const ambientCubeDirections = [ Vec3UnitX, Vec3NegX, Vec3UnitY, Vec3NegY, Vec3UnitZ, Vec3NegZ ] as const;
export class LightCache {
    private leaf: number = -1;
    public envCubemap: Cubemap;
    public debug: boolean = false;

    private worldLights: LightCacheWorldLight[] = nArray(Material_Generic_Program.MaxDynamicWorldLights, () => new LightCacheWorldLight());
    private ambientCube: AmbientCube = newAmbientCube();

    constructor(bspfile: BSPFile, private pos: ReadonlyVec3, bbox: AABB) {
        this.leaf = bspfile.findLeafIdxForPoint(pos);
        assert(this.leaf >= 0);

        this.envCubemap = findEnvCubemapTexture(bspfile, pos);
        this.calc(bspfile);
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
        // TODO(jstpierre): Angle attenuation

        for (let i = 0; i < ambientCubeDirections.length; i++) {
            const dst = this.ambientCube[i];
            const mul = vec3.dot(scratchVec3, ambientCubeDirections[i]) * ratio;
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

    private calc(bspfile: BSPFile): void {
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
    public surfaceLightmaps: SurfaceLightmap[] = [];

    constructor(device: GfxDevice, private page: LightmapPackerPage) {
        const width = this.page.width, height = this.page.height;
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_SRGB, width, height, 1));
        this.data = new Uint8Array(width * height * 4);

        const fillEmptySpaceWithPink = false;

        if (fillEmptySpaceWithPink) {
            for (let i = 0; i < width * height * 4; i += 4) {
                this.data[i+0] = 0xFF;
                this.data[i+1] = 0x00;
                this.data[i+2] = 0xFF;
                this.data[i+3] = 0xFF;
            }
        }
    }

    public registerSurfaceLightmap(surface: SurfaceLightmap): void {
        this.surfaceLightmaps.push(surface);
    }

    public prepareToRender(device: GfxDevice): void {
        const data = this.data;

        // Go through and stamp each surface into the page at the right location.

        // TODO(jstpierre): Maybe it makes more sense for packRuntimeLightmapData to do this positioning.
        let anyDirty = false;
        for (let i = 0; i < this.surfaceLightmaps.length; i++) {
            const instance = this.surfaceLightmaps[i];
            if (!instance.lightmapUploadDirty)
                continue;

            const lightmapData = instance.lightmapData;
            const pixelData = instance.pixelData!;

            let srcOffs = 0;
            for (let y = lightmapData.pagePosY; y < lightmapData.pagePosY + lightmapData.height; y++) {
                for (let x = lightmapData.pagePosX; x < lightmapData.pagePosX + lightmapData.width; x++) {
                    let dstOffs = (y * this.page.width + x) * 4;
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
            device.uploadTextureData(this.gfxTexture, 0, [data]);
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

    public appendPackerManager(manager: LightmapPackerManager): void {
        for (let i = 0; i < manager.pages.length; i++)
            this.lightmapPages.push(new LightmapPage(this.device, manager.pages[i]));
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].prepareToRender(device);
    }

    public getPageTexture(pageIndex: number): GfxTexture {
        return this.lightmapPages[pageIndex].gfxTexture;
    }

    public registerSurfaceLightmap(instance: SurfaceLightmap): void {
        // TODO(jstpierre): PageIndex isn't unique / won't work with multiple BSP files.
        this.lightmapPages[instance.lightmapData.pageIndex].registerSurfaceLightmap(instance);
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

class LightmapColor {
    public r: number = 0;
    public g: number = 0;
    public b: number = 0;
    public origMax: number = 0;

    public calcMax(): number {
        return Math.max(this.r, this.g, this.b);
    }

    public fetch(src: Float32Array, offs: number): number {
        this.r = src[offs++];
        this.g = src[offs++];
        this.b = src[offs++];
        return 3;
    }

    public fill(dst: Uint8ClampedArray, offs: number): number {
        dst[offs++] = Math.round(this.r * 255.0);
        dst[offs++] = Math.round(this.g * 255.0);
        dst[offs++] = Math.round(this.b * 255.0);
        // offs++;
        return 4;
    }
}

const scratchColors = [new LightmapColor(), new LightmapColor(), new LightmapColor()];
const scratchColorSort = [0, 1, 2];
function lightmapPackRuntimeBumpmap(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, texelCount: number): void {
    const srcSize = texelCount * 3;
    const dstSize = texelCount * 4;

    let srcOffs0 = srcOffs, srcOffs1 = srcOffs + srcSize * 1, srcOffs2 = srcOffs + srcSize * 2, srcOffs3 = srcOffs + srcSize * 3;
    let dstOffs0 = dstOffs, dstOffs1 = dstOffs + dstSize * 1, dstOffs2 = dstOffs + dstSize * 2, dstOffs3 = dstOffs + dstSize * 3;
    for (let i = 0; i < texelCount; i++) {
        const sr = linearToLightmap(src[srcOffs0++]), sg = linearToLightmap(src[srcOffs0++]), sb = linearToLightmap(src[srcOffs0++]);

        // Lightmap 0 is easy (unused tho).
        dst[dstOffs0++] = Math.round(sr * 255.0);
        dst[dstOffs0++] = Math.round(sg * 255.0);
        dst[dstOffs0++] = Math.round(sb * 255.0);
        dstOffs0++;

        const c = scratchColors;
        srcOffs1 += c[0].fetch(src, srcOffs1);
        srcOffs2 += c[1].fetch(src, srcOffs2);
        srcOffs3 += c[2].fetch(src, srcOffs3);

        const avgr = sr / Math.max((c[0].r + c[1].r + c[2].r) / 3.0, MathConstants.EPSILON);
        const avgg = sg / Math.max((c[0].g + c[1].g + c[2].g) / 3.0, MathConstants.EPSILON);
        const avgb = sb / Math.max((c[0].b + c[1].b + c[2].b) / 3.0, MathConstants.EPSILON);
        for (let j = 0; j < 3; j++) {
            const cc = c[j];
            cc.r *= avgr;
            cc.g *= avgg;
            cc.b *= avgb;
            cc.origMax = cc.calcMax();
        }

        // Clamp & redistribute colors if necessary
        if (c[0].origMax > 1.0 || c[1].origMax > 1.0 || c[2].origMax > 1.0) {
            const sort = scratchColorSort;
            for (let j = 0; j < 3; j++) { sort[j] = j; }
            sort.sort((a, b) => c[b].origMax - c[a].origMax);

            for (let j = 0; j < c.length; j++) {
                const c0 = c[sort[j]];
                if (c0.origMax > 1.0) {
                    const max = c0.calcMax();
                    const m = (max - 1.0) / max;
                    const mr = m * c0.r, mg = m * c0.g, mb = m * c0.b;

                    c0.r -= mr;
                    c0.g -= mg;
                    c0.b -= mb;

                    const c1 = c[sort[(j+1)%3]];
                    c1.r += mr * 0.5;
                    c1.g += mg * 0.5;
                    c1.b += mb * 0.5;

                    const c2 = c[sort[(j+2)%3]];
                    c2.r += mr * 0.5;
                    c2.g += mg * 0.5;
                    c2.b += mb * 0.5;
                }
            }
        }

        dstOffs1 += c[0].fill(dst, dstOffs1);
        dstOffs2 += c[1].fill(dst, dstOffs2);
        dstOffs3 += c[2].fill(dst, dstOffs3);
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
        const time = (timeInSeconds * 10);
        for (let i = 0; i < this.styleIntensities.length; i++) {
            const pattern = this.stylePatterns[i];
            if (pattern === undefined)
                continue;

            this.styleIntensities[i] = this.styleIntensityFromPattern(pattern, time);
        }
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

export class SurfaceLightmap {
    // The styles that we built our lightmaps for.
    public lightmapStyleIntensities: number[];
    public lightmapUploadDirty: boolean = false;
    public pixelData: Uint8ClampedArray | null;

    constructor(lightmapManager: LightmapManager, public lightmapData: SurfaceLightmapData, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.pixelData = createRuntimeLightmap(this.lightmapData.width, this.lightmapData.height, this.wantsLightmap, this.wantsBumpmap);

        this.lightmapStyleIntensities = nArray(this.lightmapData.styles.length, () => -1);

        if (this.wantsLightmap) {
            // Associate ourselves with the right page.
            lightmapManager.registerSurfaceLightmap(this);
        }
    }

    public buildLightmap(renderContext: SourceRenderContext): void {
        const worldLightingState = renderContext.worldLightingState;
        const scratchpad = renderContext.lightmapManager.scratchpad;

        // Check if our lightmap needs rebuilding.
        let dirty = false;
        for (let i = 0; i < this.lightmapData.styles.length; i++) {
            const styleIdx = this.lightmapData.styles[i];
            if (worldLightingState.styleIntensities[styleIdx] !== this.lightmapStyleIntensities[i]) {
                this.lightmapStyleIntensities[i] = worldLightingState.styleIntensities[styleIdx];
                dirty = true;
            }
        }

        if (!dirty)
            return;

        const hasLightmap = this.lightmapData.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const texelCount = this.lightmapData.mapWidth * this.lightmapData.mapHeight;
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
                lightmapPackRuntimeBumpmap(this.pixelData!, 0, scratchpad, 0, texelCount);
            } else {
                lightmapPackRuntime(this.pixelData!, 0, scratchpad, 0, texelCount);
            }
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
            this.pixelData!.fill(255);
        }

        this.lightmapUploadDirty = true;
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
        this.registerProxyFactory(MaterialProxy_MaterialModify);
        this.registerProxyFactory(MaterialProxy_MaterialModifyAnimated);
        this.registerProxyFactory(MaterialProxy_WaterLOD);
        this.registerProxyFactory(MaterialProxy_TextureTransform);
        this.registerProxyFactory(MaterialProxy_ToggleTexture);
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
    public static type = 'materialmodifyanimated';
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
