
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
    case ChannelFormat.Bc4:
    case ChannelFormat.Bc2:
    case ChannelFormat.Bc3:
    case ChannelFormat.Bc5:
        return true;
    default:
        return false;
    }
}

export function getFormatBytesPerPixel(channelFormat: ChannelFormat): number {
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
    const block_width = getFormatBlockWidth(channelFormat);
    const block_height = getFormatBlockHeight(channelFormat);
    const bytes_per_pixel = getFormatBytesPerPixel(channelFormat);
    return rust.tegra_deswizzle(buffer.createTypedArray(Uint8Array), block_width, block_height, bytes_per_pixel, width, height, blockHeightLog2) as Uint8Array<ArrayBuffer>;
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
    for (let i = 0; i < pixelCount; i++)
    {
        const oldPixelOffset = i * 0x4;
        // read 4 bytes little endian
        const oldPixel = (pixels[oldPixelOffset + 3] << 24) +
                         (pixels[oldPixelOffset + 2] << 16) +
                         (pixels[oldPixelOffset + 1] << 8) +
                         (pixels[oldPixelOffset + 0] << 0);

        // layout 10 bits blue, 11 bits green, 11 bits red
        const b = (oldPixel >> 22) & 0x3FF;
        const bExponent = b >> 5;
        const bMantissa = b & 0x1F;

        const g = (oldPixel >> 11) & 0x7FF;
        const gExponent = g >> 6;
        const gMantissa = g & 0x3F;

        const r = oldPixel & 0x7FF;
        const rExponent = r >> 6;
        const rMantissa = r & 0x3F;    

        if (i == 0)
        {
            console.log(`oldPixel ${oldPixel}`);
            // console.log(`r ${r}`);
            // console.log(`g ${g}`);
            // console.log(`b ${b}`);
        }

        const newPixelOffset = i * 0x8;
        // these have no sign bit, so we can ignore it
        // the exponent needs to be from bits 2 to 7, so shift them up 2
        // the mantissa will occupy the rest of the bits. it expands from 5/6 bits to 10 bits
        newBuffer[newPixelOffset + 0] = rMantissa;
        newBuffer[newPixelOffset + 1] = rExponent << 2;
        newBuffer[newPixelOffset + 2] = gMantissa;
        newBuffer[newPixelOffset + 3] = gExponent << 2;
        newBuffer[newPixelOffset + 4] = bMantissa;
        newBuffer[newPixelOffset + 5] = bExponent << 2;
        newBuffer[newPixelOffset + 6] = 0;
        newBuffer[newPixelOffset + 7] = 0x3C;
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
    case TypeFormat.Float:
        return GfxFormat.F16_RGBA;
    default:
        throw "whoops";
    }
}
