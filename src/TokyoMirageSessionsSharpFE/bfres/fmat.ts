// fmat.ts
// Handles FMAT (caFe MATerial) data, which are materials for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";
import { user_data, parse_user_data } from "./user_data.js";
import { GfxCompareMode, GfxMipFilterMode, GfxSamplerDescriptor, GfxTexFilterMode, GfxWrapMode } from "../../gfx/platform/GfxPlatform.js";

// reads from a bfres file and returns an array of FMAT objects
// buffer: the bfres file
// offset: start of the fmat array
// count: number of fmat objects in the array
export function parseFMAT(buffer: ArrayBufferSlice, offset: number, count: number): FMAT[]
{
    const view = buffer.createDataView();

    const fmat_array: FMAT[] = [];
    let fmat_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fmat_entry_offset, 0x04) === 'FMAT');

        const name_offset = view.getUint32(fmat_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset, true);
        
        const texture_name_array_offset = view.getUint32(fmat_entry_offset + 0x30, true);
        const texture_name_count = view.getUint8(fmat_entry_offset + 0x9D);
        const texture_name_array: string[] = [];
        let texture_name_entry_offset = texture_name_array_offset;
        for (let i = 0; i < texture_name_count; i++)
        {
            const texture_name_offset = view.getUint32(texture_name_entry_offset, true);
            const texture_name = read_bfres_string(buffer, texture_name_offset, true);
            
            texture_name_array.push(texture_name);
            texture_name_entry_offset += TEXTURE_NAME_ENTRY_SIZE;
        }

        const sampler_info_array_offset = view.getUint32(fmat_entry_offset + 0x40, true);
        const sampler_info_count = view.getUint8(fmat_entry_offset + 0x9C);
        let samplers: GfxSamplerDescriptor[] = [];
        let sampler_info_entry_offset = sampler_info_array_offset;
        for (let i = 0; i < sampler_info_count; i++)
        {
            const original_wrap_s = view.getUint8(sampler_info_entry_offset);
            const wrap_s = convert_wrap_mode(original_wrap_s);
            const original_wrap_t = view.getUint8(sampler_info_entry_offset + 0x1);
            const wrap_t = convert_wrap_mode(original_wrap_t);
            const original_wrap_q = view.getUint8(sampler_info_entry_offset + 0x2);
            const wrap_q = convert_wrap_mode(original_wrap_q);

            const depth_compare: GfxCompareMode = view.getUint8(sampler_info_entry_offset + 0x3);
            // const border_color = view.getUint8(sampler_info_entry_offset + 0x4);
            const max_anisotropy = view.getUint8(sampler_info_entry_offset + 0x5);
            const filters = view.getUint16(sampler_info_entry_offset + 0x6, true);

            const original_mipmap_filter = filters & 0x3;
            const mipmap_filter = convert_mip_filter_mode(original_mipmap_filter);
            const original_mag_filter = filters >> 2 & 0x3;
            const mag_filter = convert_tex_filter_mode(original_mag_filter);
            const original_min_filter = filters >> 4 & 0x3;
            const min_filter = convert_tex_filter_mode(original_min_filter);

            const lod_min = view.getFloat32(sampler_info_entry_offset + 0x8, true);
            const lod_max = view.getFloat32(sampler_info_entry_offset + 0xC, true);
            // const lod_bias = view.getFloat32(sampler_info_entry_offset + 0x10, true);

            samplers.push
            ({
                wrapS: wrap_s,
                wrapT: wrap_t,
                wrapQ: wrap_q,
                minFilter: min_filter,
                magFilter: mag_filter,
                mipFilter: mipmap_filter,
                minLOD: lod_min,
                maxLOD: lod_max,
                compareMode: depth_compare,
            });
            sampler_info_entry_offset += SAMPLER_INFO_ENTRY_SIZE;
        }

        const user_data_array_offset = view.getUint32(fmat_entry_offset + 0x68, true);
        const user_data_count = view.getUint16(fmat_entry_offset + 0xA6, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);
        

        fmat_array.push({ name, texture_names: texture_name_array, samplers, user_data: user_data_array });
        fmat_entry_offset += FMAT_ENTRY_SIZE;
    }

    return fmat_array;
}

const FMAT_ENTRY_SIZE = 0xA8;
const TEXTURE_NAME_ENTRY_SIZE = 0x8;
const SAMPLER_INFO_ENTRY_SIZE = 0x20;

export interface FMAT
{
    name: string;
    texture_names: string[];
    samplers: GfxSamplerDescriptor[];
    user_data: user_data[];
}

enum WrapMode
{
    Repeat,
    Mirror,
    Clamp,
}

// Convert the wrap mode number to the correspoding noclip.website one
// input: wrap mode number to convert
function convert_wrap_mode(input: WrapMode)
{
    switch(input)
    {
        case WrapMode.Repeat:
            return GfxWrapMode.Repeat;
        
        case WrapMode.Mirror:
            return GfxWrapMode.Mirror;
        
        case WrapMode.Clamp:
            return GfxWrapMode.Clamp;

        default:
            console.error(`wrap mode ${input} not found`);
            throw "whoops";
    }
}

export enum FilterMode
{
    None,
    Point,
    Linear,
}

// Convert the filter mode number to the correspoding noclip.website one
// input: filter mode number to convert
function convert_tex_filter_mode(input: FilterMode)
{
    switch(input)
    {
        case FilterMode.Point:
            return GfxTexFilterMode.Point;
        
        case FilterMode.Linear:
            return GfxTexFilterMode.Bilinear;

        default:
            console.error(`texture filter mode ${input} not found`);
            throw "whoops";
    }
}

function convert_mip_filter_mode(input: FilterMode)
{
    switch(input)
    {
        case FilterMode.Point:
            return GfxMipFilterMode.Nearest;
        
        case FilterMode.Linear:
            return GfxMipFilterMode.Linear;

        default:
            console.error(`mip filter mode ${input} not found`);
            throw "whoops";
    }
}
