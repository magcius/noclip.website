import { pmtok_deswizzle, pmtok_decode_texture, PMTOKCompressedTextureFormat } from "noclip-rust-support";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ChannelSource, ChannelFormat, TypeFormat, getChannelFormat, getTypeFormat } from "../fres_nx/nngfx_enum";
import { getFormatBlockWidth, getFormatBlockHeight, getFormatBytesPerBlock, decompress, getImageFormatString } from "../fres_nx/tegra_texture";
import { GfxDevice, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { TextureHolder } from "../TextureHolder";
import { BRTI } from "../fres_nx/bntx";
import { Texture } from "../viewer";

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

function translateImageFormat(channelFormat: ChannelFormat, typeFormat: TypeFormat): GfxFormat {
    switch (channelFormat) {
        case ChannelFormat.Bc1:
            switch (typeFormat) {
                case TypeFormat.Unorm:
                    return GfxFormat.BC1;
                case TypeFormat.UnormSrgb:
                    return GfxFormat.BC1_SRGB;
                default:
                    throw `Unknown type format of ${typeFormat} for BC1`;
            }
        case ChannelFormat.Bc2:
            switch (typeFormat) {
                case TypeFormat.Unorm:
                    return GfxFormat.BC2;
                case TypeFormat.UnormSrgb:
                    return GfxFormat.BC2_SRGB;
                default:
                    throw `Unknown type format of ${typeFormat} for BC2`;
            }
        case ChannelFormat.Bc3:
            switch (typeFormat) {
                case TypeFormat.Unorm:
                    return GfxFormat.BC3;
                case TypeFormat.UnormSrgb:
                    return GfxFormat.BC3_SRGB;
                default:
                    throw `Unknown type format of ${typeFormat} for BC3`;
            }
        case ChannelFormat.Bc4:
            switch (typeFormat) {
                case TypeFormat.Unorm:
                    return GfxFormat.BC4_UNORM;
                case TypeFormat.Snorm:
                    return GfxFormat.BC4_SNORM;
                default:
                    throw `Unknown type format of ${typeFormat} for BC4`;
            }
        case ChannelFormat.Bc5:
            switch (typeFormat) {
                case TypeFormat.Unorm:
                    return GfxFormat.BC5_UNORM;
                case TypeFormat.Snorm:
                    return GfxFormat.BC5_SNORM;
                default:
                    throw `Unknown type format of ${typeFormat} for BC5`;
            }
        case ChannelFormat.Bc6:
            switch (typeFormat) {
                case TypeFormat.Float:
                    return GfxFormat.BC6H_SNORM;
                case TypeFormat.Ufloat:
                    return GfxFormat.BC6H_UNORM;
                default:
                    throw `Unknown type format of ${typeFormat} for BC6`;
            }
        case ChannelFormat.Bc7:
            switch (typeFormat) {
                case TypeFormat.Unorm:
                    return GfxFormat.BC7;
                case TypeFormat.UnormSrgb:
                    return GfxFormat.BC7_SRGB;
                default:
                    throw `Unknown type format of ${typeFormat} for BC7`;
            }
        default:
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
    }
}

export class OrigamiTextureHolder extends TextureHolder {
    public channelSources: Map<string, ChannelSource[]> = new Map();

    private async deswizzle(buffer: ArrayBufferSlice, channelFormat: ChannelFormat, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
        return pmtok_deswizzle(buffer.createTypedArray(Uint8Array), width, height,
            getFormatBlockWidth(channelFormat), getFormatBlockHeight(channelFormat),
            getFormatBytesPerBlock(channelFormat), 1) as Uint8Array<ArrayBuffer>;
    }

    public addTexture(device: GfxDevice, texture: BRTI) {
        if (this.textureNames.includes(texture.name)) {
            return;
        }

        const channelFormat = getChannelFormat(texture.imageFormat);
        const typeFormat = getTypeFormat(texture.imageFormat);
        const gfxFormat = translateImageFormat(channelFormat, typeFormat);
        const mips = texture.textureDataArray[0].mipBuffers.length;
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(gfxFormat, texture.width, texture.height, mips));
        for (let mipLevel = 0; mipLevel < mips; mipLevel++) {
            const buffer = texture.textureDataArray[0].mipBuffers[mipLevel];
            const width = Math.max(texture.width >>> mipLevel, 1);
            const height = Math.max(texture.height >>> mipLevel, 1);
            this.deswizzle(buffer, channelFormat, width, height).then(async (deswizzled) => {
                let rgbaPixels;
                switch (channelFormat) {
                    case ChannelFormat.Bc1:
                    case ChannelFormat.Bc2: // not used?
                    case ChannelFormat.Bc3:
                    case ChannelFormat.Bc4:
                    case ChannelFormat.Bc5:
                    case ChannelFormat.Bc6:
                    case ChannelFormat.Bc7:
                        rgbaPixels = deswizzled;
                        break;
                    case ChannelFormat.Astc_8x5:
                        rgbaPixels = pmtok_decode_texture(deswizzled, PMTOKCompressedTextureFormat.ASTC8x5, width, height);
                        break;
                    case ChannelFormat.Astc_8x6:
                        rgbaPixels = pmtok_decode_texture(deswizzled, PMTOKCompressedTextureFormat.ASTC8x6, width, height);
                        break;
                    case ChannelFormat.Astc_8x8:
                        // ASTC's WebGL extension is not available on 99% of computers
                        rgbaPixels = pmtok_decode_texture(deswizzled, PMTOKCompressedTextureFormat.ASTC8x8, width, height);
                        break;
                    default:
                        rgbaPixels = decompress({ ...texture, width, height, depth: 1 }, deswizzled).pixels;
                        break;
                }
                device.uploadTextureData(gfxTexture, mipLevel, [rgbaPixels]);
            });
        }

        const extraInfo = new Map<string, string>();
        extraInfo.set("Format", getImageFormatString(texture.imageFormat));
        extraInfo.set("Channels", getChannelSourceString(texture.channelSource));

        const viewerTexture: Texture = { gfxTexture, extraInfo };
        this.gfxTextures.push(gfxTexture);
        this.viewerTextures.push(viewerTexture);
        this.textureNames.push(texture.name);
        this.channelSources.set(texture.name, texture.channelSource);
    }
}
