
import * as UI from '../ui';
import * as Viewer from '../viewer';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';

import { GfxDevice, GfxSampler, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode, GfxCullMode, GfxCompareMode, GfxInputState, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxProgram, GfxMegaStateDescriptor, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxChannelWriteMask } from '../gfx/platform/GfxPlatform';

import * as BNTX from '../fres_nx/bntx';
import { surfaceToCanvas } from '../Common/bc_texture';
import { translateImageFormat, deswizzle, decompress, getImageFormatString } from '../fres_nx/tegra_texture';
import { FMDL, FSHP, FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FVTX, FSHP_Mesh, FRES, FVTX_VertexAttribute, FVTX_VertexBuffer, parseFMAT_ShaderParam_Float4, FMAT_ShaderParam, parseFMAT_ShaderParam_Color3, parseFMAT_ShaderParam_Float } from '../fres_nx/bfres';
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyDepth, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { TextureAddressMode, FilterMode, IndexFormat, AttributeFormat, getChannelFormat, getTypeFormat } from '../fres_nx/nngfx_enum';
import { nArray, assert, assertExists } from '../util';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { fillMatrix4x4, fillMatrix4x3, fillVec4v, fillColor, fillVec3v } from '../gfx/helpers/UniformBufferHelpers';
import { mat4, vec4 } from 'gl-matrix';
import { computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera';
import { AABB } from '../Geometry';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { DeviceProgram } from '../Program';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxShaderLibrary, glslGenerateFloat } from '../gfx/helpers/ShaderHelpers';
import { Vec3Zero } from '../MathHelpers';

import * as SARC from "../fres_nx/sarc";
import * as AGLLightMap from './AGLParameter_LightMap';
import * as AGLEnv from './AGLParameter_Env';
import { colorNewCopy, colorScale, OpaqueBlack, White } from '../Color';

export class BRTITextureHolder extends TextureHolder<BNTX.BRTI> {
    public addFRESTextures(device: GfxDevice, fres: FRES): void {
        const bntxFile = fres.externalFiles.find((f) => f.name === 'textures.bntx');
        if (bntxFile !== undefined)
            this.addBNTXFile(device, bntxFile.buffer);
    }

    public addBNTXFile(device: GfxDevice, buffer: ArrayBufferSlice): void {
        const bntx = BNTX.parse(buffer);
        this.addTextures(device, bntx.textures);
    }

    public loadTexture(device: GfxDevice, textureEntry: BNTX.BRTI): LoadedTexture | null {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(translateImageFormat(textureEntry.imageFormat), textureEntry.width, textureEntry.height, textureEntry.mipBuffers.length));
        const canvases: HTMLCanvasElement[] = [];

        const channelFormat = getChannelFormat(textureEntry.imageFormat);

        for (let i = 0; i < textureEntry.mipBuffers.length; i++) {
            const mipLevel = i;

            const buffer = textureEntry.mipBuffers[i];
            const width = Math.max(textureEntry.width >>> mipLevel, 1);
            const height = Math.max(textureEntry.height >>> mipLevel, 1);
            const depth = 1;
            const deswizzled = deswizzle({ buffer, width, height, channelFormat });
            const rgbaTexture = decompress({ ...textureEntry, width, height, depth }, deswizzled);
            const rgbaPixels = rgbaTexture.pixels;
            device.uploadTextureData(gfxTexture, mipLevel, [rgbaPixels]);

            const canvas = document.createElement('canvas');
            surfaceToCanvas(canvas, rgbaTexture);
            canvases.push(canvas);
        }

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', getImageFormatString(textureEntry.imageFormat));

        const viewerTexture: Viewer.Texture = { name: textureEntry.name, surfaces: canvases, extraInfo };
        return { viewerTexture, gfxTexture };
    }
}

function translateAddressMode(addrMode: TextureAddressMode): GfxWrapMode {
    switch (addrMode) {
    case TextureAddressMode.Repeat:
        return GfxWrapMode.Repeat;
    case TextureAddressMode.ClampToEdge:
    case TextureAddressMode.ClampToBorder:
        return GfxWrapMode.Clamp;
    case TextureAddressMode.Mirror:
        return GfxWrapMode.Mirror;
    case TextureAddressMode.MirrorClampToEdge:
        // TODO(jstpierre): This requires GL_ARB_texture_mirror_clamp_to_edge
        return GfxWrapMode.Mirror;
    default:
        throw "whoops";
    }
}

function translateMipFilterMode(filterMode: FilterMode): GfxMipFilterMode {
    switch (filterMode) {
    case FilterMode.Linear:
        return GfxMipFilterMode.Linear;
    case FilterMode.Point:
        return GfxMipFilterMode.Nearest;
    case 0:
        return GfxMipFilterMode.NoMip;
    default:
        throw "whoops";
    }
}

function translateTexFilterMode(filterMode: FilterMode): GfxTexFilterMode {
    switch (filterMode) {
    case FilterMode.Linear:
        return GfxTexFilterMode.Bilinear;
    case FilterMode.Point:
        return GfxTexFilterMode.Point;
    default:
        throw "whoops";
    }
}

class TurboUBER extends DeviceProgram {
    public static _p0: number = 0;
    public static _c0: number = 1;
    public static _u0: number = 2;
    public static _u1: number = 3;
    public static _n0: number = 4;
    public static _t0: number = 5;

    public static a_Orders = [ '_p0', '_c0', '_u0', '_u1', '_n0', '_t0' ];
    public static s_Orders = [ '_a0', '_s0', '_n0', '_e0', '_b0', '_b1', '_a1', '_a2', '_a3' ];

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;

    public static NumEnvLightParams = 6;

    public isTranslucent: boolean = false;

    constructor(public fmat: FMAT) {
        super();

        this.name = this.fmat.name;
        assert(this.fmat.samplerInfo.length <= 8);

        this.isTranslucent = false;
        this.frag = this.generateFrag();
    }

    public static globalDefinitions = `
precision mediump float;

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat4x3 u_ModelView;
};

struct EnvLightParam {
    vec4 BacksideColor;
    vec4 DiffuseColor;
    vec4 Direction;
};

layout(std140) uniform ub_MaterialParams {
    vec4 u_TexCoordBake0ScaleBias;
    vec4 u_TexCoordBake1ScaleBias;
    vec4 u_AlbedoColor;
    vec4 u_EmissionColor;
    EnvLightParam u_EnvLightParams[${TurboUBER.NumEnvLightParams}];
};

vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

uniform sampler2D u_TextureAlbedo0;   // _a0
uniform sampler2D u_TextureSpecMask;  // _s0
uniform sampler2D u_TextureNormal0;   // _n0
uniform sampler2D u_TextureEmission0; // _e0
uniform sampler2D u_TextureBake0;     // _b0
uniform sampler2D u_TextureBake1;     // _b1
uniform sampler2D _a1;                // _a1
uniform sampler2D _a2;                // _a2
uniform sampler2D _a3;                // _a3
`;

    public both = TurboUBER.globalDefinitions;

    public vert = `
layout(location = ${TurboUBER._p0}) in vec3 a_Position;  // _p0
layout(location = ${TurboUBER._c0}) in vec4 a_Color;     // _c0
layout(location = ${TurboUBER._u0}) in vec2 a_TexCoord0; // _u0
layout(location = ${TurboUBER._u1}) in vec2 a_TexCoord1; // _u1
layout(location = ${TurboUBER._n0}) in vec4 a_Normal;    // _n0
layout(location = ${TurboUBER._t0}) in vec4 a_Tangent;   // _t0

out vec3 v_PositionWorld;
out vec2 v_TexCoord0;
out vec4 v_TexCoordBake;
out vec4 v_VtxColor;
out vec4 v_NormalWorld;
out vec4 v_TangentWorld;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_PositionWorld = a_Position.xyz;
    v_TexCoord0 = a_TexCoord0;
    v_TexCoordBake.xy = CalcScaleBias(a_TexCoord1.xy, u_TexCoordBake0ScaleBias);
    v_TexCoordBake.zw = CalcScaleBias(a_TexCoord1.xy, u_TexCoordBake1ScaleBias);
    v_VtxColor = a_Color;
    v_NormalWorld = a_Normal;
    v_TangentWorld = a_Tangent;
}
`;

    private shaderOptionBool(name: string, fallback: boolean = false): boolean {
        let v = this.fmat.shaderAssign.shaderOption.get(name);
        if (v !== undefined) {
            assert(v === '0' || v === '1');
            return v === '1';
        } else {
            return fallback;
        }
    }

    private shaderOptionInt(name: string, fallback: number = -1): string {
        let v = this.fmat.shaderAssign.shaderOption.get(name);
        if (v !== undefined) {
            return v;
        } else {
            return glslGenerateFloat(fallback);
        }
    }

    public generateFrag() {
        return `
precision mediump float;

${GfxShaderLibrary.saturate}

in vec3 v_PositionWorld;
in vec2 v_TexCoord0;
in vec4 v_TexCoordBake;
in vec4 v_VtxColor;
in vec4 v_NormalWorld;
in vec4 v_TangentWorld;

struct BakeResult {
    vec3 IndirectLight;
    float Shadow;
    float AO;
};

struct LightResult {
    vec3 DiffuseColor;
};

struct DirectionalLight {
    vec3 DiffuseColor;
    vec3 BacksideColor;
    vec3 Direction;
    bool Wrapped;
    bool VisibleInShadow;
};

void CalcDirectionalLight(out LightResult t_Result, in vec3 t_Normal, in float t_Intensity, in DirectionalLight t_Light) {
    float t_Dot = -dot(t_Normal, t_Light.Direction);

    // Wrapped lighting
    if (t_Light.Wrapped)
        t_Dot = t_Dot * 0.5 + 0.5;
    else
        t_Dot = saturate(t_Dot);

    if (t_Light.VisibleInShadow)
        t_Intensity = 1.0;
    t_Result.DiffuseColor += mix(t_Light.BacksideColor, t_Light.DiffuseColor, t_Dot) * t_Intensity;
}

void CalcEnvLight(out LightResult t_Result, in vec3 t_Normal, in float t_Intensity) {
    for (int i = 0; i < 2; i++) {
        EnvLightParam t_EnvLightParam = u_EnvLightParams[i];

        DirectionalLight t_Light;
        t_Light.BacksideColor = t_EnvLightParam.BacksideColor.rgb;
        t_Light.DiffuseColor = t_EnvLightParam.DiffuseColor.rgb;
        t_Light.Direction = t_EnvLightParam.Direction.xyz;
        t_Light.Wrapped = bool(t_EnvLightParam.BacksideColor.a != 0.0);
        t_Light.VisibleInShadow = bool(t_EnvLightParam.DiffuseColor.a != 0.0);

        CalcDirectionalLight(t_Result, t_Normal, t_Intensity, t_Light);
    }
}

void CalcBakeResult(out BakeResult t_Result, in vec4 t_TexCoordBake) {
    bool enable_bake_texture = ${this.shaderOptionBool('enable_bake_texture')};

    int bake_light_type = enable_bake_texture ? ${this.shaderOptionInt('bake_light_type')} : -1;
    if (bake_light_type == 0) {
        // Lightmap.
        vec4 t_Bake1Sample = texture(u_TextureBake1, t_TexCoordBake.zw);
        vec3 t_Bake1Color = t_Bake1Sample.rgb * t_Bake1Sample.a;
        t_Result.IndirectLight = t_Bake1Color;
    } else {
        // Unknown.
        t_Result.IndirectLight = vec3(0.0);
    }

    int bake_shadow_type = enable_bake_texture ? ${this.shaderOptionInt('bake_shadow_type')} : -1;
    if (bake_shadow_type == 0) {
        float t_BakeSample = texture(u_TextureBake0, t_TexCoordBake.xy).r;
        t_Result.AO = t_BakeSample;
        t_Result.Shadow = 1.0;
    } else if (bake_shadow_type == 1) {
        float t_BakeSample = texture(u_TextureBake0, t_TexCoordBake.xy).r;
        t_Result.AO = t_BakeSample;
        t_Result.Shadow = 1.0;
    } else if (bake_shadow_type == 2) {
        vec2 t_BakeSample = texture(u_TextureBake0, t_TexCoordBake.xy).rg;
        t_Result.AO = t_BakeSample.r;
        t_Result.Shadow = t_BakeSample.g;
    } else {
        // Unknown.
        t_Result.AO = 1.0;
        t_Result.Shadow = 1.0;
    }
}

void main() {
    // ShaderOption settings.
    bool enable_diffuse = ${this.shaderOptionBool('enable_diffuse')};
    bool enable_diffuse2 = ${this.shaderOptionBool('enable_diffuse2')};
    bool enable_albedo = ${this.shaderOptionBool('enable_albedo')};
    bool enable_vtx_color_diff = ${this.shaderOptionBool('enable_vtx_color_diff')};
    bool enable_emission = ${this.shaderOptionBool('enable_emission')};
    bool enable_emission_map = ${this.shaderOptionBool('enable_emission_map')};

    vec4 t_PixelOut = vec4(0.0);
    float t_Alpha = 1.0;

    // Calculate incoming light.
    vec3 t_IncomingLightDiffuse = vec3(0.0);

    BakeResult t_BakeResult;
    CalcBakeResult(t_BakeResult, v_TexCoordBake);
    t_IncomingLightDiffuse += t_BakeResult.IndirectLight;

    LightResult t_LightResult;
    CalcEnvLight(t_LightResult, v_NormalWorld.xyz, t_BakeResult.Shadow);

    if (enable_diffuse) {
        t_IncomingLightDiffuse += t_LightResult.DiffuseColor;
    } else {
        t_IncomingLightDiffuse = vec3(1.0);
    }

    vec3 t_Albedo = u_AlbedoColor.rgb;
    vec3 t_Emission = u_EmissionColor.rgb;

    if (enable_diffuse2 && enable_albedo) {
        vec4 t_AlbedoSample = texture(SAMPLER_2D(u_TextureAlbedo0), v_TexCoord0.xy);
        t_Albedo.rgb *= t_AlbedoSample.rgb;
        t_Alpha *= t_AlbedoSample.a;
    }

    if (enable_vtx_color_diff) {
        t_Albedo.rgb *= v_VtxColor.rgb;
    }

    if (enable_emission && enable_emission_map) {
        vec4 t_EmissionSample = texture(SAMPLER_2D(u_TextureEmission0), v_TexCoord0.xy);
        t_Emission.rgb *= t_EmissionSample.rgb;
    }

    if (enable_diffuse2) {
        t_PixelOut.rgb += t_Albedo.rgb * t_IncomingLightDiffuse;
    }

    if (enable_emission) {
        t_PixelOut.rgb += t_Emission.rgb;
    }

    t_PixelOut.a = t_Alpha;

    vec3 t_AOColor = vec3(t_BakeResult.AO);
    t_PixelOut.rgb *= t_AOColor;

${this.generateAlphaTest()}

    // Gamma correct
    t_PixelOut.rgb = pow(t_PixelOut.rgb, vec3(1.0 / 2.2));

    gl_FragColor = t_PixelOut;
}
`;
    }

    private generateAlphaTestCompare(compare: GfxCompareMode, ref: string) {
        switch (compare) {
        case GfxCompareMode.Never:        return `false`;
        case GfxCompareMode.Less:         return `t_PixelOut.a <  ${ref}`;
        case GfxCompareMode.Equal:        return `t_PixelOut.a == ${ref}`;
        case GfxCompareMode.LessEqual:    return `t_PixelOut.a <= ${ref}`;
        case GfxCompareMode.Greater:      return `t_PixelOut.a >  ${ref}`;
        case GfxCompareMode.NotEqual:     return `t_PixelOut.a != ${ref}`;
        case GfxCompareMode.GreaterEqual: return `t_PixelOut.a >= ${ref}`;
        case GfxCompareMode.Always:       return `true`;
        default: throw "whoops";
        }
    }

    private generateAlphaTest(): string {
        if (!getRenderInfoBoolean(this.fmat.renderInfo.get('gsys_alpha_test_enable')!))
            return '';

        const mode = getRenderInfoCompareMode(this.fmat.renderInfo.get('gsys_alpha_test_func')!);
        const ref = getRenderInfoSingleFloat(this.fmat.renderInfo.get('gsys_alpha_test_value')!);
        const compareExpr = this.generateAlphaTestCompare(mode, glslGenerateFloat(ref));

        return `
    if (!(${compareExpr}))
        discard;
`;
    }
}

function getRenderInfoSingleString(renderInfo: FMAT_RenderInfo): string {
    assert(renderInfo.type === FMAT_RenderInfoType.String && renderInfo.values.length === 1);
    return renderInfo.values[0] as string;
}

function getRenderInfoSingleFloat(renderInfo: FMAT_RenderInfo): number {
    assert(renderInfo.type === FMAT_RenderInfoType.Float && renderInfo.values.length === 1);
    return renderInfo.values[0] as number;
}

function getRenderInfoBoolean(renderInfo: FMAT_RenderInfo): boolean {
    const value = getRenderInfoSingleString(renderInfo);
    if (value === 'true' || value === '1')
        return true;
    else if (value === 'false' || value === '0')
        return false;
    else
        throw "whoops";
}

function translateCullMode(fmat: FMAT): GfxCullMode {
    const display_face = getRenderInfoSingleString(fmat.renderInfo.get('gsys_render_state_display_face')!);
    if (display_face === 'front')
        return GfxCullMode.Back;
    else if (display_face === 'back')
        return GfxCullMode.Front;
    else if (display_face === 'both')
        return GfxCullMode.None;
    else
        throw "whoops";
}

function translateDepthWrite(fmat: FMAT): boolean {
    return getRenderInfoBoolean(fmat.renderInfo.get('gsys_depth_test_write')!);
}

function getRenderInfoCompareMode(renderInfo: FMAT_RenderInfo): GfxCompareMode {
    const value = getRenderInfoSingleString(renderInfo);
    if (value === 'lequal')
        return GfxCompareMode.LessEqual;
    else if (value === 'gequal')
        return GfxCompareMode.GreaterEqual;
    else
        throw "whoops";
}

function translateDepthCompare(fmat: FMAT): GfxCompareMode {
    if (getRenderInfoBoolean(fmat.renderInfo.get('gsys_depth_test_enable')!)) {
        return getRenderInfoCompareMode(fmat.renderInfo.get('gsys_depth_test_func')!);
    } else {
        return GfxCompareMode.Always;
    }
}

function getRenderInfoBlendMode(renderInfo: FMAT_RenderInfo): GfxBlendMode {
    const value = getRenderInfoSingleString(renderInfo);
    if (value === 'add')
        return GfxBlendMode.Add;
    else
        throw "whoops";
}

function translateRenderInfoBlendFactor(renderInfo: FMAT_RenderInfo): GfxBlendFactor {
    const value = getRenderInfoSingleString(renderInfo);
    if (value === 'src_alpha')
        return GfxBlendFactor.SrcAlpha;
    else if (value === 'one_minus_src_alpha')
        return GfxBlendFactor.OneMinusSrcAlpha;
    else if (value === 'one')
        return GfxBlendFactor.One;
    else if (value === 'zero')
        return GfxBlendFactor.Zero;
    else
        throw "whoops";
}

function findShaderParam(fmat: FMAT, name: string): FMAT_ShaderParam {
    return fmat.shaderParam.find((p) => p.name === name)!;
}

class FMATInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    private program: TurboUBER;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    public inOpaquePass: boolean = false;
    public inTranslucentPass: boolean = false;
    public inShadowMap: boolean = false;

    // Shader params, should maybe be generic?
    private texCoordBake0ScaleBias = vec4.create();
    private texCoordBake1ScaleBias = vec4.create();
    private albedoColor = colorNewCopy(White);
    private emissionColor = colorNewCopy(White);
    private emissionIntensity = 1.0;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: BRTITextureHolder, public fmat: FMAT) {
        this.program = new TurboUBER(fmat);

        // Fill in our texture mappings.
        assert(fmat.samplerInfo.length === fmat.textureName.length);

        this.textureMapping = nArray(TurboUBER.s_Orders.length, () => new TextureMapping());
        for (let i = 0; i < fmat.samplerInfo.length; i++) {
            const samplerInfo = fmat.samplerInfo[i];
            const gfxSampler = cache.createSampler({
                wrapS: translateAddressMode(samplerInfo.addrModeU),
                wrapT: translateAddressMode(samplerInfo.addrModeV),
                mipFilter: translateMipFilterMode((samplerInfo.filterMode >>> FilterMode.MipShift) & 0x03),
                minFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MinShift) & 0x03),
                magFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MagShift) & 0x03),
                maxLOD: samplerInfo.maxLOD,
                minLOD: samplerInfo.minLOD,
            });
            this.gfxSamplers.push(gfxSampler);
        }

        // Go through and assign to shader samplers.

        // As declared by the shader.
        const shaderSamplerNames = TurboUBER.s_Orders;
        for (const [shaderSamplerName, samplerName] of fmat.shaderAssign.samplerAssign.entries()) {
            const samplerIndex = fmat.samplerInfo.findIndex((samplerInfo) => samplerInfo.name === samplerName);
            const shaderSamplerIndex = shaderSamplerNames.indexOf(shaderSamplerName);

            // Unsupported texture type.
            if (shaderSamplerIndex < 0) {
                assert(['_n1', '_t0'].includes(shaderSamplerName));
                continue;
            }

            assert(samplerIndex >= 0 && shaderSamplerIndex >= 0);

            const shaderMapping = this.textureMapping[shaderSamplerIndex];

            textureHolder.fillTextureMapping(shaderMapping, fmat.textureName[samplerIndex]);
            shaderMapping.gfxSampler = this.gfxSamplers[samplerIndex];
        }

        this.gfxProgram = device.createProgram(this.program);

        // Render flags.
        const isTranslucent = this.program.isTranslucent;
        this.megaStateFlags = {
            cullMode:       translateCullMode(fmat),
            depthCompare:   reverseDepthForCompareMode(translateDepthCompare(fmat)),
            depthWrite:     isTranslucent ? false : translateDepthWrite(fmat),
        };

        const blendMode = getRenderInfoSingleString(fmat.renderInfo.get('gsys_render_state_blend_mode')!);
        if (blendMode === 'color') {
            this.megaStateFlags.attachmentsState = [{
                channelWriteMask: GfxChannelWriteMask.AllChannels,
                rgbBlendState: {
                    blendMode: getRenderInfoBlendMode(fmat.renderInfo.get('gsys_color_blend_rgb_op')!),
                    blendSrcFactor: translateRenderInfoBlendFactor(fmat.renderInfo.get('gsys_color_blend_rgb_src_func')!),
                    blendDstFactor: translateRenderInfoBlendFactor(fmat.renderInfo.get('gsys_color_blend_rgb_dst_func')!),
                },
                alphaBlendState: {
                    blendMode: getRenderInfoBlendMode(fmat.renderInfo.get('gsys_color_blend_alpha_op')!),
                    blendSrcFactor: translateRenderInfoBlendFactor(fmat.renderInfo.get('gsys_color_blend_alpha_src_func')!),
                    blendDstFactor: translateRenderInfoBlendFactor(fmat.renderInfo.get('gsys_color_blend_alpha_dst_func')!),
                },
            }];
        } else if (blendMode === 'none') {
            // Nothing.
        } else {
            throw "whoops";
        }

        this.inOpaquePass = !isTranslucent;
        this.inTranslucentPass = isTranslucent;

        const dynamic_depth_shadow = getRenderInfoBoolean(fmat.renderInfo.get('gsys_dynamic_depth_shadow')!);
        const dynamic_depth_shadow_only = getRenderInfoBoolean(fmat.renderInfo.get('gsys_dynamic_depth_shadow_only')!);

        const static_depth_shadow = getRenderInfoBoolean(fmat.renderInfo.get('gsys_static_depth_shadow')!);
        const static_depth_shadow_only = getRenderInfoBoolean(fmat.renderInfo.get('gsys_static_depth_shadow_only')!);

        if (dynamic_depth_shadow || static_depth_shadow) {
            this.inShadowMap = true;
        }

        if (dynamic_depth_shadow_only || static_depth_shadow_only) {
            this.inShadowMap = true;
            this.inOpaquePass = false;
            this.inTranslucentPass = false;
        }

        const cube_map_only = getRenderInfoBoolean(fmat.renderInfo.get('gsys_cube_map_only')!);
        if (cube_map_only) {
            this.inOpaquePass = false;
            this.inTranslucentPass = false;
        }

        // Hacks!
        if (fmat.name.startsWith('CausticsArea')) {
            this.inOpaquePass = false;
            this.inTranslucentPass = false;
        }

        parseFMAT_ShaderParam_Float4(this.texCoordBake0ScaleBias, findShaderParam(fmat, 'gsys_bake_st0'));
        parseFMAT_ShaderParam_Float4(this.texCoordBake1ScaleBias, findShaderParam(fmat, 'gsys_bake_st1'));

        parseFMAT_ShaderParam_Color3(this.albedoColor, findShaderParam(fmat, 'albedo_tex_color'));
        parseFMAT_ShaderParam_Color3(this.emissionColor, findShaderParam(fmat, 'emission_color'));
        this.emissionIntensity = parseFMAT_ShaderParam_Float(findShaderParam(fmat, 'emission_intensity'));
    }

    public setOnRenderInst(globals: TurboRenderGlobals, renderInst: GfxRenderInst): void {
        const isTranslucent = this.program.isTranslucent;
        const materialLayer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        renderInst.sortKey = makeSortKey(materialLayer, 0);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(TurboUBER.ub_MaterialParams, 16 + 3*4*TurboUBER.NumEnvLightParams);
        const d = renderInst.mapUniformBufferF32(TurboUBER.ub_MaterialParams);
        offs += fillVec4v(d, offs, this.texCoordBake0ScaleBias);
        offs += fillVec4v(d, offs, this.texCoordBake1ScaleBias);
        offs += fillColor(d, offs, this.albedoColor);
        colorScale(scratchColor, this.emissionColor, this.emissionIntensity);
        offs += fillColor(d, offs, scratchColor);

        const lightEnv = globals.lightEnv;
        const lmap = lightEnv.findLightMap(getRenderInfoSingleString(this.fmat.renderInfo.get('gsys_light_diffuse')!));
        offs += lightEnv.fillEnvLightParamsForMap(d, offs, lmap, TurboUBER.NumEnvLightParams);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

function translateAttributeFormat(attributeFormat: AttributeFormat): GfxFormat {
    switch (attributeFormat) {
    case AttributeFormat._8_8_Unorm:
        return GfxFormat.U8_RG_NORM;
    case AttributeFormat._8_8_Snorm:
        return GfxFormat.S8_RG_NORM;
    case AttributeFormat._8_8_Uint:
        return GfxFormat.U32_RG;
    case AttributeFormat._8_8_8_8_Unorm:
        return GfxFormat.U8_RGBA_NORM;
    case AttributeFormat._8_8_8_8_Snorm:
        return GfxFormat.S8_RGBA_NORM;
    case AttributeFormat._16_16_Unorm:
        return GfxFormat.U16_RG_NORM;
    case AttributeFormat._16_16_Snorm:
        return GfxFormat.S16_RG_NORM;
    case AttributeFormat._16_16_Float:
        return GfxFormat.F16_RG;
    case AttributeFormat._16_16_16_16_Float:
        return GfxFormat.F16_RGBA;
    case AttributeFormat._32_32_Float:
        return GfxFormat.F32_RG;
    case AttributeFormat._32_32_32_Float:
        return GfxFormat.F32_RGB;
    default:
        console.error(getChannelFormat(attributeFormat), getTypeFormat(attributeFormat));
        throw "whoops";
    }
}

interface ConvertedVertexAttribute {
    format: GfxFormat;
    data: ArrayBufferLike;
    stride: number;
}

class FVTXData {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public inputBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        let nextBufferIndex = fvtx.vertexBuffers.length;

        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const vertexAttribute = fvtx.vertexAttributes[i];
            const attribLocation = TurboUBER.a_Orders.indexOf(vertexAttribute.name);
            if (attribLocation < 0)
                continue;

            const bufferIndex = vertexAttribute.bufferIndex;
            const vertexBuffer = fvtx.vertexBuffers[bufferIndex];
            const convertedAttribute = this.convertVertexAttribute(vertexAttribute, vertexBuffer);
            if (convertedAttribute !== null) {
                const attribBufferIndex = nextBufferIndex++;

                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: convertedAttribute.format,
                    bufferIndex: attribBufferIndex,
                    // When we convert the buffer we remove the byte offset.
                    bufferByteOffset: 0,
                });

                this.inputBufferDescriptors[attribBufferIndex] = {
                    byteStride: convertedAttribute.stride,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                };

                const gfxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, convertedAttribute.data);
                this.vertexBufferDescriptors[attribBufferIndex] = {
                    buffer: gfxBuffer,
                    byteOffset: 0,
                };
            } else {
                // Can use buffer data directly.
                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: translateAttributeFormat(vertexAttribute.format),
                    bufferIndex: bufferIndex,
                    bufferByteOffset: vertexAttribute.offset,
                });

                if (!this.vertexBufferDescriptors[bufferIndex]) {
                    const gfxBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, vertexBuffer.data);

                    this.inputBufferDescriptors[bufferIndex] = {
                        byteStride: vertexBuffer.stride,
                        frequency: GfxVertexBufferFrequency.PerVertex,
                    };

                    this.vertexBufferDescriptors[bufferIndex] = {
                        buffer: gfxBuffer,
                        byteOffset: 0,
                    };
                }
            }
        }
    }

    public convertVertexAttribute(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute | null {
        switch (vertexAttribute.format) {
        case AttributeFormat._10_10_10_2_Snorm:
            return this.convertVertexAttribute_10_10_10_2_Snorm(vertexAttribute, vertexBuffer);
        default:
            return null;
        }
    }

    public convertVertexAttribute_10_10_10_2_Snorm(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute {
        function signExtend10(n: number): number {
            return (n << 22) >> 22;
        }

        const numElements = vertexBuffer.data.byteLength / vertexBuffer.stride;
        const format = GfxFormat.S16_RGBA_NORM;
        const out = new Int16Array(numElements * 4);
        const stride = out.BYTES_PER_ELEMENT * 4;
        let dst = 0;
        let offs = vertexAttribute.offset;
        const view = vertexBuffer.data.createDataView();
        for (let i = 0; i < numElements; i++) {
            const n = view.getUint32(offs, true);
            out[dst++] = signExtend10((n >>>  0) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 10) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 20) & 0x3FF) << 4;
            out[dst++] = ((n >>> 30) & 0x03) << 14;
            offs += vertexBuffer.stride;
        }

        return { format, data: out.buffer, stride };
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexBufferDescriptors.length; i++)
            if (this.vertexBufferDescriptors[i])
                device.destroyBuffer(this.vertexBufferDescriptors[i].buffer);
    }
}

function translateIndexFormat(indexFormat: IndexFormat): GfxFormat {
    switch (indexFormat) {
    case IndexFormat.Uint8:  return GfxFormat.U8_R;
    case IndexFormat.Uint16: return GfxFormat.U16_R;
    case IndexFormat.Uint32: return GfxFormat.U32_R;
    default: throw "whoops";
    }
}

export class FSHPMeshData {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public mesh: FSHP_Mesh, fvtxData: FVTXData) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = device.createInputLayout({
            indexBufferFormat,
            vertexAttributeDescriptors: fvtxData.vertexAttributeDescriptors,
            vertexBufferDescriptors: fvtxData.inputBufferDescriptors,
        });
    
        this.indexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Index, mesh.indexBufferData);
        const indexBufferDescriptor: GfxIndexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, fvtxData.vertexBufferDescriptors, indexBufferDescriptor);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class FSHPData {
    public meshData: FSHPMeshData[] = [];

    constructor(device: GfxDevice, public fshp: FSHP, fvtxData: FVTXData) {
        for (let i = 0; i < fshp.mesh.length; i++)
            this.meshData.push(new FSHPMeshData(device, fshp.mesh[i], fvtxData));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshData.length; i++)
            this.meshData[i].destroy(device);
    }
}

export class FMDLData {
    public fvtxData: FVTXData[] = [];
    public fshpData: FSHPData[] = [];

    constructor(device: GfxDevice, public fmdl: FMDL) {
        for (let i = 0; i < fmdl.fvtx.length; i++)
            this.fvtxData.push(new FVTXData(device, fmdl.fvtx[i]));
        for (let i = 0; i < fmdl.fshp.length; i++) {
            const fshp = fmdl.fshp[i];
            this.fshpData.push(new FSHPData(device, fshp, this.fvtxData[fshp.vertexIndex]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.fvtxData.length; i++)
            this.fvtxData[i].destroy(device);
        for (let i = 0; i < this.fshpData.length; i++)
            this.fshpData[i].destroy(device);
    }
}

class FSHPMeshInstance {
    constructor(public meshData: FSHPMeshData) {
        assert(this.meshData.mesh.offset === 0);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        // TODO(jstpierre): Do we have to care about submeshes?
        const renderInst = renderInstManager.newRenderInst();
        renderInst.drawIndexes(this.meshData.mesh.count);
        renderInst.setInputLayoutAndState(this.meshData.inputLayout, this.meshData.inputState);

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.meshData.mesh.bbox);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchMatrix = mat4.create();
const bboxScratch = new AABB();
class FSHPInstance {
    private lodMeshInstances: FSHPMeshInstance[] = [];
    public visible = true;

    constructor(public fshpData: FSHPData, private fmatInstance: FMATInstance) {
        // Only construct the first LOD mesh for now.
        for (let i = 0; i < 1; i++)
            this.lodMeshInstances.push(new FSHPMeshInstance(fshpData.meshData[i]));
    }

    public computeModelView(modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): mat4 {
        // Build view matrix
        const viewMatrix = scratchMatrix;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(globals: TurboRenderGlobals, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (!(this.fmatInstance.inOpaquePass || this.fmatInstance.inTranslucentPass))
            return;

        // TODO(jstpierre): Joints.
        // TODO(jstpierre): This should probably be global, not per-shape.

        const template = renderInstManager.pushTemplateRenderInst();
        let offs = template.allocateUniformBuffer(TurboUBER.ub_SceneParams, 16+12);
        const d = template.mapUniformBufferF32(TurboUBER.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(d, offs, this.computeModelView(modelMatrix, viewerInput));

        this.fmatInstance.setOnRenderInst(globals, template);

        for (let i = 0; i < this.lodMeshInstances.length; i++) {
            bboxScratch.transform(this.lodMeshInstances[i].meshData.mesh.bbox, modelMatrix);
            if (!viewerInput.camera.frustum.contains(bboxScratch))
                continue;

            this.lodMeshInstances[i].prepareToRender(renderInstManager, viewerInput);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 9 },
];

export class FMDLRenderer {
    public fmatInst: FMATInstance[] = [];
    public fshpInst: FSHPInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, cache: GfxRenderCache, public textureHolder: BRTITextureHolder, public fmdlData: FMDLData) {
        const fmdl = this.fmdlData.fmdl;
        this.name = fmdl.name;

        for (let i = 0; i < fmdl.fmat.length; i++)
            this.fmatInst.push(new FMATInstance(device, cache, this.textureHolder, fmdl.fmat[i]));

        for (let i = 0; i < this.fmdlData.fshpData.length; i++) {
            const fshpData = this.fmdlData.fshpData[i];
            const fmatInstance = this.fmatInst[fshpData.fshp.materialIndex];
            this.fshpInst.push(new FSHPInstance(fshpData, fmatInstance));
        }
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(globals: TurboRenderGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        for (let i = 0; i < this.fshpInst.length; i++)
            this.fshpInst[i].prepareToRender(globals, renderInstManager, this.modelMatrix, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.fmatInst.length; i++)
            this.fmatInst[i].destroy(device);
    }
}

const scratchColor = colorNewCopy(White);
export class TurboLightEnv {
    private aglenv: AGLEnv.AGLEnv;
    private agllmap: AGLLightMap.AGLLightMap;
    private useEnvLights = true;
    private lightIntensityScale = 1.0;
    private directionalIsWrapped = false;
    private hemisphereIsWrapped = true;

    constructor(bgenvBuffer: ArrayBufferSlice) {
        const bgenv = SARC.parse(bgenvBuffer);
        this.aglenv = AGLEnv.parse(assertExists(bgenv.files.find((p) => p.name.endsWith('course_area.baglenv'))).buffer);

        const bagllmap = bgenv.files.find((p) => p.name.endsWith('.bagllmap'));
        if (bagllmap !== undefined) {
            this.agllmap = AGLLightMap.parse(bagllmap.buffer);
        } else {
            // Create a dummy lightmap.
            const lmap: AGLLightMap.LightMap[] = [{
                name: 'diffuse_course0',
                env_obj_ref_array: [
                    { type: 'DirectionalLight', name: 'MainLight0', enable_mip0: true, enable_mip1: false, pow: 1.0, pow_mip_max: 1.0, effect: 1.0, calc_type: 0, lut_name: 'Lambert' },
                    { type: 'HemisphereLight', name: 'HemiLight_chara0', enable_mip0: true, enable_mip1: false, pow: 1.0, pow_mip_max: 1.0, effect: 1.0, calc_type: 0, lut_name: 'Lambert' },
                ],
            }];
            this.agllmap = { lmap };
        }
    }

    public findLightMap(name: string): AGLLightMap.LightMap {
        return this.agllmap.lmap.find((lmap) => lmap.name === name)!;
    }

    private fillEnvLightParamsForLightEnvObj(d: Float32Array, offs: number, lightEnvObj: AGLLightMap.LightEnvObject): number | null {
        let baseOffs = offs;

        // Nothing to do.
        if (lightEnvObj.name === '')
            return null;

        // mip0 = lit, mip1 = unlit

        if (!lightEnvObj.enable_mip0) {
            assert(!lightEnvObj.enable_mip1);
            return null;
        }

        if (!this.useEnvLights)
            return null;

        const visibleInShadow = lightEnvObj.enable_mip1;

        if (lightEnvObj.type === 'AmbientLight') {
            // TODO(jstpierre): Fill this in
            return null;
        } else if (lightEnvObj.type === 'DirectionalLight') {
            const dirLight = assertExists(this.aglenv.DirectionalLight.find((obj) => obj.name === lightEnvObj.name));
            colorScale(scratchColor, dirLight.BacksideColor, dirLight.Intensity * this.lightIntensityScale);
            const wrapped = this.directionalIsWrapped;
            scratchColor.a = wrapped ? 1.0 : 0.0;
            offs += fillColor(d, offs, scratchColor);
            colorScale(scratchColor, dirLight.DiffuseColor, dirLight.Intensity * this.lightIntensityScale);
            scratchColor.a = visibleInShadow ? 1.0 : 0.0;
            offs += fillColor(d, offs, scratchColor);
            offs += fillVec3v(d, offs, dirLight.Direction);
        } else if (lightEnvObj.type === 'HemisphereLight') {
            const hemiLight = assertExists(this.aglenv.HemisphereLight.find((obj) => obj.name === lightEnvObj.name));
            colorScale(scratchColor, hemiLight.GroundColor, hemiLight.Intensity * this.lightIntensityScale);
            const wrapped = this.hemisphereIsWrapped;
            scratchColor.a = wrapped ? 1.0 : 0.0;
            offs += fillColor(d, offs, scratchColor);
            colorScale(scratchColor, hemiLight.SkyColor, hemiLight.Intensity * this.lightIntensityScale);
            scratchColor.a = visibleInShadow ? 1.0 : 0.0;
            offs += fillColor(d, offs, scratchColor);
            offs += fillVec3v(d, offs, hemiLight.Direction);
        } else {
            throw "whoops";
        }

        return offs - baseOffs;
    }

    public fillEnvLightParamsForMap(d: Float32Array, offs: number, lightMap: AGLLightMap.LightMap, numLights: number): number {
        const baseOffs = offs;
        for (let i = 0; i < lightMap.env_obj_ref_array.length; i++) {
            const filled = this.fillEnvLightParamsForLightEnvObj(d, offs, lightMap.env_obj_ref_array[i]);
            if (filled === null)
                continue;
            offs += filled;

            if (numLights-- === 0)
                break;
        }

        for (let i = 0; i < numLights; i++) {
            offs += fillColor(d, offs, OpaqueBlack);
            offs += fillVec3v(d, offs, Vec3Zero);
        }

        return offs - baseOffs;
    }
}

export class TurboRenderGlobals {
    public lightEnv: TurboLightEnv;
    public textureHolder: BRTITextureHolder;

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
    }
}

export class TurboRenderer {
    public renderHelper: GfxRenderHelper;
    public fmdlRenderers: FMDLRenderer[] = [];

    constructor(device: GfxDevice, public globals: TurboRenderGlobals) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.fmdlRenderers);
        return [layersPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].prepareToRender(this.globals, renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

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
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].destroy(device);
        this.globals.destroy(device);
    }
}

