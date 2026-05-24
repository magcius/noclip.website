// bntx_helpers.ts
// functions for dealing with textures from BNTX files

import * as BNTX from '../fres_nx/bntx.js';
import * as GfxPlatform from "../gfx/platform/GfxPlatform";
import * as nngfx_enum from "../fres_nx/nngfx_enum";
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
export function deswizzle_and_upload_bntx_textures(bntx: BNTX.BNTX, device: GfxPlatform.GfxDevice): GfxPlatform.GfxTexture[]
{
    const gfx_texture_array: GfxPlatform.GfxTexture[] = [];

    for (let texture_index = 0; texture_index < bntx.textures.length; texture_index++)
    {
        const texture = bntx.textures[texture_index];
        const new_format = translateImageFormat(texture.imageFormat);
        const mip_count = texture.textureDataArray[0].mipBuffers.length;

        if (texture.imageDimension === 1)
        {
            // normal texture
            const texture_descriptor = GfxPlatform.makeTextureDescriptor2D(new_format, texture.width, texture.height, mip_count);
            const gfx_texture = device.createTexture(texture_descriptor);
            gfx_texture_array.push(gfx_texture);
            deswizzle_and_upload_standard(texture, mip_count, device, gfx_texture);
        }
        else
        {
            // cubemap
            // TODO: properly upload these, I think they need a different sampler descriptor
            assert(texture.imageDimension === 3);
            assert(texture.arraySize === 6);

            const texture_descriptor = GfxPlatform.makeTextureDescriptor2D(new_format, texture.width, texture.height, mip_count);
            const gfx_texture = device.createTexture(texture_descriptor);
            gfx_texture_array.push(gfx_texture);
            deswizzle_and_upload_standard(texture, mip_count, device, gfx_texture);

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

            // deswizzle_and_upload_cubemap(texture, mip_count, device, gfx_texture);
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
function remap_r8_g8_b8_a8_channels(rgba_pixels: Uint8Array | Int8Array, channel_source: nngfx_enum.ChannelSource[]): Uint8Array | Int8Array
{
    const pixel_count = rgba_pixels.length / 4;
    let offset = 0;
    for (let i = 0; i < pixel_count; i++)
    {
        const r = rgba_pixels[i * 4 + 0];
        const g = rgba_pixels[i * 4 + 1];
        const b = rgba_pixels[i * 4 + 2];
        const a = rgba_pixels[i * 4 + 3];
        const channel_array = [0, 0xFF, r, g, b, a];
        rgba_pixels[offset++] = channel_array[channel_source[0]];
        rgba_pixels[offset++] = channel_array[channel_source[1]];
        rgba_pixels[offset++] = channel_array[channel_source[2]];
        rgba_pixels[offset++] = channel_array[channel_source[3]];
    }

    return rgba_pixels;
}

function remap_r16_g16_b16_a16_float_channels(rgba_pixels: Uint8Array | Int8Array, channel_source: nngfx_enum.ChannelSource[]): Uint16Array
{
    let buffer = new Uint16Array(rgba_pixels.buffer);
    const pixel_count = buffer.length / 4;
    let offset = 0;
    for (let i = 0; i < pixel_count; i++)
    {
        const r = buffer[i * 4 + 0];
        const g = buffer[i * 4 + 1];
        const b = buffer[i * 4 + 2];
        const a = buffer[i * 4 + 3];
        const channel_array = [0, 0x003C, r, g, b, a];
        buffer[offset++] = channel_array[channel_source[0]];
        buffer[offset++] = channel_array[channel_source[1]];
        buffer[offset++] = channel_array[channel_source[2]];
        buffer[offset++] = channel_array[channel_source[3]];
    }

    return buffer;
}

async function deswizzle_and_upload_standard(texture: BNTX.BRTI, mip_count: number, device: GfxPlatform.GfxDevice, gfx_texture: GfxPlatform.GfxTexture)
{
    const channelFormat = nngfx_enum.getChannelFormat(texture.imageFormat);
    const type_format = nngfx_enum.getTypeFormat(texture.imageFormat);

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
                let remapped_rgba_pixels;
                if (type_format === nngfx_enum.TypeFormat.Float)
                {
                    remapped_rgba_pixels = remap_r16_g16_b16_a16_float_channels(rgbaTexture.pixels, texture.channelSource);
                }
                else
                {
                    remapped_rgba_pixels = remap_r8_g8_b8_a8_channels(rgbaTexture.pixels, texture.channelSource);
                }
                device.uploadTextureData(gfx_texture, mipLevel, [remapped_rgba_pixels]);
            }
        );
    }
}

async function deswizzle_and_upload_cubemap(texture: BNTX.BRTI, mip_count: number, device: GfxPlatform.GfxDevice, gfx_texture: GfxPlatform.GfxTexture)
{
    const channelFormat = nngfx_enum.getChannelFormat(texture.imageFormat);
    const type_format = nngfx_enum.getTypeFormat(texture.imageFormat);

    for (let mipLevel = 0; mipLevel < mip_count; mipLevel++)
    {
        let buffers_for_this_mip_level: ArrayBufferView[] = [];

        for (let array_index = 0; array_index < texture.arraySize; array_index++)
        {
            const buffer = texture.textureDataArray[0].mipBuffers[mipLevel];
            const width = Math.max(texture.width >>> mipLevel, 1);
            const height = Math.max(texture.height >>> mipLevel, 1);
            const depth = 1;
            const blockHeightLog2 = texture.blockHeightLog2;
            const deswizzled = await deswizzle({ buffer, width, height, channelFormat, blockHeightLog2 });
            const rgbaTexture = decompress({ ...texture, width, height, depth }, deswizzled);
            buffers_for_this_mip_level.push(rgbaTexture.pixels);
        }
        console.log(buffers_for_this_mip_level);

        // combine each texture's buffer for this mip level into a single buffer
        const single_texture_size = buffers_for_this_mip_level[0].byteLength;
        const combined_buffer_size = single_texture_size * buffers_for_this_mip_level.length;
        let combined_buffer = new Uint8Array(combined_buffer_size);
        for (let texture_index = 0; texture_index < buffers_for_this_mip_level.length; texture_index++)
        {
            const offset = single_texture_size * texture_index;
            combined_buffer.set(buffers_for_this_mip_level[texture_index] as Uint8Array, offset);
        }

        if (type_format === nngfx_enum.TypeFormat.Float)
        {
            device.uploadTextureData(gfx_texture, mipLevel, [new Uint16Array(combined_buffer)]);
        }
        else
        {
            device.uploadTextureData(gfx_texture, mipLevel, [combined_buffer]);
        }
    }
}
