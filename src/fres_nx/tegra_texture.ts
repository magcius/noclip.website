
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ImageFormat, ChannelFormat, TypeFormat, getChannelFormat, getTypeFormat } from "./nngfx_enum";
import { BRTI } from "./bntx";
import { GfxFormat } from "../gfx/platform/GfxPlatform";
import { decompressBC, DecodedSurfaceSW, DecodedSurfaceBC } from "../Common/bc_texture";
import { assert, hexzero } from "../util";
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

/*
function getBlockHeightLog2(heightInBlocks: number): number {
    return clamp(Math.ceil(Math.log2((heightInBlocks / 8) | 0)), 0, 4);
}

function calcSurfaceBlockHeight(channelFormat: ChannelFormat, textureHeight: number): number {
    const formatBlockHeight = getFormatBlockHeight(channelFormat);
    const heightInBlocks = ((textureHeight + formatBlockHeight - 1) / formatBlockHeight) | 0;
    const blockHeight = 1 << getBlockHeightLog2(heightInBlocks);
    return blockHeight;
}
*/

export interface SwizzledSurface {
    width: number;
    height: number;
    channelFormat: ChannelFormat;
    buffer: ArrayBufferSlice;
    blockHeightLog2: number; // The block height of mip0.
}

const GOB_SIZE_X = 64;
const GOB_SIZE_Y = 8;

function getAddrBlockLinear(x: number, y: number, w: number, bpp: number, blockHeight: number, baseAddr: number = 0): number {
    const widthInGOBs = (((w * bpp) + GOB_SIZE_X - 1) / GOB_SIZE_X) | 0;
    let gobAddr = baseAddr;

    gobAddr += ((y / (GOB_SIZE_Y * blockHeight)) | 0) * 512 * blockHeight * widthInGOBs;
    gobAddr += ((x * bpp / 64) | 0) * 512 * blockHeight;
    gobAddr += ((y % (GOB_SIZE_Y * blockHeight) / 8) | 0) * 512;

    x *= bpp;
    let addr = gobAddr;
    addr += (((x % 64) / 32) | 0) * 256;
    addr += (((y % 8) / 2) | 0) * 64;
    addr += (((x % 32) / 16) | 0) * 32;
    addr += ((y % 2) * 16);
    addr += (x % 16);
    return addr;
}

function nextPow2(v: number): number {
    v--;
    v |= v >>> 1;
    v |= v >>> 2;
    v |= v >>> 4;
    v |= v >>> 8;
    v |= v >>> 16;
    v++;
    return v;
}

export function deswizzle(swizzledSurface: SwizzledSurface): Uint8Array {
    const formatBlockWidth = getFormatBlockWidth(swizzledSurface.channelFormat);
    const formatBlockHeight = getFormatBlockHeight(swizzledSurface.channelFormat);

    const widthInBlocks = ((swizzledSurface.width + formatBlockWidth - 1) / formatBlockWidth) | 0;
    const heightInBlocks = ((swizzledSurface.height + formatBlockHeight - 1) / formatBlockHeight) | 0;

    // Driver picks blockHeightLog2 for mip0.
    let blockHeight = 1 << swizzledSurface.blockHeightLog2;

    // Adjust block height down per mip to fit the image.
    while (blockHeight > 1 && (nextPow2(heightInBlocks) < (GOB_SIZE_Y * blockHeight)))
        blockHeight >>= 1;

    const bpp = getFormatBytesPerPixel(swizzledSurface.channelFormat);

    function memcpy(dst: Uint8Array, dstOffs: number, src: ArrayBufferSlice, srcOffs: number, length: number) {
        dst.set(src.createTypedArray(Uint8Array, srcOffs, length), dstOffs);
    }

    const src = swizzledSurface.buffer;
    const dst = new Uint8Array(widthInBlocks * heightInBlocks * bpp);
    for (let y = 0; y < heightInBlocks; y++) {
        for (let x = 0; x < widthInBlocks; x++) {
            const srcOffs = getAddrBlockLinear(x, y, widthInBlocks, bpp, blockHeight);
            const dstOffs = ((y * widthInBlocks) + x) * bpp;
            memcpy(dst, dstOffs, src, srcOffs, bpp);
        }
    }
    return dst;
}

export async function decompress(textureEntry: BRTI, pixels: Uint8Array): Promise<DecodedSurfaceSW> {
    const wasm = await import("../../rust/pkg/index");
    const width = textureEntry.width;
    const height = textureEntry.height;
    const depth = textureEntry.depth;
    const channelFormat = getChannelFormat(textureEntry.imageFormat);
    const typeFormat = getTypeFormat(textureEntry.imageFormat);
    const info = {
        width,
        height,
        depth,
    }
    if (channelFormat === ChannelFormat.Bc1 || channelFormat === ChannelFormat.Bc2 || channelFormat === ChannelFormat.Bc3) {
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.UnormSrgb);
        return {
            ...info,
            flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SRGB',
            type: 'RGBA',
            pixels: wasm.decompress_tegra_unsigned(
                channelFormat === ChannelFormat.Bc1 ? wasm.CompressionType.Bc1 :
                channelFormat === ChannelFormat.Bc2 ? wasm.CompressionType.Bc2 : wasm.CompressionType.Bc3,
                typeFormat === TypeFormat.UnormSrgb,
                width,
                height,
                depth,
                pixels,
                textureEntry.blockHeightLog2
            )
        };
    } else if (channelFormat === ChannelFormat.Bc4 || channelFormat === ChannelFormat.Bc5) {
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.Snorm);
        if (typeFormat === TypeFormat.Unorm) {
            return {
                ...info,
                flag: 'UNORM',
                type: 'RGBA',
                pixels: wasm.decompress_tegra_unsigned(
                    channelFormat === ChannelFormat.Bc4 ? wasm.CompressionType.Bc4 : wasm.CompressionType.Bc5,
                    false,
                    width,
                    height,
                    depth,
                    pixels,
                    textureEntry.blockHeightLog2
                ),
            };
        } else {
            return {
                ...info,
                flag: 'SNORM',
                type: 'RGBA',
                pixels: wasm.decompress_tegra_signed(
                    channelFormat === ChannelFormat.Bc4 ? wasm.CompressionType.Bc4 : wasm.CompressionType.Bc5,
                    width,
                    height,
                    depth,
                    pixels,
                    textureEntry.blockHeightLog2
                ),
            };
        }
    } else if (channelFormat === ChannelFormat.R8_G8_B8_A8) {
        assert(typeFormat === TypeFormat.Unorm || typeFormat === TypeFormat.UnormSrgb);
        return { ... textureEntry, type: 'RGBA', flag: typeFormat === TypeFormat.Unorm ? 'UNORM' : 'SRGB', pixels };
    } else {
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