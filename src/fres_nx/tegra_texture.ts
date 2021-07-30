
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ImageFormat, ChannelFormat, TypeFormat, getChannelFormat, getTypeFormat } from "./nngfx_enum";
import { BRTI } from "./bntx";
import { GfxFormat } from "../gfx/platform/GfxPlatform";
import { decompressBC, DecodedSurfaceSW, DecodedSurfaceBC } from "../Common/bc_texture";
import { assert } from "../util";
import { clamp } from "../MathHelpers";

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

export function getBlockHeightLog2(heightInBlocks: number): number {
    return clamp(Math.ceil(Math.log2(heightInBlocks / 8)), 0, 4);
}

export interface SwizzledSurface {
    width: number;
    height: number;
    channelFormat: ChannelFormat;
    buffer: ArrayBufferSlice;
}

function ctz(n: number): number {
    let i = 0;
    while (!(n & 1)) ++i, n >>= 1;
    return i;
}

function getAddrBlockLinear(x: number, y: number, w: number, bpp: number, blockHeight: number, baseAddr: number = 0): number {
    const widthInGOBs = (((w * bpp) + 63) / 64) | 0;
    let gobAddr = baseAddr;

    gobAddr += ((y / (8 * blockHeight)) | 0) * 512 * blockHeight * widthInGOBs;
    gobAddr += ((x * bpp / 64) | 0) * 512 * blockHeight;
    gobAddr += ((y % (8 * blockHeight) / 8) | 0) * 512;

    x *= bpp;
    let addr = gobAddr;
    addr += (((x % 64) / 32) | 0) * 256;
    addr += (((y % 8) / 2) | 0) * 64;
    addr += (((x % 32) / 16) | 0) * 32;
    addr += (((y % 2) / 16) | 0);
    addr += (x % 16);
    return addr;
}

// https://github.com/gdkchan/BnTxx/blob/master/BnTxx/BlockLinearSwizzle.cs
// TODO(jstpierre): Integrate the proper algorithm from Yuzu
export function deswizzle(swizzledSurface: SwizzledSurface): Uint8Array {
    const formatBlockWidth = getFormatBlockWidth(swizzledSurface.channelFormat);
    const formatBlockHeight = getFormatBlockHeight(swizzledSurface.channelFormat);

    const widthInBlocks = ((swizzledSurface.width + formatBlockWidth - 1) / formatBlockWidth) | 0;
    const heightInBlocks = ((swizzledSurface.height + formatBlockHeight - 1) / formatBlockHeight) | 0;

    const blockHeight = 1 << getBlockHeightLog2(heightInBlocks);
    const bpp = getFormatBytesPerPixel(swizzledSurface.channelFormat);
    const bhMask = (blockHeight * 8) - 1;
    const bhShift = ctz(blockHeight * 8);
    const xShift = ctz(blockHeight * 512);
    const bppShift = ctz(bpp);
    const widthInGobs = Math.ceil(widthInBlocks * bpp / 64);
    const gobStride = 512 * blockHeight * widthInGobs;

    function memcpy(dst: Uint8Array, dstOffs: number, src: ArrayBufferSlice, srcOffs: number, length: number) {
        dst.set(src.createTypedArray(Uint8Array, srcOffs, length), dstOffs);
    }

    const src = swizzledSurface.buffer;
    const dst = new Uint8Array(widthInBlocks * heightInBlocks * bpp);
    for (let y = 0; y < heightInBlocks; y++) {
        for (let x = 0; x < widthInBlocks; x++) {
            const nx = x << bppShift, ny = y;
            let p = 0;

            p += ((ny >>> bhShift)) * gobStride;
            p += ((nx >>> 6)) << xShift;
            p += ((ny & bhMask) >>> 3) << 9;
            p += ((nx & 0x3F) >>> 5) << 8;
            p += ((ny & 0x07) >>> 1) << 6;
            p += ((nx & 0x1F) >>> 4) << 5;
            p += ((ny & 0x01) >>> 0) << 4;
            p += ((nx & 0x0F) >>> 0) << 0;

            const srcOffs = p;
            // const srcOffs = getAddrBlockLinear(x, y, widthInBlocks, bpp, blockHeight);

            const dstOffs = ((y * widthInBlocks) + x) * bpp;
            memcpy(dst, dstOffs, src, srcOffs, bpp);
        }
    }
    return dst;
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
