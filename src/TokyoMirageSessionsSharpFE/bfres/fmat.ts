// fmat.ts
// Handles FMAT (caFe MATerial) data, which are materials for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { GfxCompareMode, GfxMipFilterMode, GfxSamplerDescriptor, GfxTexFilterMode, GfxWrapMode } from "../../gfx/platform/GfxPlatform.js";
import { user_data, parse_user_data } from "./user_data.js";
import { assert, readString } from "../../util.js";

/**
 * reads from a bfres file and returns an array of FMAT objects
 * @param buffer the bfres file
 * @param offset start of the fmat array
 * @param count number of fmat objects in the array
 */
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
        const texture_count = view.getUint8(fmat_entry_offset + 0x9D);
        const texture_name_array: string[] = [];
        let texture_name_entry_offset = texture_name_array_offset;
        for (let i = 0; i < texture_count; i++)
        {
            const texture_name_offset = view.getUint32(texture_name_entry_offset, true);
            const texture_name = read_bfres_string(buffer, texture_name_offset, true);
            
            texture_name_array.push(texture_name);
            texture_name_entry_offset += TEXTURE_NAME_ENTRY_SIZE;
        }

        const sampler_info_array_offset = view.getUint32(fmat_entry_offset + 0x40, true);
        const sampler_count = view.getUint8(fmat_entry_offset + 0x9C);
        let sampler_descriptors: GfxSamplerDescriptor[] = [];
        let sampler_info_entry_offset = sampler_info_array_offset;
        for (let i = 0; i < sampler_count; i++)
        {
            const original_wrap_s = view.getUint8(sampler_info_entry_offset);
            const wrap_s = convert_wrap_mode(original_wrap_s);
            const original_wrap_t = view.getUint8(sampler_info_entry_offset + 0x1);
            const wrap_t = convert_wrap_mode(original_wrap_t);
            const original_wrap_q = view.getUint8(sampler_info_entry_offset + 0x2);
            const wrap_q = convert_wrap_mode(original_wrap_q);

            const original_depth_compare = view.getUint8(sampler_info_entry_offset + 0x3);
            const depth_compare = convert_depth_compare_mode(original_depth_compare);
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

            sampler_descriptors.push
            ({
                wrapS: wrap_s,
                wrapT: wrap_t,
                wrapQ: wrap_q,
                minFilter: min_filter,
                magFilter: mag_filter,
                mipFilter: mipmap_filter,
                minLOD: lod_min,
                maxLOD: lod_max,
                maxAnisotropy: max_anisotropy,
                compareMode: depth_compare,
            });
            sampler_info_entry_offset += SAMPLER_INFO_ENTRY_SIZE;
        }

        const sampler_name_array_offset = view.getUint32(fmat_entry_offset + 0x48, true);
        const sampler_name_array: string[] = [];
        // index groups have a header and a fake entry at the start, skip over that
        let sampler_name_entry_offset = sampler_name_array_offset + 0x18;
        for (let i = 0; i < sampler_count; i++)
        {
            const sampler_name_offset = view.getUint32(sampler_name_entry_offset + 0x8, true);
            const sampler_name = read_bfres_string(buffer, sampler_name_offset, true);
            
            sampler_name_array.push(sampler_name);
            sampler_name_entry_offset += SAMPLER_NAME_ENTRY_SIZE;
        }

        const user_data_array_offset = view.getUint32(fmat_entry_offset + 0x68, true);
        const user_data_count = view.getUint16(fmat_entry_offset + 0xA6, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);
        
        fmat_array.push({ name, texture_names: texture_name_array, sampler_descriptors, sampler_names: sampler_name_array, user_data: user_data_array });
        fmat_entry_offset += FMAT_ENTRY_SIZE;
    }

    return fmat_array;
}

const FMAT_ENTRY_SIZE = 0xA8;
const TEXTURE_NAME_ENTRY_SIZE = 0x8;
const SAMPLER_INFO_ENTRY_SIZE = 0x20;
const SAMPLER_NAME_ENTRY_SIZE = 0X10;

export interface FMAT
{
    name: string;
    texture_names: string[];
    sampler_descriptors: GfxSamplerDescriptor[];
    sampler_names: string[];
    user_data: user_data[];
}

enum WrapMode
{
    Repeat,
    Mirror,
    Clamp,
}

/**
 * Convert the wrap mode number to the corresponding noclip.website one
 * @param wrap_mode wrap mode number to convert
 */
function convert_wrap_mode(wrap_mode: WrapMode)
{
    switch(wrap_mode)
    {
        case WrapMode.Repeat:
            return GfxWrapMode.Repeat;
        
        case WrapMode.Mirror:
            return GfxWrapMode.Mirror;
        
        case WrapMode.Clamp:
            return GfxWrapMode.Clamp;

        default:
            console.error(`wrap mode ${wrap_mode} not found`);
            throw "whoops";
    }
}

export enum FilterMode
{
    None,
    Point,
    Linear,
}

/**
 * Convert the texture filter mode number to the corresponding noclip.website one
 * @param texture_filter_mode filter mode number to convert
 */
function convert_tex_filter_mode(texture_filter_mode: FilterMode): GfxTexFilterMode
{
    switch(texture_filter_mode)
    {
        case FilterMode.Point:
            return GfxTexFilterMode.Point;
        
        case FilterMode.Linear:
            return GfxTexFilterMode.Bilinear;

        default:
            console.error(`texture filter mode ${texture_filter_mode} not found`);
            throw "whoops";
    }
}

/**
 * Convert the mipmap filter mode number to the corresponding noclip.website one
 * @param mip_filter_mode filter mode number to convert
 */
function convert_mip_filter_mode(mip_filter_mode: FilterMode): GfxMipFilterMode
{
    switch(mip_filter_mode)
    {
        case FilterMode.Point:
            return GfxMipFilterMode.Nearest;
        
        case FilterMode.Linear:
            return GfxMipFilterMode.Linear;

        default:
            console.error(`mip filter mode ${mip_filter_mode} not found`);
            throw "whoops";
    }
}

export enum DepthCompare
{
    Never,
    Less,
    Equal,
    LessOrEqual,
    Greater,
    NotEqual,
    GreaterOrEqual,
    Always,
}

/**
 * Convert the depth compare number to the corresponding noclip.website one
 * @param depth_compare_mode depth compare number to convert
 */
function convert_depth_compare_mode(depth_compare_mode: DepthCompare): GfxCompareMode | undefined
{
    switch(depth_compare_mode)
    {
        case DepthCompare.Never:
            return undefined;
        
        case DepthCompare.Less:
            return GfxCompareMode.Less;

        case DepthCompare.Equal:
            return GfxCompareMode.Equal;

         case DepthCompare.LessOrEqual:
            return GfxCompareMode.LessEqual;

         case DepthCompare.Greater:
            return GfxCompareMode.Greater;

         case DepthCompare.NotEqual:
            return GfxCompareMode.NotEqual;

         case DepthCompare.GreaterOrEqual:
            return GfxCompareMode.GreaterEqual;

         case DepthCompare.Always:
            return GfxCompareMode.Always;

        default:
            console.error(`depth compare mode ${depth_compare_mode} not found`);
            throw "whoops";
    }
}
