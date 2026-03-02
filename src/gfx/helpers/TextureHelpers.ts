
import { GfxColor, GfxDevice, GfxFormat, GfxTexture, makeTextureDescriptor2D } from "../platform/GfxPlatform.js";
import { getFormatBlockSizeInTexels, getFormatByteSizePerBlock } from "../platform/GfxPlatformFormat.js";

/**
 * Creates a new {@type GfxTexture} containing the given {@param color}; the texture is 1x1, is of format
 * {@see GfxFormat.U8_RGBA_NORM}, and contains only one mipmap.
 */
export function makeSolidColorTexture2D(device: GfxDevice, color: GfxColor): GfxTexture {
    const tex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
    const data = new Uint8Array(4);
    data[0] = color.r * 0xFF;
    data[1] = color.g * 0xFF;
    data[2] = color.b * 0xFF;
    data[3] = color.a * 0xFF;
    device.uploadTextureData(tex, 0, [data]);
    return tex;
}

/**
 * Creates a new {@type GfxTexture} for the given {@param imageBitmap}; the returned texture is currently
 * of format {@see GfxFormat.U8_RGBA_NORM}, and contains only one mipmap.
 */
export function makeImageBitmapTexture2D(device: GfxDevice, imageBitmap: ImageBitmap): GfxTexture {
    const tex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, imageBitmap.width, imageBitmap.height, 1));
    device.copyExternalImageToTexture(tex, 0, imageBitmap);
    return tex;
}

/**
 * Computes the total byte size of one mip level of a texture with {@param fmt}, taking block-compression into account.
 * The mip level should have the size {@param width}x{@param height}x{@param depth}.
 * To compute these numbers from an overall top mip level and mip level index, use {@example width >>> mipLevel}.
 */
export function calcMipLevelByteSize(fmt: GfxFormat, width: number, height: number, depth: number = 1): number {
    const blockSize = getFormatBlockSizeInTexels(fmt);
    const numBlocksX = Math.ceil(width / blockSize);
    const numBlocksY = Math.ceil(height / blockSize);
    return numBlocksX * numBlocksY * depth * getFormatByteSizePerBlock(fmt);
}
