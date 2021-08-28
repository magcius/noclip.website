
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ImageFormat, ChannelFormat, TypeFormat, getChannelFormat, getTypeFormat } from "./nngfx_enum";
import { BRTI } from "./bntx";
import { GfxFormat } from "../gfx/platform/GfxPlatform";
import { decompressBC, DecodedSurfaceSW, DecodedSurfaceBC } from "../Common/bc_texture";
import { assert } from "../util";

export function getFormatBlockWidth(channelFormat: ChannelFormat): number {
    switch (channelFormat) {
    case ChannelFormat.Bc1:
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc4:
    case ChannelFormat.Bc5:
    case ChannelFormat.Bc6:
    case ChannelFormat.Bc7:
    case ChannelFormat.Astc_4x4:
        return 4;
    case ChannelFormat.Astc_5x4:
    case ChannelFormat.Astc_5x5:
        return 5;
    case ChannelFormat.Astc_6x5:
    case ChannelFormat.Astc_6x6:
        return 6;
    case ChannelFormat.Astc_8x5:
    case ChannelFormat.Astc_8x6:
    case ChannelFormat.Astc_8x8:
        return 8;
    case ChannelFormat.Astc_10x5:
    case ChannelFormat.Astc_10x6:
    case ChannelFormat.Astc_10x8:
    case ChannelFormat.Astc_10x10:
        return 10;
    case ChannelFormat.Astc_12x10:
    case ChannelFormat.Astc_12x12:
        return 12;
    default:
        return 1;
    }
}

export function getFormatBlockHeight(channelFormat: ChannelFormat): number {
    switch (channelFormat) {
    case ChannelFormat.Bc1:
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc4:
    case ChannelFormat.Bc5:
    case ChannelFormat.Bc6:
    case ChannelFormat.Bc7:
    case ChannelFormat.Astc_4x4:
    case ChannelFormat.Astc_5x4:
        return 4;
    case ChannelFormat.Astc_5x5:
    case ChannelFormat.Astc_6x5:
    case ChannelFormat.Astc_8x5:
    case ChannelFormat.Astc_10x5:
        return 5;
    case ChannelFormat.Astc_6x6:
    case ChannelFormat.Astc_8x6:
    case ChannelFormat.Astc_10x6:
        return 6;
    case ChannelFormat.Astc_8x8:
    case ChannelFormat.Astc_10x8:
        return 8;
    case ChannelFormat.Astc_10x10:
    case ChannelFormat.Astc_12x10:
        return 10;
    case ChannelFormat.Astc_12x12:
        return 12;
    default:
        return 1;
    }
}

export function isChannelFormatSupported(channelFormat: ChannelFormat): boolean {
    switch (channelFormat) {
    case ChannelFormat.Bc1:
    case ChannelFormat.Bc4:
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc5:
    case ChannelFormat.R8_G8_B8_A8:
    case ChannelFormat.B8_G8_R8_A8:
        return true;
    default:
        return false;
    }
}

export function getFormatBytesPerPixel(channelFormat: ChannelFormat): number {
    switch (channelFormat) {
    case ChannelFormat.Bc1:
    case ChannelFormat.Bc4:
        return 8;
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc5:
        return 16;
    case ChannelFormat.R8_G8_B8_A8:
    case ChannelFormat.B8_G8_R8_A8:
        return 4;
    default:
        throw "whoops";
    }
}

export interface SwizzledSurface {
    width: number;
    height: number;
    channelFormat: ChannelFormat;
    buffer: ArrayBufferSlice;
    blockHeightLog2: number; // The block height of mip0.
}

export async function deswizzle(swizzledSurface: SwizzledSurface): Promise<Uint8Array> {
    const { tegra_deswizzle, CompressionType } = await import("../../rust/pkg/index");
    const { buffer, channelFormat, width, height, blockHeightLog2 } = swizzledSurface;
    const compressionType =
        channelFormat === ChannelFormat.Bc1 ? CompressionType.Bc1 :
        channelFormat === ChannelFormat.Bc2 ? CompressionType.Bc2 :
        channelFormat === ChannelFormat.Bc3 ? CompressionType.Bc3 :
        channelFormat === ChannelFormat.Bc4 ? CompressionType.Bc4 :
        channelFormat === ChannelFormat.Bc5 ? CompressionType.Bc5 :
        undefined!;
    return tegra_deswizzle(buffer.createTypedArray(Uint8Array), compressionType, width, height, blockHeightLog2);
}

export function decompress(textureEntry: BRTI, pixels: Uint8Array): DecodedSurfaceSW {
    const channelFormat = getChannelFormat(textureEntry.imageFormat);
    const typeFormat = getTypeFormat(textureEntry.imageFormat);

    switch (channelFormat) {
    case ChannelFormat.Bc1:
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.UnormSrgb);
        return decompressBC({ ...textureEntry, type: 'BC1', flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SRGB', pixels });
    case ChannelFormat.Bc3:
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.UnormSrgb);
        return decompressBC({ ...textureEntry, type: 'BC3', flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SRGB', pixels });
    case ChannelFormat.Bc4:
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.Snorm);
        return decompressBC({ ...textureEntry, type: 'BC4', flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SNORM', pixels } as DecodedSurfaceBC);
    case ChannelFormat.Bc5:
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.Snorm);
        return decompressBC({ ...textureEntry, type: 'BC5', flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SNORM', pixels } as DecodedSurfaceBC);
    case ChannelFormat.R8_G8_B8_A8:
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.UnormSrgb);
        return { ... textureEntry, type: 'RGBA', flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SRGB', pixels };
    default:
        console.error(channelFormat.toString(16));
        throw "whoops";
    }
}

function getChannelFormatString(channelFormat: ChannelFormat): string {
    switch (channelFormat) {
    case ChannelFormat.Bc1:
        return 'BC1';
    case ChannelFormat.Bc3:
        return 'BC3';
    case ChannelFormat.Bc4:
        return 'BC4';
    case ChannelFormat.Bc5:
        return 'BC5';
    case ChannelFormat.R8_G8_B8_A8:
        return 'R8_G8_B8_A8';
    default:
        throw "whoops";
    }
}

function getTypeFormatString(typeFormat: TypeFormat): string {
    switch (typeFormat) {
    case TypeFormat.Unorm:
        return 'UNORM';
    case TypeFormat.Snorm:
        return 'SNORM';
    case TypeFormat.UnormSrgb:
        return 'SRGB';
    default:
        throw "whoops";
    }
}

export function getImageFormatString(imageFormat: ImageFormat): string {
    const channelFormat = getChannelFormat(imageFormat);
    const typeFormat = getTypeFormat(imageFormat);

    return `${getChannelFormatString(channelFormat)} (${getTypeFormatString(typeFormat)})`;
}

export function translateImageFormat(imageFormat: ImageFormat): GfxFormat {
    const typeFormat = getTypeFormat(imageFormat);

    switch (typeFormat) {
    case TypeFormat.Unorm:
        return GfxFormat.U8_RGBA_NORM;
    case TypeFormat.UnormSrgb:
        return GfxFormat.U8_RGBA_SRGB;
    case TypeFormat.Snorm:
        return GfxFormat.S8_RGBA_NORM;
    default:
        throw "whoops";
    }
}
