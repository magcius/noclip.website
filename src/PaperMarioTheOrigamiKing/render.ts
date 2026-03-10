import * as Viewer from '../viewer.js';
import * as BNTX from "../fres_nx/bntx.js";
import * as Decoder from "tex-decoder";
import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { MathConstants } from '../MathHelpers.js';
import { computeViewSpaceDepthFromWorldSpaceAABB, computeViewMatrix } from '../Camera.js';
import { FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FMDL, FSHP, FSHP_Mesh, FSKL_Bone, FVTX, FVTX_VertexAttribute, FVTX_VertexBuffer, parseFMAT_ShaderParam_Float, parseFMAT_ShaderParam_Texsrt } from '../fres_nx/bfres.js';
import { AttributeFormat, ChannelFormat, ChannelSource, FilterMode, getChannelFormat, getTypeFormat, IndexFormat, TextureAddressMode, TypeFormat } from '../fres_nx/nngfx_enum.js';
import { decompress, deswizzle, getImageFormatString } from '../fres_nx/tegra_texture.js';
import { createBufferFromData, createBufferFromSlice } from '../gfx/helpers/BufferHelpers.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { DeviceProgram } from '../Program.js';
import { TextureHolder, TextureMapping } from '../TextureHolder.js';
import { assert, assertExists, nArray } from '../util.js';
import { ResourceSystem } from './scenes.js';

function translateImageFormat(channelFormat: ChannelFormat, typeFormat: TypeFormat): GfxFormat {
    switch (typeFormat) {
        case TypeFormat.Unorm:
            return GfxFormat.U8_RGBA_NORM;
        case TypeFormat.UnormSrgb:
            return GfxFormat.U8_RGBA_SRGB;
        case TypeFormat.Snorm:
            return GfxFormat.S8_RGBA_NORM;
        case TypeFormat.Float:
            return GfxFormat.F16_RGBA;
        default:
            throw `Unknown type format of ${typeFormat} (non-BC channel)`;
    }
    // if (channelFormat <= ChannelFormat.Bc7 && channelFormat >= ChannelFormat.Bc1) {
    //     switch (typeFormat) {
    //         case TypeFormat.Unorm:
    //             switch (channelFormat) {
    //                 case ChannelFormat.Bc1:
    //                     return GfxFormat.BC1;
    //                 case ChannelFormat.Bc2:
    //                     return GfxFormat.BC2;
    //                 case ChannelFormat.Bc3:
    //                     return GfxFormat.BC3;
    //                 case ChannelFormat.Bc4:
    //                     return GfxFormat.BC4_UNORM;
    //                 case ChannelFormat.Bc5:
    //                     return GfxFormat.BC5_UNORM;
    //                 case ChannelFormat.Bc7:
    //                     return GfxFormat.BC7;
    //                 default:
    //                     throw `Unknown channel/type formats of ${channelFormat} & ${typeFormat}`;
    //             }
    //         case TypeFormat.Snorm:
    //             switch (channelFormat) {
    //                 case ChannelFormat.Bc4:
    //                     return GfxFormat.BC4_SNORM;
    //                 case ChannelFormat.Bc5:
    //                     return GfxFormat.BC5_SNORM;
    //                 default:
    //                     throw `Unknown channel/type formats of ${channelFormat} & ${typeFormat}`;
    //             }
    //         case TypeFormat.Float:
    //             switch (channelFormat) {
    //                 case ChannelFormat.Bc6: // not tested, could be Snorm instead of Float
    //                     return GfxFormat.BC6H_SNORM;
    //                 default:
    //                     throw `Unknown channel/type formats of ${channelFormat} & ${typeFormat}`;
    //             }
    //         case TypeFormat.Ufloat:
    //             switch (channelFormat) {
    //                 case ChannelFormat.Bc6:
    //                     return GfxFormat.BC6H_UNORM;
    //                 default:
    //                     throw `Unknown channel/type formats of ${channelFormat} & ${typeFormat}`;
    //             }
    //         case TypeFormat.UnormSrgb:
    //             switch (channelFormat) {
    //                 case ChannelFormat.Bc1:
    //                     return GfxFormat.BC1_SRGB;
    //                 case ChannelFormat.Bc2:
    //                     return GfxFormat.BC2_SRGB;
    //                 case ChannelFormat.Bc3:
    //                     return GfxFormat.BC3_SRGB;
    //                 case ChannelFormat.Bc7:
    //                     return GfxFormat.BC7_SRGB;
    //                 default:
    //                     throw `Unknown channel/type formats of ${channelFormat} & ${typeFormat}`;
    //             }
    //         default:
    //             throw `Unknown type format of ${typeFormat} (BC channel)`;
    //     }
    // } else {
    //     switch (typeFormat) {
    //         case TypeFormat.Unorm:
    //             return GfxFormat.U8_RGBA_NORM;
    //         case TypeFormat.UnormSrgb:
    //             return GfxFormat.U8_RGBA_SRGB;
    //         case TypeFormat.Snorm:
    //             return GfxFormat.S8_RGBA_NORM;
    //         case TypeFormat.Float:
    //             return GfxFormat.F16_RGBA;
    //         default:
    //             throw `Unknown type format of ${typeFormat} (non-BC channel)`;
    //     }
    // }
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
            return GfxWrapMode.Mirror;
        default:
            throw `Unknown texture address mode ${addrMode}`;
    }
}

function translateMipFilterMode(filterMode: FilterMode): GfxMipFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxMipFilterMode.Linear;
        case 0:
        case FilterMode.Point:
            return GfxMipFilterMode.Nearest;
        default:
            throw `Unknown mip filter mode ${filterMode}`;
    }
}

function translateTexFilterMode(filterMode: FilterMode): GfxTexFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxTexFilterMode.Bilinear;
        case FilterMode.Point:
            return GfxTexFilterMode.Point;
        default:
            throw `Unknown tex filter mode ${filterMode}`;
    }
}

function translateRenderInfoSingleString(renderInfo: FMAT_RenderInfo): string {
    assert(renderInfo.type === FMAT_RenderInfoType.String && renderInfo.values.length === 1);
    return renderInfo.values[0] as string;
}

function translateCullMode(material: FMAT): GfxCullMode {
    const cullValue = material.renderInfo.get('culling');
    if (!cullValue) {
        return GfxCullMode.None;
    }
    const cullMode = translateRenderInfoSingleString(cullValue);
    if (cullMode === 'front') {
        return GfxCullMode.Front;
    } else if (cullMode === 'back') {
        return GfxCullMode.Back;
    } else if (cullMode === 'none') {
        return GfxCullMode.None;
    } else {
        throw `Unknown cull mode ${cullMode}`;
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
        case AttributeFormat._10_10_10_2_Snorm:
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
            throw `Unknown attribute format ${attributeFormat}`;
    }
}

function translateIndexFormat(indexFormat: IndexFormat): GfxFormat {
    switch (indexFormat) {
        case IndexFormat.Uint8:
            return GfxFormat.U8_R;
        case IndexFormat.Uint16:
            return GfxFormat.U16_R;
        case IndexFormat.Uint32:
            return GfxFormat.U32_R;
        default:
            throw `Unknown index format ${indexFormat}`;
    }
}

function getChannelSourceString(channelSources: ChannelSource[]): string {
    let s = "";
    const keys = ["R", "G", "B", "A"];
    for (let i = 0; i < channelSources.length; i++) {
        s += keys[i] + "->";
        switch (channelSources[i]) {
            case ChannelSource.Zero:
                s += "0"; break;
            case ChannelSource.One:
                s += "1"; break;
            case ChannelSource.Red:
                s += "R"; break;
            case ChannelSource.Green:
                s += "G"; break;
            case ChannelSource.Blue:
                s += "B"; break;
            case ChannelSource.Alpha:
                s += "A"; break;
        }
        s += ", ";
    }
    return s.slice(0, s.length - 2);
}

enum TexSRTMode {
    Maya, Max, XSI
}

interface ConvertedVertexAttribute {
    format: GfxFormat;
    data: ArrayBufferLike;
    stride: number;
}

const SCRATCH_MATRIX = mat4.create();
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 5 }];

export class PMTOKTextureHolder extends TextureHolder {
    public addBNTXFile(device: GfxDevice, buffer: ArrayBufferSlice): void {
        const bntx = BNTX.parse(buffer);
        for (let i = 0; i < bntx.textures.length; i++) {
            this.addTexture(device, bntx.textures[i]);
        }
    }

    public addTexture(device: GfxDevice, textureEntry: BNTX.BRTI): void {
        if (this.textureNames.includes(textureEntry.name)) {
            return;
        }

        const channelFormat = getChannelFormat(textureEntry.imageFormat);
        const typeFormat = getTypeFormat(textureEntry.imageFormat);
        const gfxFormat = translateImageFormat(channelFormat, typeFormat);
        const mips = textureEntry.textureDataArray[0].mipBuffers.length;

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(gfxFormat, textureEntry.width, textureEntry.height, mips));
        for (let mipLevel = 0; mipLevel < mips; mipLevel++) {
            const buffer = textureEntry.textureDataArray[0].mipBuffers[mipLevel];
            const width = Math.max(textureEntry.width >>> mipLevel, 1);
            const height = Math.max(textureEntry.height >>> mipLevel, 1);
            const depth = 1;
            const blockHeightLog2 = textureEntry.blockHeightLog2;
            deswizzle({ buffer, width, height, channelFormat, blockHeightLog2 }).then(async (deswizzled) => {
                // would love to not decompress so loading is much less CPU-intensive (i.e. rgbaPixels = deswizzled)
                // even with a high-spec system it takes at least 10 seconds to decompress, or up to a minute for bigger levels
                // ASTC's WebGL extension is not available and BC's doesn't work consistently (the deswizzled length is sometimes incorrect, don't know how to handle this)
                let rgbaPixels;
                switch (channelFormat) {
                    case ChannelFormat.Bc3:
                        rgbaPixels = Decoder.decodeBC3(deswizzled, width, height);
                        break;
                    case ChannelFormat.Bc6:
                        if (typeFormat === TypeFormat.Ufloat) {
                            rgbaPixels = Decoder.decodeBC6H(deswizzled, width, height);
                        } else if (typeFormat === TypeFormat.Float) {
                            rgbaPixels = Decoder.decodeBC6S(deswizzled, width, height);
                        } else {
                            throw `Unknown type format ${typeFormat} for BC6`;
                        }
                        break;
                    case ChannelFormat.Bc7:
                        rgbaPixels = Decoder.decodeBC7(deswizzled, width, height);
                        break;
                    case ChannelFormat.Astc_8x8: // doesn't exactly match appearance in Switch Toolbox, not sure if this is incorrect or toolbox is wrong
                        rgbaPixels = Decoder.decodeASTC_8x8(deswizzled, width, height);
                        break;
                    default: // BC1/2/4/5 doesn't work for some reason with tex-decoder, default to existing decompression
                        rgbaPixels = decompress({ ...textureEntry, width, height, depth }, deswizzled).pixels;
                        break;
                }
                device.uploadTextureData(gfxTexture, mipLevel, [rgbaPixels]);
            });
        }

        const extraInfo = new Map<string, string>();
        extraInfo.set("Format", getImageFormatString(textureEntry.imageFormat));
        extraInfo.set("Channels", getChannelSourceString(textureEntry.channelSource));

        const viewerTexture: Viewer.Texture = { gfxTexture, extraInfo };
        this.gfxTextures.push(gfxTexture);
        this.viewerTextures.push(viewerTexture);
        this.textureNames.push(textureEntry.name);
    }
}

class OrigamiProgram extends DeviceProgram {
    private a_Sizes = [3, 4, 4, 4, 2, 2];
    public static a_Orders = ["_p0", "_n0", "_t0", "_b0", "_u0", "_u1"];
    public static s_Orders = ["_a0", "_d0", "_l0", "_m0", "_n0"];
    public static ub_ShapeParams = 0;
    public static ub_MaterialParams = 1;

    constructor(public fmat: FMAT) {
        super();
        this.name = this.fmat.name;
        assert(this.fmat.samplerInfo.length <= 8);
        this.frag = this.generateFrag();
    }

    private getVertLayoutDefs(): string {
        assert(this.a_Sizes.length === OrigamiProgram.a_Orders.length);
        let s = "";
        for (let i = 0; i < this.a_Sizes.length; i++) {
            const a = OrigamiProgram.a_Orders[i];
            s += `layout(location = ${i}) in vec${this.a_Sizes[i]} ${a};\n`;
        }
        return s;
    }

    public getShaderOptionNumber(optionName: string): number {
        const optionValue = assertExists(this.fmat.shaderAssign.shaderOption.get(optionName));
        return +optionValue;
    }

    public getShaderOptionBoolean(optionName: string, dneValue: boolean = false): boolean {
        const optionValue = this.fmat.shaderAssign.shaderOption.get(optionName);
        if (optionValue === undefined) {
            return dneValue;
        }
        assert(optionValue === "0" || optionValue === "1");
        return optionValue === "1";
    }

    public static globalDefinitions = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat4x4 u_Shift;
    Mat3x4 u_ModelView;
};

layout(std140) uniform ub_MaterialParams {
    Mat2x4 u_TexCoordSRT0;
    // Mat2x4 u_TexCoordSRT1;
    // Mat2x4 u_TexCoordSRT2;
    vec4 u_Floats; // x=glossiness, y=alphaRef, z=yFlip, w=whiteBack
    // vec4 u_PaperColor;
};

uniform sampler2D u_TextureAlbedo;     // _a0
uniform sampler2D u_TextureDepth;      // _d0
uniform sampler2D u_TextureLight;      // _l0
uniform sampler2D u_TextureMaterial;   // _m0
uniform sampler2D u_TextureNormal;     // _n0
`;

    public override both = OrigamiProgram.globalDefinitions;

    public override vert = `
${this.getVertLayoutDefs()}

out vec3 v_PositionWorld;
out vec4 v_NormalWorld;
out vec4 v_TangentWorld;
out vec4 v_BitangentWorld;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec4 v_Floats;
// out vec4 v_PaperColor;

void main() {
    vec3 t_PositionView = UnpackMatrix(u_ModelView) * UnpackMatrix(u_Shift) * vec4(_p0, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_PositionWorld = _p0;
    v_NormalWorld = _n0;
    v_TangentWorld = _t0;
    v_BitangentWorld = _b0;
    v_TexCoord0 = UnpackMatrix(u_TexCoordSRT0) * vec4(_u0, 1.0, 1.0); // srt needed?
    v_TexCoord1 = _u1;
    v_Floats = u_Floats;
    // v_PaperColor = u_PaperColor;
}
`;

    public generateFrag() {
        return `
precision highp float;

in vec3 v_PositionWorld;
in vec4 v_NormalWorld;
in vec4 v_TangentWorld;
in vec4 v_BitangentWorld;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;
in vec4 v_Floats;
in vec4 v_PaperColor;

void main() {
    vec4 albedo = texture(SAMPLER_2D(u_TextureAlbedo), v_TexCoord0);
    vec4 color = albedo;

    ${this.getShaderOptionBoolean('alpha_test') ? `
    if (albedo.a < v_Floats.y) {
        discard;
    }` : ``}

    ${this.getShaderOptionBoolean('use_normal_map') ? `
    // adapted from Odyssey's shader
    vec3 t_LocalNormal = vec3(texture(SAMPLER_2D(u_TextureNormal), v_TexCoord0).rg, 0);
    t_LocalNormal.z = sqrt(clamp(1.0 - t_LocalNormal.x*t_LocalNormal.x - t_LocalNormal.y*t_LocalNormal.y, 0.0, 1.0));
    vec3 t_NormalDir = (t_LocalNormal.x * normalize(v_TangentWorld.xyz) + t_LocalNormal.y * normalize(v_BitangentWorld.xyz) + t_LocalNormal.z * v_NormalWorld.xyz);
    vec3 t_LightDir = normalize(vec3(-0.5, -0.5, -1));
    float t_LightIntensity = clamp(dot(t_LightDir, -t_NormalDir), 0.0, 1.0);
    t_LightIntensity = mix(0.6, 1.0, t_LightIntensity);
    color.rgb *= t_LightIntensity;
    ` : ''}

    float finalShadow = 1.0;
    ${/* The shader code is correct but texture quality is horrible since ASTC is lossy (and has to be decompressed).
    Unsure if there's a workaround for this... ASTC's WebGL extension is not supported on 99% of PCs
    https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc */
    this.getShaderOptionBoolean('use_bakeshadow_map') ? `
    finalShadow = mix(1.0, texture(SAMPLER_2D(u_TextureMaterial), v_TexCoord1).r, 0.7); // 0.7 is subjective intensity
    ` : ''}

    color.rgb *= finalShadow;
    color.rgb = pow(color.rgb, vec3(1.0 / 2.2)); // base gama boost
    gl_FragColor = vec4(color.rgb, color.a);
}
`;
    }
}

class TexSRT {
    public mode = TexSRTMode.Maya; // seems to always be Maya
    public scaleS = 1.0;
    public scaleT = 1.0;
    public rotation = 0.0;
    public translationS = 0.0;
    public translationT = 0.0;

    public calc(dst: mat4): void {
        const theta = this.rotation * MathConstants.DEG_TO_RAD;
        const sinR = Math.sin(theta);
        const cosR = Math.cos(theta);
        mat4.identity(dst);
        dst[0] = this.scaleS * cosR;
        dst[4] = this.scaleS * sinR;
        dst[12] = this.scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - this.translationS);
        dst[1] = this.scaleT * -sinR;
        dst[5] = this.scaleT * cosR;
        dst[13] = this.scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + this.translationT) + 1.0;
    }

    public fillMatrix(d: Float32Array, offs: number): number {
        this.calc(SCRATCH_MATRIX);
        return fillMatrix4x2(d, offs, SCRATCH_MATRIX);
    }
}

class MaterialInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    private program: OrigamiProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private texCoordSRT0 = new TexSRT();
    // private texCoordSRT1 = new TexSRT();
    // private texCoordSRT2 = new TexSRT();
    private glossiness = 0.0;
    private alphaRef = 1.0;
    private yFlip = 0.0;
    private whiteBack = 0.0;
    // private paperColor: vec4 = [1.0, 1.0, 1.0, 1.0];

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: PMTOKTextureHolder, public fmat: FMAT) {
        this.program = new OrigamiProgram(fmat);

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

        assert(fmat.samplerInfo.length === fmat.textureName.length);
        this.textureMapping = nArray(OrigamiProgram.s_Orders.length, () => new TextureMapping());
        for (const [shaderSamplerName, samplerName] of fmat.shaderAssign.samplerAssign.entries()) {
            const samplerIndex = fmat.samplerInfo.findIndex((samplerInfo) => samplerInfo.name === samplerName);
            const shaderSamplerIndex = OrigamiProgram.s_Orders.indexOf(shaderSamplerName);
            if (shaderSamplerIndex < 0) {
                assert(false);
            }
            assert(samplerIndex >= 0 && shaderSamplerIndex >= 0);
            const shaderMapping = this.textureMapping[shaderSamplerIndex];
            textureHolder.fillTextureMapping(shaderMapping, fmat.textureName[samplerIndex]);
            shaderMapping.gfxSampler = this.gfxSamplers[samplerIndex];
        }

        this.gfxProgram = cache.createProgram(this.program);

        this.megaStateFlags = {
            cullMode: translateCullMode(fmat),
            // depthCompare: translateDepthCompare(fmat),
            // depthWrite: true,
        };
        // setAttachmentStateSimple(this.megaStateFlags, {
        //     blendMode: GfxBlendMode.Add,
        //     blendSrcFactor: GfxBlendFactor.One,
        //     blendDstFactor: GfxBlendFactor.Zero,
        // });

        const srt0 = fmat.shaderParam.find((p) => p.name === "texsrt0");
        // const srt1 = fmat.shaderParam.find((p) => p.name === "texsrt1");
        // const srt2 = fmat.shaderParam.find((p) => p.name === "texsrt2");
        const glossiness = fmat.shaderParam.find((p) => p.name === "glossiness");
        const alphaRef = fmat.shaderParam.find((p) => p.name === "alpha_ref");
        const yFlip = fmat.shaderParam.find((p) => p.name === "yflip");
        const whiteBack = fmat.shaderParam.find((p) => p.name === "white_back");
        // const paperColor = fmat.shaderParam.find((p) => p.name === "paper_color");
        if (srt0) parseFMAT_ShaderParam_Texsrt(this.texCoordSRT0, srt0);
        // if (srt1) parseFMAT_ShaderParam_Texsrt(this.texCoordSRT1, srt1);
        // if (srt2) parseFMAT_ShaderParam_Texsrt(this.texCoordSRT2, srt2);
        if (glossiness) this.glossiness = parseFMAT_ShaderParam_Float(glossiness);
        if (alphaRef) this.alphaRef = parseFMAT_ShaderParam_Float(alphaRef);
        if (yFlip) this.yFlip = parseFMAT_ShaderParam_Float(yFlip);
        if (whiteBack) this.whiteBack = parseFMAT_ShaderParam_Float(whiteBack);
        // if (paperColor) parseFMAT_ShaderParam_Float4(this.paperColor, paperColor);
    }

    public setOnRenderInst(device: GfxDevice, renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(OrigamiProgram.ub_MaterialParams, 12);
        const d = renderInst.mapUniformBufferF32(OrigamiProgram.ub_MaterialParams);
        offs += this.texCoordSRT0.fillMatrix(d, offs);
        // offs += this.texCoordSRT1.fillMatrix(d, offs);
        // offs += this.texCoordSRT2.fillMatrix(d, offs);
        d[offs++] = this.glossiness;
        d[offs++] = this.alphaRef;
        d[offs++] = this.yFlip;
        d[offs++] = this.whiteBack;
        // offs += fillVec4v(d, offs, this.paperColor);
    }
}

class VertexData {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public inputBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        let nextBufferIndex = fvtx.vertexBuffers.length;
        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const vertexAttribute = fvtx.vertexAttributes[i];
            const bufferIndex = vertexAttribute.bufferIndex;
            if (this.inputBufferDescriptors[bufferIndex] === undefined) {
                this.inputBufferDescriptors[bufferIndex] = null;
            }
            const attributeLocation = OrigamiProgram.a_Orders.indexOf(vertexAttribute.name);
            if (attributeLocation < 0) {
                continue;
            }
            const vertexBuffer = fvtx.vertexBuffers[bufferIndex];
            const convertedAttribute = this.convertVertexAttribute(vertexAttribute, vertexBuffer);
            if (convertedAttribute !== null) {
                const attribBufferIndex = nextBufferIndex++;
                this.vertexAttributeDescriptors.push({
                    location: attributeLocation,
                    format: convertedAttribute.format,
                    bufferIndex: attribBufferIndex,
                    bufferByteOffset: 0
                });
                this.inputBufferDescriptors[attribBufferIndex] = { byteStride: convertedAttribute.stride, frequency: GfxVertexBufferFrequency.PerVertex };
                const gfxBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, convertedAttribute.data);
                this.vertexBufferDescriptors[attribBufferIndex] = { buffer: gfxBuffer };
            } else {
                this.vertexAttributeDescriptors.push({
                    location: attributeLocation,
                    format: translateAttributeFormat(vertexAttribute.format),
                    bufferIndex: bufferIndex,
                    bufferByteOffset: vertexAttribute.offset
                });
                if (!this.vertexBufferDescriptors[bufferIndex]) {
                    const gfxBuffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexBuffer.data);
                    this.inputBufferDescriptors[bufferIndex] = { byteStride: vertexBuffer.stride, frequency: GfxVertexBufferFrequency.PerVertex };
                    this.vertexBufferDescriptors[bufferIndex] = { buffer: gfxBuffer };
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
        const out = new Int16Array(numElements * 4);
        const stride = out.BYTES_PER_ELEMENT * 4;
        let dst = 0;
        let offs = vertexAttribute.offset;
        const view = vertexBuffer.data.createDataView();
        for (let i = 0; i < numElements; i++) {
            const n = view.getUint32(offs, true);
            out[dst++] = signExtend10((n >>> 0) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 10) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 20) & 0x3FF) << 4;
            out[dst++] = ((n >>> 30) & 0x03) << 14;
            offs += vertexBuffer.stride;
        }
        return { format: GfxFormat.S16_RGBA_NORM, data: out.buffer, stride };
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexBufferDescriptors.length; i++) {
            if (this.vertexBufferDescriptors[i]) {
                device.destroyBuffer(this.vertexBufferDescriptors[i].buffer);
            }
        }
    }
}

class ShapeMeshData {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(cache: GfxRenderCache, public mesh: FSHP_Mesh, fvtxData: VertexData, public bone: FSKL_Bone) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat,
            vertexAttributeDescriptors: fvtxData.vertexAttributeDescriptors,
            vertexBufferDescriptors: fvtxData.inputBufferDescriptors,
        });
        this.vertexBufferDescriptors = fvtxData.vertexBufferDescriptors;
        this.indexBuffer = createBufferFromSlice(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexBufferData);
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
    }
}

class ShapeData {
    public meshData: ShapeMeshData[] = [];

    constructor(cache: GfxRenderCache, public fshp: FSHP, fvtxData: VertexData, public bone: FSKL_Bone) {
        for (const mesh of fshp.mesh) {
            this.meshData.push(new ShapeMeshData(cache, mesh, fvtxData, this.bone));
        }
    }

    public destroy(device: GfxDevice): void {
        for (const meshData of this.meshData) {
            meshData.destroy(device);
        }
    }
}

class ShapeMeshInstance {
    constructor(public meshData: ShapeMeshData) {
        assert(this.meshData.mesh.offset === 0);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.meshData.mesh.count);
        renderInst.setVertexInput(this.meshData.inputLayout, this.meshData.vertexBufferDescriptors, this.meshData.indexBufferDescriptor);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, this.meshData.mesh.bbox);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

class ShapeInstance {
    private meshInstance: ShapeMeshInstance;

    constructor(public fshpData: ShapeData, private fmatInstance: MaterialInstance) {
        // hardcode to first/highest LOD for now
        this.meshInstance = new ShapeMeshInstance(fshpData.meshData[0]);
    }

    public computeShiftMatrix(bone: FSKL_Bone): mat4 {
        const shift = mat4.create();
        mat4.fromRotationTranslationScale(shift, bone.rotation, bone.translation, bone.scale);
        return shift;
    }

    public computeModelView(modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): mat4 {
        const viewMatrix = SCRATCH_MATRIX;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        let offs = template.allocateUniformBuffer(OrigamiProgram.ub_ShapeParams, 44);
        const d = template.mapUniformBufferF32(OrigamiProgram.ub_ShapeParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(d, offs, this.computeShiftMatrix(this.fshpData.bone));
        offs += fillMatrix4x3(d, offs, this.computeModelView(modelMatrix, viewerInput));

        this.fmatInstance.setOnRenderInst(device, template);
        this.meshInstance.prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplate();
    }
}

export class ModelData {
    public vertexData: VertexData[] = [];
    public shapeData: ShapeData[] = [];

    constructor(cache: GfxRenderCache, public fmdl: FMDL) {
        for (const fvtx of fmdl.fvtx) {
            this.vertexData.push(new VertexData(cache.device, fvtx));
        }
        for (const fshp of fmdl.fshp) {
            this.shapeData.push(new ShapeData(cache, fshp, this.vertexData[fshp.vertexIndex], fmdl.fskl.bones[fshp.boneIndex]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (const fvtxData of this.vertexData) {
            fvtxData.destroy(device);
        }
        for (const fshpData of this.shapeData) {
            fshpData.destroy(device);
        }
    }
}

export class ModelRenderer {
    public fmatInstances: MaterialInstance[] = [];
    public fshpInstances: ShapeInstance[] = [];
    public modelMatrix = mat4.create();
    public name: string;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: PMTOKTextureHolder, fmdlData: ModelData) {
        this.name = fmdlData.fmdl.name;
        for (const fmat of fmdlData.fmdl.fmat) {
            this.fmatInstances.push(new MaterialInstance(device, cache, textureHolder, fmat));
        }
        for (const fshpData of fmdlData.shapeData) {
            this.fshpInstances.push(new ShapeInstance(fshpData, this.fmatInstances[fshpData.fshp.materialIndex]));
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(BINDING_LAYOUTS);
        for (const fshpInstance of this.fshpInstances) {
            fshpInstance.prepareToRender(device, renderInstManager, this.modelMatrix, viewerInput);
        }
        renderInstManager.popTemplate();
    }
}

export class PMTOKRenderer {
    private renderInstListMain = new GfxRenderInstList();
    private resourceSystem: ResourceSystem;
    public renderHelper: GfxRenderHelper;
    public modelRenderers: ModelRenderer[] = [];

    constructor(device: GfxDevice, ) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public setResourceSystem(rs: ResourceSystem) {
        this.resourceSystem = rs;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
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
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.modelRenderers.length; i++) {
            this.modelRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
        }
        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.resourceSystem.destroy(device);
    }
}
