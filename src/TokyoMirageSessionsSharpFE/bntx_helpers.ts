// bntx_helpers.ts
// the fres_nx code supports version v0.4.0.0, which Tokyo Mirage Sessions ♯FE uses
// these functions build off that code

import * as BNTX from '../fres_nx/bntx.js';
import { GfxDevice, makeTextureDescriptor2D, GfxTexture, GfxFormat, GfxTextureDimension, GfxTextureUsage } from '../gfx/platform/GfxPlatform.js';
import { getChannelFormat, ChannelFormat, getTypeFormat, TypeFormat } from '../fres_nx/nngfx_enum.js';
import { rust } from "../rustlib.js";
import { deswizzle, decompress, translateImageFormat } from "../fres_nx/tegra_texture.js";
import { assert } from '../util.js';

/**
 * textures in a bntx file are swizzled, where the texture data is rearranged for performance reasons.
 * this is not supported, and if rendered as is, these textures will look garbled.
 * so it's necessary to deswizzle the textures to get the original data back.
 * the deswizzle function is asynchronous, so this function also handles uploading the textures as well
 * @param bntx the bntx object containing all the textures
 * @returns a GfxTexture array of the uploaded textures
 */
export function deswizzle_and_upload_bntx_textures(bntx: BNTX.BNTX, device: GfxDevice): GfxTexture[]
{
    const gfx_texture_array: GfxTexture[] = [];

    for (let texture_index = 0; texture_index < bntx.textures.length; texture_index++)
    {
        const texture = bntx.textures[texture_index];

        // normal texture
        if (texture.imageDimension === 1)
        {
            // create gfx textures
            const new_format = translateImageFormat(texture.imageFormat);
            const mip_count = texture.textureDataArray[0].mipBuffers.length;
            const texture_descriptor = makeTextureDescriptor2D(new_format, texture.width, texture.height, mip_count);
            const gfx_texture = device.createTexture(texture_descriptor);
            gfx_texture_array.push(gfx_texture);

            // deswizzle textures before uploading
            const channelFormat = getChannelFormat(texture.imageFormat);

            for (let mipLevel = 0; mipLevel < mip_count; mipLevel++)
            {
                const buffer = texture.textureDataArray[0].mipBuffers[mipLevel];
                const width = Math.max(texture.width >>> mipLevel, 1);
                const height = Math.max(texture.height >>> mipLevel, 1);
                const depth = 1;
                const blockHeightLog2 = texture.blockHeightLog2;
                deswizzle({ buffer, width, height, channelFormat, blockHeightLog2 })
                .then
                (
                    (deswizzled) =>
                    {
                        const rgbaTexture = decompress({ ...texture, width, height, depth }, deswizzled);
                        const rgbaPixels = rgbaTexture.pixels;
                        // TODO remap for uint16 arrays
                        const remapped_rgba_pixels = remap_channels(rgbaPixels, texture.channelSource);
                        device.uploadTextureData(gfx_texture, mipLevel, [remapped_rgba_pixels]);
                    }
                );
            }
        }
        // cubemap
        else
        {
            assert(texture.imageDimension === 3);

            // create gfx texture
            const new_format = translateImageFormat(texture.imageFormat);
            const mip_count = texture.textureDataArray[0].mipBuffers.length;

            const texture_descriptor = makeTextureDescriptor2D(new_format, texture.width, texture.height, mip_count);
            const gfx_texture = device.createTexture(texture_descriptor);
            gfx_texture_array.push(gfx_texture);

            // const gfx_texture = device.createTexture
            // ({
            //     dimension: GfxTextureDimension.Cube,
            //     pixelFormat: new_format,
            //     width: texture.width,
            //     height: texture.width,
            //     depthOrArrayLayers: 6,
            //     numLevels: mip_count,
            //     usage: GfxTextureUsage.Sampled
            // });
            // gfx_texture_array.push(gfx_texture);

            // TODO: this somehow causes a memory leak
            // this should be done after deswizzle

            // rearrange the mip buffers
            // each buffer is all the textures at a mip level smashed together
            // const new_mip_buffer_array: Uint8Array[] = [];
            // for (let mip_level = 0; mip_level < mip_count; mip_level++)
            // {
            //     const original_byte_length = texture.textureDataArray[0].mipBuffers[mip_level].byteLength;
            //     const new_byte_length = original_byte_length * texture.arraySize
            //     const new_mip_buffer = new Uint8Array(new_byte_length);
            //     for(texture_index = 0; texture_index < texture.arraySize; texture_index++)
            //     {
            //         const old_mip_buffer = texture.textureDataArray[texture_index].mipBuffers[mip_level].createTypedArray(Uint8Array);
            //         const offset = original_byte_length * texture_index;
            //         new_mip_buffer.set(old_mip_buffer, offset);
            //     }
            //     new_mip_buffer_array.push(new_mip_buffer);
            // }

            // deswizzle textures before uploading
            // for (let mipLevel = 0; mipLevel < mip_count; mipLevel++)
            // {
            //     const buffer = new_mip_buffer_array[mipLevel];
            //     const width = Math.max(texture.width >>> mipLevel, 1);
            //     const height = Math.max(texture.height >>> mipLevel, 1);
            //     const depth = 1;
            //     const blockHeightLog2 = texture.blockHeightLog2;

            //     deswizzle_uint8_array(buffer, width, height, blockHeightLog2)
            //     .then
            //     (
            //         (deswizzled) =>
            //         {
            //             const rgbaTexture = decompress({ ...texture, width, height, depth }, deswizzled);
            //             const rgbaPixels = rgbaTexture.pixels;
            //             const test = new Uint16Array(rgbaPixels.buffer);
            //             // const remapped_rgba_pixels = remap_channels(rgbaPixels, texture.channelMapping);
            //             device.uploadTextureData(gfx_texture, mipLevel, [test]);
            //         }
            //     );
            // }
            const channelFormat = getChannelFormat(texture.imageFormat);

            for (let mipLevel = 0; mipLevel < mip_count; mipLevel++)
            {
                const buffer = texture.textureDataArray[0].mipBuffers[mipLevel];
                const width = Math.max(texture.width >>> mipLevel, 1);
                const height = Math.max(texture.height >>> mipLevel, 1);
                const depth = 1;
                const blockHeightLog2 = texture.blockHeightLog2;
                deswizzle({ buffer, width, height, channelFormat, blockHeightLog2 })
                .then
                (
                    (deswizzled) =>
                    {
                        const rgbaTexture = decompress({ ...texture, width, height, depth }, deswizzled);
                        const rgbaPixels = rgbaTexture.pixels;
                        const type_format = getTypeFormat(texture.imageFormat);
                        if (type_format === TypeFormat.Float)
                        {
                            const test = new Uint16Array(rgbaPixels.buffer);
                            // TODO: remap channels
                            device.uploadTextureData(gfx_texture, mipLevel, [test]);
                        }
                        else
                        {
                            const remapped_rgba_pixels = remap_channels(rgbaPixels, texture.channelSource);
                            device.uploadTextureData(gfx_texture, mipLevel, [remapped_rgba_pixels]);
                        }
                    }
                );
            }
        }
    }

    return gfx_texture_array;
}

/**
 * textures can specify a mapping between each channel of the texture data and the final texture's channels.
 * for example, a monochrome texture might use the red channel for RGB, and use the green channel for A.
 * before uploading the texture to the gpu, we need to apply this mapping to get the final texture data.
 * @param rgba_pixels the texture data in RGBA format
 * @param channel_source an array containing 4 numbers, each specifying which channel to use for the R, G, B, and A channel of the final texture
 * @returns a remapped rgba_pixels array
 */
function remap_channels(rgba_pixels: Uint8Array | Int8Array, channel_source: number[]): Uint8Array | Int8Array
{
    let offset = 0;
    for (let i = 0; i < rgba_pixels.byteLength / 4; i++)
    {
        const red = rgba_pixels[i * 4];
        const green = rgba_pixels[i * 4 + 1];
        const blue = rgba_pixels[i * 4 + 2];
        const alpha = rgba_pixels[i * 4 + 3];
        const channel_array = [0, 0xFF, red, green, blue, alpha];
        rgba_pixels[offset++] = channel_array[channel_source[0]];
        rgba_pixels[offset++] = channel_array[channel_source[1]];
        rgba_pixels[offset++] = channel_array[channel_source[2]];
        rgba_pixels[offset++] = channel_array[channel_source[3]];
    }

    return rgba_pixels;
}

// export async function deswizzle_uint8_array(buffer: Uint8Array, channel_format: ChannelFormat, width: number, height: number, blockHeightLog2: number): Promise<Uint8Array<ArrayBuffer>>
// {
//     const compression_type =
//     channel_format === ChannelFormat.Bc1 ? rust.CompressionType.Bc1 :
//     channel_format === ChannelFormat.Bc2 ? rust.CompressionType.Bc2 :
//     channel_format === ChannelFormat.Bc3 ? rust.CompressionType.Bc3 :
//     channel_format === ChannelFormat.Bc4 ? rust.CompressionType.Bc4 :
//     channel_format === ChannelFormat.Bc5 ? rust.CompressionType.Bc5 :
//     rust.CompressionType.None;
//     return rust.tegra_deswizzle(buffer, compression_type, width, height, blockHeightLog2) as Uint8Array<ArrayBuffer>;
// }
