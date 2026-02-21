// bfres_helpers.ts
// functions for dealing with data from BFRES files

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as BFRES from "../fres_nx/bfres.js";
import * as GfxPlatform from "../gfx/platform/GfxPlatform";
import { mat4 } from "gl-matrix";
import { computeModelMatrixSRT } from "../MathHelpers.js";
import * as nngfx_enum from "../fres_nx/nngfx_enum";

/**
 * uses the data from an FMAT's SamplerInfo to create a GfxSamplerDescriptor
 */
export function make_sampler_descriptor(sampler_info: BFRES.FMAT_SamplerInfo): GfxPlatform.GfxSamplerDescriptor
{
    const wrap_s = convert_wrap_mode(sampler_info.addrModeU);
    const wrap_t = convert_wrap_mode(sampler_info.addrModeV);
    const wrap_q = convert_wrap_mode(sampler_info.addrModeW);
    const depth_compare = convert_depth_compare_mode(sampler_info.compareMode);
    const mip_filter = convert_mip_filter_mode((sampler_info.filterMode >>> nngfx_enum.FilterMode.MipShift) & 0x03);
    const mag_filter = convert_tex_filter_mode((sampler_info.filterMode >>> nngfx_enum.FilterMode.MagShift) & 0x03);
    const min_filter = convert_tex_filter_mode((sampler_info.filterMode >>> nngfx_enum.FilterMode.MinShift) & 0x03);

    const sampler_descriptor: GfxPlatform.GfxSamplerDescriptor = 
    {
        wrapS: wrap_s,
        wrapT: wrap_t,
        wrapQ: wrap_q,
        minFilter: min_filter,
        magFilter: mag_filter,
        mipFilter: mip_filter,
        minLOD: sampler_info.minLOD,
        maxLOD: sampler_info.maxLOD,
        compareMode: depth_compare,
        maxAnisotropy: sampler_info.maxAnisotropy,
    };

    return sampler_descriptor;
}

function convert_wrap_mode(wrap_mode: nngfx_enum.TextureAddressMode)
{
    switch(wrap_mode)
    {
        case nngfx_enum.TextureAddressMode.Repeat:
            return GfxPlatform.GfxWrapMode.Repeat;
        
        case nngfx_enum.TextureAddressMode.Mirror:
            return GfxPlatform.GfxWrapMode.Mirror;
        
        case nngfx_enum.TextureAddressMode.ClampToEdge:
            return GfxPlatform.GfxWrapMode.Clamp;

        default:
            console.error(`wrap mode ${wrap_mode} not found`);
            throw "whoops";
    }
}

function convert_depth_compare_mode(depth_compare_mode: nngfx_enum.CompareMode): GfxPlatform.GfxCompareMode | undefined
{
    switch(depth_compare_mode)
    {
        case nngfx_enum.CompareMode.Never:
            return undefined;
        
        case nngfx_enum.CompareMode.Less:
            return GfxPlatform.GfxCompareMode.Less;

        case nngfx_enum.CompareMode.Equal:
            return GfxPlatform.GfxCompareMode.Equal;

        case nngfx_enum.CompareMode.LessOrEqual:
            return GfxPlatform.GfxCompareMode.LessEqual;

        case nngfx_enum.CompareMode.Greater:
            return GfxPlatform.GfxCompareMode.Greater;

        case nngfx_enum.CompareMode.NotEqual:
            return GfxPlatform.GfxCompareMode.NotEqual;

        case nngfx_enum.CompareMode.GreaterOrEqual:
            return GfxPlatform.GfxCompareMode.GreaterEqual;

        case nngfx_enum.CompareMode.Always:
            return GfxPlatform.GfxCompareMode.Always;

        default:
            console.error(`depth compare mode ${depth_compare_mode} not found`);
            throw "whoops";
    }
}

function convert_tex_filter_mode(texture_filter_mode: nngfx_enum.FilterMode): GfxPlatform.GfxTexFilterMode
{
    switch(texture_filter_mode)
    {
        case nngfx_enum.FilterMode.Point:
            return GfxPlatform.GfxTexFilterMode.Point;
        
        case nngfx_enum.FilterMode.Linear:
            return GfxPlatform.GfxTexFilterMode.Bilinear;

        default:
            console.error(`texture filter mode ${texture_filter_mode} not found`);
            throw "whoops";
    }
}

function convert_mip_filter_mode(mip_filter_mode: nngfx_enum.FilterMode): GfxPlatform.GfxMipFilterMode
{
    switch(mip_filter_mode)
    {
        case nngfx_enum.FilterMode.Point:
            return GfxPlatform.GfxMipFilterMode.Nearest;
        
        case nngfx_enum.FilterMode.Linear:
            return GfxPlatform.GfxMipFilterMode.Linear;

        default:
            console.error(`mip filter mode ${mip_filter_mode} not found`);
            throw "whoops";
    }
}

/**
 * multiply a bone's transformation with all it's parent's transformations to get the real transformation matrix
 */
export function recursive_bone_transform(bone_index: number, bones: BFRES.FSKL_Bone[]): mat4
{
    const bone = bones[bone_index];
    let transform_matrix: mat4 = mat4.create();
    computeModelMatrixSRT
    (
        transform_matrix,
        bone.scale[0], bone.scale[1], bone.scale[2],
        bone.rotation[0], bone.rotation[1], bone.rotation[2],
        bone.translation[0], bone.translation[1], bone.translation[2],
    );
    if (bone.parentIndex == -1)
    {
        return transform_matrix;
    }
    else
    {
        const new_matrix: mat4 = mat4.create();
        mat4.multiply(new_matrix, recursive_bone_transform(bone.parentIndex, bones), transform_matrix)
        return new_matrix;
    }
}

/**
 * Convert the format numbers used by FVTX data into a noclip.website format number
 */
export function convert_attribute_format(format: nngfx_enum.AttributeFormat): GfxPlatform.GfxFormat
{
    switch (format)
    {
        case nngfx_enum.AttributeFormat._8_Unorm:
            return GfxPlatform.GfxFormat.U8_R_NORM;

        case nngfx_enum.AttributeFormat._8_Uint:
            return GfxPlatform.GfxFormat.U8_R;

        case nngfx_enum.AttributeFormat._8_8_8_8_Uint:
            return GfxPlatform.GfxFormat.U8_RGBA;

        case nngfx_enum.AttributeFormat._8_8_Unorm:
            return GfxPlatform.GfxFormat.U8_RG_NORM;

        case nngfx_enum.AttributeFormat._8_8_Snorm:
            return GfxPlatform.GfxFormat.S8_RG_NORM;

        case nngfx_enum.AttributeFormat._8_8_Uint:
            return GfxPlatform.GfxFormat.U8_RG;
            
        case nngfx_enum.AttributeFormat._8_8_8_8_Unorm:
            return GfxPlatform.GfxFormat.U8_RGBA_NORM;

        case nngfx_enum.AttributeFormat._8_8_8_8_Snorm:
            return GfxPlatform.GfxFormat.S8_RGBA_NORM;

        case nngfx_enum.AttributeFormat._16_16_Unorm:
            return GfxPlatform.GfxFormat.U16_RG_NORM;

        case nngfx_enum.AttributeFormat._16_16_Snorm:
            return GfxPlatform.GfxFormat.S16_RG_NORM;

        case nngfx_enum.AttributeFormat._10_10_10_2_Snorm:
            // these buffers are converted
            return GfxPlatform.GfxFormat.S16_RGBA_NORM;

        case nngfx_enum.AttributeFormat._16_16_Float:
            return GfxPlatform.GfxFormat.F16_RG;

        case nngfx_enum.AttributeFormat._16_16_16_16_Float:
            return GfxPlatform.GfxFormat.F16_RGBA;

        case nngfx_enum.AttributeFormat._32_32_Float:
            return GfxPlatform.GfxFormat.F32_RG;

        case nngfx_enum.AttributeFormat._32_32_32_Float:
            return GfxPlatform.GfxFormat.F32_RGB;

        default:
            console.error(`attribute format ${format} not found`);
            throw "whoops";
    }
}

/**
 * remakes a vertex buffer where _10_10_10_2_Snorm data is converted into S16_RGBA_NORM data.
 * note: this code assumes that there is only one 10 10 10 2 attribute in a buffer
 * @param buffer_offset the _10_10_10_2_Snorm attribute's buffer offset
 * @param buffer_index which buffer the _10_10_10_2_Snorm attribute is in
 * @param vertex_buffers buffer to modify
 */
export function convert_10_10_10_2_snorm(buffer_offset: number, buffer_index: number, vertex_buffers: BFRES.FVTX_VertexBuffer[])
{
    const element_count = vertex_buffers[buffer_index].data.byteLength / vertex_buffers[buffer_index].stride;
    const before_count = buffer_offset;
    const after_count = vertex_buffers[buffer_index].stride - 4 - before_count;

    // 10 10 10 2 is 4 bytes, 16 16 16 16 is 8 bytes, so add 4
    const new_stride = vertex_buffers[buffer_index].stride + 4;
    vertex_buffers[buffer_index].stride = new_stride;

    const new_buffer_length = element_count * new_stride;
    let new_buffer = new Uint8Array(new_buffer_length)

    let new_buffer_offset = 0;
    let old_buffer_offset = 0;
    const old_view = vertex_buffers[buffer_index].data.createDataView();
    for (let i = 0; i < element_count; i++)
    {
        if (before_count > 0)
        {
            for (let j = 0; j < before_count; j++)
            {
                new_buffer[new_buffer_offset++] = old_view.getUint8(old_buffer_offset++);
            }
        }

        const n = old_view.getUint32(old_buffer_offset, true);
        old_buffer_offset += 4;

        const s10_x = (n >>>  0) & 0x3FF;
        const s10_y = (n >>> 10) & 0x3FF;
        const s10_z = (n >>> 20) & 0x3FF;
        
        const s32_x = convert_s10_to_s32(s10_x);
        const s32_y = convert_s10_to_s32(s10_y);
        const s32_z = convert_s10_to_s32(s10_z);

        // write the s16s in little endian format
        new_buffer[new_buffer_offset++] = s32_x;
        new_buffer[new_buffer_offset++] = s32_x >> 8;
        new_buffer[new_buffer_offset++] = s32_y;
        new_buffer[new_buffer_offset++] = s32_y >> 8;
        new_buffer[new_buffer_offset++] = s32_z;
        new_buffer[new_buffer_offset++] = s32_z >> 8;
        new_buffer[new_buffer_offset++] = 1;
        new_buffer[new_buffer_offset++] = 0;

        if (after_count > 0)
        {
            for (let j = 0; j < after_count; j++)
            {
                new_buffer[new_buffer_offset++] = old_view.getUint8(old_buffer_offset++);
            }
        }
    }

    vertex_buffers[buffer_index].data = new ArrayBufferSlice(new_buffer.buffer);
}

function convert_s10_to_s32(n: number): number
{
    // first left shift so that the top bit of the s10 is moved to the top bit of this s32 number
    // then right shift back the same amount
    // right shifting copies the top bit
    // if it's positive they will all be 0s
    // if it's negative they will all be 1s
    return (n << 22) >> 22;
}

/**
 * Convert the format numbers used by FSHP index buffers into a noclip.website format number
 */
export function convert_index_format(format: nngfx_enum.IndexFormat): GfxPlatform.GfxFormat
{
    switch (format)
    {
        case nngfx_enum.IndexFormat.Uint8:
            return GfxPlatform.GfxFormat.U8_R;

        case nngfx_enum.IndexFormat.Uint16:
            return GfxPlatform.GfxFormat.U16_R;

        case nngfx_enum.IndexFormat.Uint32:
            return GfxPlatform.GfxFormat.U32_R;

        default:
            console.error(`index format ${format} not found`);
            throw "whoops";
    }
}

export enum TMSFECullMode
{
    Back = 1,
    Front = 2,
    None = 3,
}

export function convert_cull_mode(cull_mode: TMSFECullMode): GfxPlatform.GfxCullMode
{
    switch(cull_mode)
    {
        case TMSFECullMode.Back:
            return GfxPlatform.GfxCullMode.Back;

        case TMSFECullMode.Front:
            return GfxPlatform.GfxCullMode.Front;

        case TMSFECullMode.None:
            return GfxPlatform.GfxCullMode.None;

        default:
            console.error(`unknown cull_mode ${cull_mode}`);
            throw("whoops");
    }
}

export function parse_bfres(buffer: ArrayBufferSlice): BFRES.FRES
{
    let fres = BFRES.parse(buffer);

    // Tokyo Mirage Sessions uses 10 10 10 2 snorm to store normals, which isn't supported
    // these needs to be converted to s16 rgba norm
    // do it here to avoid duplicating this converision if the fres is used multiple times
    for (let model_index = 0; model_index < fres.fmdl.length; model_index++)
    {
        let fmdl = fres.fmdl[model_index];
        for (let fvtx_index = 0; fvtx_index < fmdl.fvtx.length; fvtx_index++)
        {
            let fvtx = fmdl.fvtx[fvtx_index];
            let _10_10_10_2_offset = -1;
            let _10_10_10_2_buffer_index = -1;
            for (let attribute_index = 0; attribute_index < fvtx.vertexAttributes.length; attribute_index++)
            {
                let attribute = fvtx.vertexAttributes[attribute_index];
                if (attribute.format === nngfx_enum.AttributeFormat._10_10_10_2_Snorm)
                {
                    _10_10_10_2_offset = attribute.offset;
                    _10_10_10_2_buffer_index = attribute.bufferIndex;
                    convert_10_10_10_2_snorm(attribute.offset, attribute.bufferIndex, fvtx.vertexBuffers);
                }
            }

            // in the event that a buffer had to be converted, update the offsets to account for it going from 4 to 8 bytes
            for (let attribute_index = 0; attribute_index < fvtx.vertexAttributes.length; attribute_index++)
            {
                let attribute = fvtx.vertexAttributes[attribute_index];
                if (attribute.bufferIndex == _10_10_10_2_buffer_index && attribute.offset > _10_10_10_2_offset)
                {
                    attribute.offset += 0x4;
                }
            }
        }
    }

    return fres;
}
