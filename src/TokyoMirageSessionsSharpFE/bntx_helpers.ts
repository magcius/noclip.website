// bntx_helpers.ts
// the fres_nx code supports version v0.4.0.0, which Tokyo Mirage Sessions ♯FE uses
// these functions build off that code

import * as BNTX from '../fres_nx/bntx.js';
import { GfxDevice, makeTextureDescriptor2D, GfxTexture, GfxFormat } from '../gfx/platform/GfxPlatform.js';
import { getChannelFormat } from '../fres_nx/nngfx_enum.js';
import { deswizzle, decompress, translateImageFormat } from "../fres_nx/tegra_texture.js";

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
        // console.log(`${texture.name} ${texture.imageFormat}`);
        console.log(texture);

        // create gfx textures
        const new_format = translateImageFormat(texture.imageFormat);
        const texture_descriptor = makeTextureDescriptor2D(new_format, texture.width, texture.height, texture.mipBuffers.length);
        const gfx_texture = device.createTexture(texture_descriptor);
        gfx_texture_array.push(gfx_texture);

        if (new_format == GfxFormat.F16_RGBA)
        {
            const channelFormat = getChannelFormat(texture.imageFormat);

            for (let mipLevel = 0; mipLevel < texture.mipBuffers.length; mipLevel++)
            {

                const buffer = texture.mipBuffers[mipLevel];
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

                        // const remapped_rgba_pixels = remap_channels(rgbaPixels, texture.channelMapping);
                        // const test = texture.mipBuffers[mipLevel].createTypedArray(Uint16Array);
                        
                        // const test2 = buffer.createTypedArray(Uint8Array);
                        const test = new Uint16Array(rgbaPixels.buffer);
                        
                        // const test = new Uint16Array(rgbaPixels.buffer);
                        // let offset = 0;
                        // let offset2 = 0;
                        // for (let i = 0; i < rgbaPixels.byteLength / 2; i++)
                        // {
                        //     const byte1 = rgbaPixels[offset2++];
                        //     const byte2 = rgbaPixels[offset2++];
                        //     const combined = (byte2 << 0x8) + byte1;
                        //     test[offset++] = combined;
                        // }


                        device.uploadTextureData(gfx_texture, mipLevel, [test]);
                    }
                );

                // don't deswizzle for now
                // const buffer = texture.mipBuffers[mipLevel].createTypedArray(Uint16Array);
            }
        }
        else
        {
            // deswizzle textures before uploading
            const channelFormat = getChannelFormat(texture.imageFormat);

            for (let mipLevel = 0; mipLevel < texture.mipBuffers.length; mipLevel++)
            {

                const buffer = texture.mipBuffers[mipLevel];
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
                        const remapped_rgba_pixels = remap_channels(rgbaPixels, texture.channelMapping);
                        device.uploadTextureData(gfx_texture, mipLevel, [remapped_rgba_pixels]);
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
 * @param channel_mapping an array containing 4 numbers, each specifying which channel to use for the R, G, B, and A channel of the final texture
 * @returns a remapped rgba_pixels array
 */
function remap_channels(rgba_pixels: Uint8Array | Int8Array, channel_mapping: number[]): Uint8Array | Int8Array
{
    let offset = 0;
    for (let i = 0; i < rgba_pixels.byteLength / 4; i++)
    {
        const red = rgba_pixels[i * 4];
        const green = rgba_pixels[i * 4 + 1];
        const blue = rgba_pixels[i * 4 + 2];
        const alpha = rgba_pixels[i * 4 + 3];
        const channel_array = [0, 0xFF, red, green, blue, alpha];
        rgba_pixels[offset++] = channel_array[channel_mapping[0]];
        rgba_pixels[offset++] = channel_array[channel_mapping[1]];
        rgba_pixels[offset++] = channel_array[channel_mapping[2]];
        rgba_pixels[offset++] = channel_array[channel_mapping[3]];
    }

    return rgba_pixels;
}
