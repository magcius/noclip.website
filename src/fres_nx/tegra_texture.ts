
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { ImageFormat, ChannelFormat, TypeFormat, getChannelFormat, getTypeFormat } from "./nngfx_enum.js";
import { BRTI } from "./bntx.js";
import { GfxFormat } from "../gfx/platform/GfxPlatform.js";
import { decompressBC, DecodedSurfaceSW, DecodedSurfaceBC } from "../Common/bc_texture.js";
import { assert } from "../util.js";
import { rust } from "../rustlib.js";

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
    case ChannelFormat.R8_G8_B8_A8:
    case ChannelFormat.B8_G8_R8_A8:
    case ChannelFormat.R11_G11_B10:
    case ChannelFormat.R16_G16_B16_A16:
    case ChannelFormat.Bc1:
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc4:
    case ChannelFormat.Bc5:
        return true;
    default:
        return false;
    }
}

export function getFormatBytesPerBlock(channelFormat: ChannelFormat): number {
    switch (channelFormat) {
    case ChannelFormat.R8_G8_B8_A8:
    case ChannelFormat.B8_G8_R8_A8:
    case ChannelFormat.R11_G11_B10:
        return 4;
    case ChannelFormat.Bc1:
    case ChannelFormat.Bc4:
    case ChannelFormat.R16_G16_B16_A16:
        return 8;
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc5:
        return 16;
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

export async function deswizzle(swizzledSurface: SwizzledSurface): Promise<Uint8Array<ArrayBuffer>> {
    const { buffer, channelFormat, width, height, blockHeightLog2 } = swizzledSurface;
    const blockWidth = getFormatBlockWidth(channelFormat);
    const blockHeight = getFormatBlockHeight(channelFormat);
    const bytesPerBlock = getFormatBytesPerBlock(channelFormat);
    return rust.tegra_deswizzle(buffer.createTypedArray(Uint8Array), blockWidth, blockHeight, bytesPerBlock, width, height, blockHeightLog2) as Uint8Array<ArrayBuffer>;
}

export function decompress(textureEntry: BRTI, pixels: Uint8Array<ArrayBuffer>): DecodedSurfaceSW {
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
    case ChannelFormat.R11_G11_B10:
        assert(typeFormat === TypeFormat.Float);
        return convertFloatR11_G11_B10(textureEntry, pixels);
    case ChannelFormat.R16_G16_B16_A16:
        return { ... textureEntry, flag: 'SRGB', type: 'RGBA', pixels };
    default:
        console.error(channelFormat.toString(16));
        throw "whoops";
    }
}

/**
 * converts R11_G11_B10 data to R16_G16_B16_A16 data
 */
function convertFloatR11_G11_B10(textureEntry: BRTI, pixels: Uint8Array<ArrayBuffer>): DecodedSurfaceSW
{
    const pixelCount = pixels.byteLength / 4;
    const newBufferLength = pixels.byteLength * 2;
    let newBuffer = new Uint8Array(newBufferLength)
    for (let i = 0; i < pixelCount; i++) {
        const originalPixelOffset = i * 0x4;
        // read 4 bytes little endian
        const originalPixel = (pixels[originalPixelOffset + 3] << 24) +
                         (pixels[originalPixelOffset + 2] << 16) +
                         (pixels[originalPixelOffset + 1] << 8) +
                         (pixels[originalPixelOffset + 0] << 0);

        // layout 10 bits blue, 11 bits green, 11 bits red
        const b = (originalPixel >> 22) & 0x3FF;

        // these have no sign bit
        // the exponent is still 5 bits, so leave it as is
        const bExponent = b >> 5;
        // the mantissa will expand from 5/6 bits to 10 bits.
        const bMantissa = (b & 0x1F) / 0x1F * 0x3FF;

        // the sign bit will be 0
        // the exponent needs to be from bits 2 to 7 of the first byte, so shift them up 2
        // bits 1 and 2 need to be the top 2 bits of the mantissa
        const b1 = (bExponent << 2) + (bMantissa >> 8);
        // the second byte is the lower 8 bits of the mantissa
        const b2 = bMantissa;

        const g = (originalPixel >> 11) & 0x7FF;
        const gExponent = g >> 6;
        const gMantissa = (g & 0x3F) / 0x3F * 0x3FF;
        const g1 = (gExponent << 2) + (gMantissa >> 8);
        const g2 = gMantissa;

        const r = originalPixel & 0x7FF;
        const rExponent = r >> 6;
        const rMantissa = (r & 0x3F) / 0x3F * 0x3FF;    
        const r1 = (rExponent << 2) + (rMantissa >> 8);
        const r2 = rMantissa;

        // alpha is 1.0
        const a1 = 0x3C;
        const a2 = 0x0;

        const newPixelOffset = i * 0x8;
        // output in little endian
        newBuffer[newPixelOffset + 0] = r2;
        newBuffer[newPixelOffset + 1] = r1;
        newBuffer[newPixelOffset + 2] = g2;
        newBuffer[newPixelOffset + 3] = g1;
        newBuffer[newPixelOffset + 4] = b2;
        newBuffer[newPixelOffset + 5] = b1;
        newBuffer[newPixelOffset + 6] = a2;
        newBuffer[newPixelOffset + 7] = a1;
    }
    return { ... textureEntry, flag: 'SRGB', type: 'RGBA', pixels: newBuffer };
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
    case ChannelFormat.R11_G11_B10:
        return 'R11_G11_B10';
    case ChannelFormat.R16_G16_B16_A16:
        return 'R16_G16_B16_A16';
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
    case TypeFormat.Float:
        return 'FLOAT';
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
    case TypeFormat.Float:
        return GfxFormat.F16_RGBA;
    default:
        throw "whoops";
    }
}
