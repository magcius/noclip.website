// bntx.ts
// handles data in a BNTX (Binary Nx TeXture) file, an archive containing all the textures for a model

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";
import { read_bfres_string } from "./bfres/bfres_switch.js";
import { GfxFormat } from "../gfx/platform/GfxPlatform.js";
import { calcMipLevelByteSize } from "../gfx/helpers/TextureHelpers.js";
import { GfxTexture } from "../gfx/platform/GfxPlatform.js";

export function parseBNTX(buffer: ArrayBufferSlice): BNTX
{
    const view = buffer.createDataView();
    assert(readString(buffer, 0x0, 0x04) === 'BNTX');

    const texture_container_offset = 0x20;
    assert(readString(buffer, texture_container_offset, 0x04) === 'NX  ');
    const texture_count = view.getUint32(texture_container_offset + 0x4, true);

    const texture_info_array_offset = view.getUint32(texture_container_offset + 0x8, true);
    const TEXTURE_INFO_ARRAY_ENTRY_SIZE = 0x08;
    let texture_array: Texture[] = [];
    let texture_info_entry_offset = texture_info_array_offset;
    for(let i = 0; i < texture_count; i++)
    {
        // the array is just offsets to each texture info
        const texture_info_offset = view.getUint32(texture_info_entry_offset, true);
        assert(readString(buffer, texture_info_offset, 0x04) === 'BRTI');

        const name_offset = view.getUint32(texture_info_offset + 0x60, true);
        const name = read_bfres_string(buffer, name_offset, true);
        
        const width = view.getUint32(texture_info_offset + 0x24, true);
        const height = view.getUint32(texture_info_offset + 0x28, true);
        const depth = view.getUint32(texture_info_offset + 0x2C, true);
        const original_format = view.getUint32(texture_info_offset + 0x1C, true);
        const format = convert_image_format(original_format);
        const total_texture_size = view.getUint32(texture_info_offset + 0x50, true);

        const mipmap_count = view.getUint16(texture_info_offset + 0x16, true);
        const mipmap_offset_array_offset = view.getUint32(texture_info_offset + 0x70, true);
        const mipmap_buffers: Uint8Array[] = [];
        let mipmap_array_entry_offset = mipmap_offset_array_offset;
        for(let i = 0; i < mipmap_count; i++)
        {
            const start_offset = view.getUint32(mipmap_array_entry_offset, true);
            
            // divide by 2 per mip level, but also make sure each dimension is at least 1
            const mip_width = Math.max(width >>> i, 1);
            const mip_height = Math.max(height >>> i, 1);
            
            let size = calcMipLevelByteSize(format, mip_width, mip_height, depth);
            let mipmap_buffer: Uint8Array = buffer.subarray(start_offset, size).createTypedArray(Uint8Array);

            mipmap_buffers.push(mipmap_buffer);
            mipmap_array_entry_offset += 0x8;
        }

        texture_array.push({ name, format, width, height, depth, mipmap_buffers, gfx_texture: null });
        texture_info_entry_offset += TEXTURE_INFO_ARRAY_ENTRY_SIZE;
    }

    return { textures: texture_array };
}

// Convert the format numbers used by BNTX textures into a format number that noclip.website understands
// format: BNTX image format number to convert
function convert_image_format(format: ImageFormat): GfxFormat
{
    switch (format)
    {
        case ImageFormat.Bc1_Unorm:
            return GfxFormat.BC1;

        case ImageFormat.Bc2_Unorm:
            return GfxFormat.BC2;

        case ImageFormat.Bc3_Unorm:
            return GfxFormat.BC3;

        case ImageFormat.Bc4_Unorm:
            return GfxFormat.BC4_UNORM;

        case ImageFormat.Bc5_Unorm:
            return GfxFormat.BC5_UNORM;

        // case ImageFormat.R8_Unorm:
        // case ImageFormat.R8_G8_B8_A8_Unorm:
            
        case ImageFormat.Bc1_UnormSrgb:
            return GfxFormat.BC1_SRGB;

        case ImageFormat.Bc2_UnormSrgb:
            return GfxFormat.BC2_SRGB;

        case ImageFormat.Bc3_UnormSrgb:
            return GfxFormat.BC3_SRGB;

        case ImageFormat.Bc4_Snorm:
            return GfxFormat.BC4_SNORM;

        case ImageFormat.Bc5_Snorm:
            return GfxFormat.BC5_SNORM;
        
        default:
            console.error(`image format ${format} not found`);
            throw "whoops";
    }
}

export interface BNTX
{
    textures: Texture[];
}

export interface Texture
{
    name: string;
    format: GfxFormat;
    width: number;
    height: number;
    depth: number;
    mipmap_buffers: Uint8Array[]; // where the actual texture data is
    gfx_texture: GfxTexture | null;
}

export enum ImageFormat
{
    Bc1_Unorm         = 0x1A01,
    Bc1_UnormSrgb     = 0x1A06,
    Bc2_Unorm         = 0x1B01,
    Bc2_UnormSrgb     = 0x1B06,
    Bc3_Unorm         = 0x1C01,
    Bc3_UnormSrgb     = 0x1C06,
    Bc4_Unorm         = 0x1D01,
    Bc4_Snorm         = 0x1D02,
    Bc5_Unorm         = 0x1E01,
    Bc5_Snorm         = 0x1E02,
    R8_Unorm          = 0x0201,
    R8_G8_B8_A8_Unorm = 0x0B01,
}
