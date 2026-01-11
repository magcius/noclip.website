// bntx_helpers.ts
// the fres_nx code supports version v0.4.0.0, which Tokyo Mirage Sessions ♯FE uses
// these functions build off that code

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as BNTX from '../fres_nx/bntx.js';
import { GfxDevice, makeTextureDescriptor2D, GfxTexture } from '../gfx/platform/GfxPlatform.js';
import { getChannelFormat } from '../fres_nx/nngfx_enum.js';
import { deswizzle, decompress, translateImageFormat } from "../fres_nx/tegra_texture.js";

// textures in a bntx file are swizzled, where the texture data is rearranged for performance reasons
// this is not supported, and if rendered as is, these textures will look garbled
// so it's necessary to deswizzle the textures to get the original data back
// the deswizzle function is asynchronous, so this function also handles uploading the textures as well
// buffer: the bntx file
// returns a GfxTexture array of the uploaded textures
export function deswizzle_and_upload_bntx_textures(buffer: ArrayBufferSlice, device: GfxDevice): GfxTexture[]
{
    const bntx = BNTX.parse(buffer);
    const gfx_texture_array: GfxTexture[] = [];

    for (let i = 0; i < bntx.textures.length; i++)
    {
        const texture = bntx.textures[i];

        // create gfx textures
        const new_format = translateImageFormat(texture.imageFormat);
        const texture_descriptor = makeTextureDescriptor2D(new_format, texture.width, texture.height, texture.mipBuffers.length);
        const gfx_texture = device.createTexture(texture_descriptor);
        gfx_texture_array.push(gfx_texture);

        // deswizzle textures before uploading
        const channelFormat = getChannelFormat(texture.imageFormat);

        for (let i = 0; i < texture.mipBuffers.length; i++)
        {
            const mipLevel = i;

            const buffer = texture.mipBuffers[i];
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
                    device.uploadTextureData(gfx_texture, mipLevel, [rgbaPixels]);
                }
            );
        }
    }

    return gfx_texture_array;
}
