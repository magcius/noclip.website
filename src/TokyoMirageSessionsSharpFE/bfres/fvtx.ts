// fvtx.ts
// Handles FVTX (caFe VerTeX) data, which are vertices for a model

import { GfxFormat } from "../../gfx/platform/GfxPlatform.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { align, assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";

/**
 * reads from a bfres file and returns an array of FVTX objects
 * @param buffer the bfres file
 * @param offset start of the fvtx array
 * @param count number of fvtx objects in the array
 * @param gpu_region_offset start of the gpu region in the bfres file. needed to access the vertex buffer data.
 */
export function parseFVTX(buffer: ArrayBufferSlice, offset: number, count: number, gpu_region_offset: number): FVTX[]
{
    const view = buffer.createDataView();

    const fvtx_array: FVTX[] = [];
    let fvtx_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fvtx_entry_offset, 0x04) === 'FVTX');

        const buffer_size_array_offset = view.getUint32(fvtx_entry_offset + 0x30, true);
        const buffer_stride_array_offset = view.getUint32(fvtx_entry_offset + 0x38, true);
        const buffer_offset = view.getUint32(fvtx_entry_offset + 0x48, true);
        const buffer_count = view.getUint8(fvtx_entry_offset + 0x4D);
        const vertexCount = view.getUint32(fvtx_entry_offset + 0x50, true);

        // the buffer offset is relative to the start of the gpu region
        let start_of_buffer = gpu_region_offset + buffer_offset;
        const vertexBuffers: FVTX_VertexBuffer[] = [];
        for (let i = 0; i < buffer_count; i++)
        {
            const stride_offset = buffer_stride_array_offset + (i * 0x10);
            const stride = view.getUint32(stride_offset, true);
            const size_offset = buffer_size_array_offset + (i * 0x10);
            const size = view.getUint32(size_offset, true);
            const data = buffer.subarray(start_of_buffer, size);
            
            start_of_buffer = align(start_of_buffer + size, 8);
            vertexBuffers.push({ stride, data });
        }

        const attribute_array_offset = view.getUint32(fvtx_entry_offset + 0x8, true);
        const attribute_count = view.getUint8(fvtx_entry_offset + 0x4C);
        
        let normal_offset = 0;
        let normal_index = -1;

        const vertexAttributes: FVTX_VertexAttribute[] = [];
        let attribute_entry_offset = attribute_array_offset;
        for (let i = 0; i < attribute_count; i++)
        {
            const name_offset = view.getUint32(attribute_entry_offset, true);
            const name = read_bfres_string(buffer, name_offset);
            const original_format = view.getUint32(attribute_entry_offset + 0x8, true);
            const bufferOffset = view.getUint16(attribute_entry_offset + 0xC, true);
            const bufferIndex = view.getUint16(attribute_entry_offset + 0xE, true);
            
            let format = -1;
            if (original_format === AttributeFormat._10_10_10_2_Snorm)
            {
                // this format isn't supported by webgl, so convert this data to S16_RGB_NORM
                normal_offset = bufferOffset;
                normal_index = bufferIndex;
                convert_10_10_10_2_snorm(bufferOffset, bufferIndex, vertexBuffers);
                format = GfxFormat.S16_RGBA_NORM;
            }
            else
            {
                format = convert_attribute_format(original_format);
            }

            vertexAttributes.push({ name, original_format, format, bufferOffset, bufferIndex });
            
            attribute_entry_offset += ATTRIBUTE_ENTRY_SIZE;
        }

        // in the event that a buffer had to be remade because of _10_10_10_2_Snorm data
        // update the offsets to account for it going from 4 bytes to 8 bytes
        for (let i = 0; i < vertexAttributes.length; i++)
        {
            if (vertexAttributes[i].bufferIndex == normal_index && vertexAttributes[i].bufferOffset > normal_offset)
            {
                vertexAttributes[i].bufferOffset += 0x4;
            }
        }

        fvtx_array.push({ vertexAttributes, vertexBuffers, vertexCount });
        fvtx_entry_offset += FVTX_ENTRY_SIZE;
    }

    return fvtx_array;
}

const FVTX_ENTRY_SIZE = 0x58;
const ATTRIBUTE_ENTRY_SIZE = 0x10;

/**
 * remakes a vertex buffer where _10_10_10_2_Snorm data is converted into S16_RGBA_NORM data.
 * @param buffer_offset the _10_10_10_2_Snorm attribute's buffer offset
 * @param buffer_index which buffer the _10_10_10_2_Snorm attribute is in
 * @param vertex_buffers buffer to modify
 */
function convert_10_10_10_2_snorm(buffer_offset: number, buffer_index: number, vertex_buffers: FVTX_VertexBuffer[])
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
 * Convert the format numbers used by FVTX data into a format number that noclip.website understands
 * @param format format: FVTX attribute format number to convert
 */
function convert_attribute_format(format: AttributeFormat)
{
    switch (format)
    {
        case AttributeFormat._8_Unorm:
            return GfxFormat.U8_R_NORM;

        case AttributeFormat._8_8_Uint_dupe:
            return GfxFormat.U8_RG;

        case AttributeFormat._8_8_8_8_Uint:
            return GfxFormat.U8_RGBA;

        case AttributeFormat._8_8_Unorm:
            return GfxFormat.U8_RG_NORM;

        case AttributeFormat._8_8_Snorm:
            return GfxFormat.S8_RG_NORM;

        case AttributeFormat._8_8_Uint:
            return GfxFormat.U8_RG;
            
        case AttributeFormat._8_8_8_8_Unorm:
            return GfxFormat.U8_RGBA_NORM;

        case AttributeFormat._8_8_8_8_Snorm:
            return GfxFormat.S8_RGBA_NORM;

        case AttributeFormat._16_16_Unorm:
            return GfxFormat.U16_RG_NORM;

        case AttributeFormat._16_16_Snorm:
            return GfxFormat.S16_RG_NORM;

        case AttributeFormat._16_16_Float:
            return GfxFormat.F16_RG;

        case AttributeFormat._16_16_16_16_Float:
            return GfxFormat.F16_RGBA;

        case AttributeFormat._32_32_Float:
            return GfxFormat.F32_RG;

        case AttributeFormat._32_32_32_Float:
            return GfxFormat.F32_RGB;

        default:
            console.error(`attribute format ${format} not found`);
            throw "whoops";
    }
}

/**
 * vertex attribute format numbers that bfres files use
 */
enum AttributeFormat
{
    _8_Unorm            = 0x0201, // used for color
    _8_8_Uint_dupe      = 0x0203, // used for blend index
    _8_8_Unorm          = 0x0901,
    _8_8_Snorm          = 0x0902,
    _8_8_Uint           = 0x0903,
    _8_8_8_8_Unorm      = 0x0B01,
    _8_8_8_8_Snorm      = 0x0B02,
    _8_8_8_8_Uint       = 0x0B03,
    _10_10_10_2_Snorm   = 0x0E02,
    _16_16_Unorm        = 0x1201,
    _16_16_Snorm        = 0x1202,
    _16_16_Float        = 0x1205,
    _16_16_16_16_Float  = 0x1505,
    _32_32_Float        = 0x1705,
    _32_32_32_Float     = 0x1805,
}

export interface FVTX_VertexAttribute
{
    name: string;
    original_format: AttributeFormat;
    format: GfxFormat;
    bufferOffset: number;
    bufferIndex: number;
}

export interface FVTX_VertexBuffer
{
    stride: number;
    data: ArrayBufferSlice;
}

export interface FVTX
{
    vertexAttributes: FVTX_VertexAttribute[];
    vertexBuffers: FVTX_VertexBuffer[];
    vertexCount: number;
}
