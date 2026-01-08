// bntx.ts
// handles data in a BNTX (Binary Nx TeXture) file, an archive containing all the textures for a model

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";
import { read_bfres_string } from "./bfres/bfres_switch.js";
import { GfxFormat } from "../gfx/platform/GfxPlatform.js";

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
        const format = view.getUint32(texture_info_offset + 0x1C, true);
        const mipmap_count = view.getUint16(texture_info_offset + 0x16, true);
        const mipmap_offset_array_offset = view.getUint32(texture_info_offset + 0x70, true);
        // only the pointers to the start of each mipmap are in the file
        // so we get slices from i to i+1
        // but this doesn't work for the last one
        const mipmap_buffers: ArrayBufferSlice[] = [];
        let mipmap_array_entry_offset = mipmap_offset_array_offset;
        for(let i = 0; i < mipmap_count - 1; i++)
        {
            const start = view.getUint32(mipmap_array_entry_offset, true);
            const end = view.getUint32(mipmap_array_entry_offset + 0x8, true);
            const mipmap_buffer = buffer.slice(start, end);
            mipmap_buffers.push(mipmap_buffer);
            mipmap_array_entry_offset += 0x8;
        }
        // get last mipmap manually
        const total_texture_size = view.getUint32(texture_info_offset + 0x50, true);
        const start = view.getUint32(mipmap_offset_array_offset + (mipmap_count - 1) * 0x8, true);
        const end = view.getUint32(mipmap_offset_array_offset, true) + total_texture_size;
        const mipmap_buffer = buffer.slice(start, end);
        mipmap_buffers.push(mipmap_buffer);

        texture_array.push({ name, format, width, height, depth, mipmap_buffers });
        texture_info_entry_offset += TEXTURE_INFO_ARRAY_ENTRY_SIZE;
    }

    return { textures: texture_array };
}

function convert_image_format(format: ImageFormat): GfxFormat
{
    switch (format)
    {
        case ImageFormat.Bc1_Unorm:
        case ImageFormat.Bc2_Unorm:
        case ImageFormat.Bc3_Unorm:
        case ImageFormat.Bc4_Unorm:
        case ImageFormat.Bc5_Unorm:
        case ImageFormat.R8_Unorm:
        case ImageFormat.R8_G8_B8_A8_Unorm:
            return GfxFormat.U8_RGBA_NORM;

        case ImageFormat.Bc1_UnormSrgb:
        case ImageFormat.Bc2_UnormSrgb:
        case ImageFormat.Bc3_UnormSrgb:
            return GfxFormat.U8_RGBA_SRGB;

        case ImageFormat.Bc4_Snorm:
        case ImageFormat.Bc5_Snorm:
            return GfxFormat.S8_RGBA_NORM;
        
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
    format: ImageFormat;
    width: number;
    height: number;
    depth: number;
    mipmap_buffers: ArrayBufferSlice[]; // where the actual texture data is
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
