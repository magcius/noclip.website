// fvtx.ts
// Handles FVTX (caFe VerTeX) data, which are vertices for a model

import { GfxFormat } from "../../gfx/platform/GfxPlatform.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { align, assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";

// reads from a bfres file and returns an array of FVTX objects
// buffer: the bfres file
// offset: start of the fvtx array
// count: number of fvtx objects in the array
// gpu_region_offset: start of the gpu region in the bfres file. needed to access the vertex buffer data.
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
        
        const vertexAttributes: FVTX_VertexAttribute[] = [];
        let attribute_entry_offset = attribute_array_offset;
        for (let i = 0; i < attribute_count; i++)
        {
            const name_offset = view.getUint32(attribute_entry_offset, true);
            const name = read_bfres_string(buffer, name_offset, true);
            const original_format = view.getUint32(attribute_entry_offset + 0x8, true);
            const format = convert_attribute_format(original_format);
            const bufferOffset = view.getUint16(attribute_entry_offset + 0xC, true);
            const bufferIndex = view.getUint16(attribute_entry_offset + 0xE, true);

            vertexAttributes.push({ name, format, bufferOffset, bufferIndex });
            attribute_entry_offset += ATTRIBUTE_ENTRY_SIZE;
        }

        fvtx_array.push({ vertexAttributes, vertexBuffers, vertexCount });
        fvtx_entry_offset += FVTX_ENTRY_SIZE;
    }

    return fvtx_array;
}

const FVTX_ENTRY_SIZE = 0x58;
const ATTRIBUTE_ENTRY_SIZE = 0x10;

// Convert the format numbers used by FVTX data into a format number that noclip.website understands
// format: FVTX attribute format number to convert
function convert_attribute_format(format: AttributeFormat)
{
    switch (format)
    {
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
        
        case AttributeFormat._10_10_10_2_Snorm:
            // not supported by webgl, so we need to convert this to S16_RGBA_NORM
            // mk8 convertVertexAttribute
            return -1; //temp for now

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

// vertex attribute format numbers that bfres files use
enum AttributeFormat
{
    _8_8_Unorm         = 0x0901,
    _8_8_Snorm         = 0x0902,
    _8_8_Uint          = 0x0903,
    _8_8_8_8_Unorm     = 0x0B01,
    _8_8_8_8_Snorm     = 0x0B02,
    _10_10_10_2_Snorm  = 0x0E02,
    _16_16_Unorm       = 0x1201,
    _16_16_Snorm       = 0x1202,
    _16_16_Float       = 0x1205,
    _16_16_16_16_Float = 0x1505,
    _32_32_Float       = 0x1705,
    _32_32_32_Float    = 0x1805,
}

export interface FVTX_VertexAttribute
{
    name: string;
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
