import { AttributeFormat } from "../../fres_nx/nngfx_enum.js";
import { GfxFormat } from "../../gfx/platform/GfxPlatform.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { align, assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";

// export enum AttributeFormat
// {
//     _32_32_32_Float = 0x1805,
//     _32_32_Float = 0x1705,
//     _10_10_10_2_Snorm = 0xE02,
//     _16_16_Unorm = 0x1201

//     // TODO: fill these out
// }

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
            const attribute_name_offset = view.getUint32(attribute_entry_offset, true);
            const name = read_bfres_string(buffer, attribute_name_offset, true);
            const format = view.getUint32(attribute_entry_offset + 0x8, true);
            const bufferOffset = view.getUint16(attribute_entry_offset + 0xC, true);
            const bufferIndex = view.getUint16(attribute_entry_offset + 0xE, true);

            // convert format to a proper GfxFormat
            // mk8 convertVertexAttribute and translateAttributeFormat

            let gfx_format = -1;

            switch (format)
            {
                case AttributeFormat._8_8_Unorm:
                    gfx_format = GfxFormat.U8_RG_NORM;
                    break;

                case AttributeFormat._8_8_Snorm:
                    gfx_format = GfxFormat.S8_RG_NORM;
                    break;

                case AttributeFormat._8_8_Uint:
                    gfx_format = GfxFormat.U8_RG;
                    break;
                    
                case AttributeFormat._8_8_8_8_Unorm:
                    gfx_format = GfxFormat.U8_RGBA_NORM;
                    break;

                case AttributeFormat._8_8_8_8_Snorm:
                    gfx_format = GfxFormat.S8_RGBA_NORM;
                    break;
                
                case AttributeFormat._10_10_10_2_Snorm:
                    // not supported by webgl, so we need to convert this to S16_RGBA_NORM
                    break;

                case AttributeFormat._16_16_Unorm:
                    gfx_format = GfxFormat.U16_RG_NORM;
                    break;

                case AttributeFormat._16_16_Snorm:
                    gfx_format = GfxFormat.S16_RG_NORM;
                    break;

                case AttributeFormat._16_16_Float:
                    gfx_format = GfxFormat.F16_RG;
                    break;

                case AttributeFormat._16_16_16_16_Float:
                    gfx_format = GfxFormat.F16_RGBA;
                    break;

                case AttributeFormat._32_32_Float:
                    gfx_format = GfxFormat.F32_RG;
                    break;

                case AttributeFormat._32_32_32_Float:
                    gfx_format = GfxFormat.F32_RGB;
                    break;

                default:
                    console.error(`attribute format ${format} not found`);
                    throw "whoops";
            }

            vertexAttributes.push({ name, format: gfx_format, bufferOffset, bufferIndex });
            attribute_entry_offset += 0x10;
        }

        fvtx_array.push({ vertexAttributes, vertexBuffers, vertexCount });
        fvtx_entry_offset += 0x58;
    }

    return fvtx_array;
}
