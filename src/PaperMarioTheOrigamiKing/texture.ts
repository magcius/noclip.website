import { pmtok_deswizzle, pmtok_decode_texture, PMTOKCompressedTextureFormat, pmtok_get_deswizzled_size } from "noclip-rust-support";
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

function getGfxFormat(channelFormat: ChannelFormat, typeFormat: TypeFormat): GfxFormat {
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
            return getGfxFormatDecoded(typeFormat);
    }
}

function getGfxFormatDecoded(typeFormat: TypeFormat): GfxFormat {
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

export class OrigamiTextureHolder extends TextureHolder {
    public channelSources: Map<string, ChannelSource[]> = new Map();

    private deswizzle(buffers: ArrayBufferSlice[], width: number, height: number, bw: number, bh: number, bb: number, mips: number): Uint8Array<ArrayBuffer> {
        let offset = 0;
        const buffer = new Uint8Array(buffers.reduce((sum, b) => sum + b.byteLength, 0));
        for (const b of buffers) {
            buffer.set(b.createTypedArray(Uint8Array), offset);
            offset += b.byteLength;
        }
        return pmtok_deswizzle(buffer, width, height, bw, bh, bb, mips) as Uint8Array<ArrayBuffer>;
    }

    public addTexture(device: GfxDevice, texture: BRTI) {
        if (this.textureNames.includes(texture.name)) {
            return;
        }

        const channelFormat = getChannelFormat(texture.imageFormat);
        const typeFormat = getTypeFormat(texture.imageFormat);
        const blockWidth = getFormatBlockWidth(channelFormat);
        const blockHeight = getFormatBlockHeight(channelFormat);
        const blockBytes = getFormatBytesPerBlock(channelFormat);
        const bc = channelFormat >= ChannelFormat.Bc1 && channelFormat <= ChannelFormat.Bc7;

        let gfxFormat = getGfxFormat(channelFormat, typeFormat);
        const deviceSupportsFormat = device.queryTextureFormatSupported(gfxFormat, texture.width, texture.height);
        let keepCompressed = bc && deviceSupportsFormat;
        if (bc && !deviceSupportsFormat) {
            gfxFormat = getGfxFormatDecoded(typeFormat);
            keepCompressed = false;
        }

        let mips = 0;
        for (let m = 0; m < texture.textureDataArray[0].mipBuffers.length; m++) {
            mips += device.queryTextureFormatSupported(gfxFormat, Math.max(texture.width >>> m, 1), Math.max(texture.height >>> m, 1)) ? 1 : 0;
        }
        if (mips === 0) {
            console.warn("No valid mips for", texture.name);
            return;
        }

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(gfxFormat, texture.width, texture.height, mips));

        const deswizzled = this.deswizzle(texture.textureDataArray[0].mipBuffers, texture.width, texture.height, blockWidth, blockHeight, blockBytes, mips);
        let offset = 0;
        const ends: number[] = [];
        for (let m = 0; m < mips; m++) {
            const size = pmtok_get_deswizzled_size(Math.max(texture.width >>> m, 1), Math.max(texture.height >>> m, 1), blockWidth, blockHeight, blockBytes);
            ends.push(size + offset);
            offset += size;
        }

        const mipData: ArrayBufferView[] = [];
        for (let m = 0; m < mips; m++) {
            const data = deswizzled.slice(m === 0 ? m : ends[m - 1], ends[m]);
            const width = Math.max(texture.width >>> m, 1);
            const height = Math.max(texture.height >>> m, 1);
            let rgba;
            switch (channelFormat) {
                case ChannelFormat.Bc1:
                case ChannelFormat.Bc3:
                case ChannelFormat.Bc4:
                case ChannelFormat.Bc5:
                    if (keepCompressed) {
                        rgba = data;
                    } else {
                        rgba = decompress({ ...texture, width, height, depth: 1 }, data).pixels;
                    }
                    break;
                case ChannelFormat.Bc6:
                    if (keepCompressed) {
                        rgba = data;
                    } else {
                        rgba = pmtok_decode_texture(data, typeFormat === TypeFormat.Ufloat ? PMTOKCompressedTextureFormat.BC6H : PMTOKCompressedTextureFormat.BC6S, width, height);
                    }
                    break;
                case ChannelFormat.Bc7:
                    if (keepCompressed) {
                        rgba = data;
                    } else {
                        rgba = pmtok_decode_texture(data, PMTOKCompressedTextureFormat.BC7, width, height);
                    }
                    break;
                case ChannelFormat.Astc_8x5:
                    rgba = pmtok_decode_texture(data, PMTOKCompressedTextureFormat.ASTC8x5, width, height);
                    break;
                case ChannelFormat.Astc_8x6:
                    rgba = pmtok_decode_texture(data, PMTOKCompressedTextureFormat.ASTC8x6, width, height);
                    break;
                case ChannelFormat.Astc_8x8:
                    rgba = pmtok_decode_texture(data, PMTOKCompressedTextureFormat.ASTC8x8, width, height);
                    break;
                default:
                    rgba = decompress({ ...texture, width, height, depth: 1 }, data).pixels;
                    break;
            }
            mipData.push(rgba);
        }

        device.uploadTextureData(gfxTexture, 0, mipData);

        const extraInfo = new Map<string, string>();
        extraInfo.set("Format", getImageFormatString(texture.imageFormat));
        extraInfo.set("Channels", getChannelSourceString(texture.channelSource));
        extraInfo.set("Decompressed", `${!keepCompressed}`);

        const viewerTexture: Texture = { gfxTexture, extraInfo };
        this.gfxTextures.push(gfxTexture);
        this.viewerTextures.push(viewerTexture);
        this.textureNames.push(texture.name);
        this.channelSources.set(texture.name, texture.channelSource);
    }
}
