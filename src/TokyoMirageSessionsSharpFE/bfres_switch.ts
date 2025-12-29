import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { align, assert, readString } from "../util.js";
import { AttributeFormat } from "../fres_nx/nngfx_enum.js";
import { GfxFormat } from "../gfx/platform/GfxPlatform.js";

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
}

export interface FMDL
{
    name: string;
    // fskl: FSKL;
    fvtx: FVTX[];
    // fshp: FSHP[];
    // fmat: FMAT[];
}

export interface FRES
{
    fmdl: FMDL[];
}

export function read_bfres_string(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): string
{
    // first two bytes are the size
    return readString(buffer, offs + 0x02, 0xFF, true);
}

export function parse(buffer: ArrayBufferSlice): FRES
{
    assert(readString(buffer, 0x00, 0x04) === 'FRES');
    const view = buffer.createDataView();
    // only switch bfres files have this
    assert(view.getUint32(0x4, true) === 0x20202020);

    // find the gpu region of the file
    const memory_pool_info_offset = view.getUint32(0xB0, true);
    const memory_pool_data_offset = view.getUint32(memory_pool_info_offset + 8, true);

    // parse fmdl

    const fmdl_array_offset = view.getUint32(0x28, true);
    const fmdl_count = view.getUint16(0xDC, true);

    let fmdl_entry_offset = fmdl_array_offset;
    const fmdl: FMDL[] = [];
    for (let i = 0; i < fmdl_count; i++)
    {
        assert(readString(buffer, fmdl_entry_offset, 0x04) === 'FMDL');
        const fmdl_name_offset = view.getUint32(fmdl_entry_offset + 0x8, true);
        const fmdl_name = read_bfres_string(buffer, fmdl_name_offset, true);
        const fskl_offset = view.getUint32(fmdl_entry_offset + 0x18, true);
        const fvtx_array_offset = view.getUint32(fmdl_entry_offset + 0x20, true);
        const fshp_array_offset = view.getUint32(fmdl_entry_offset + 0x28, true);
        const fmat_array_offset = view.getUint32(fmdl_entry_offset + 0x38, true);
        const fvtx_count = view.getUint16(fmdl_entry_offset + 0x68, true);
        const fshp_count = view.getUint16(fmdl_entry_offset + 0x6A, true);
        const fmat_count = view.getUint16(fmdl_entry_offset + 0x6C, true);
        // TODO: where is user data?

        let fvtx_entry_offset = fvtx_array_offset;
        const fvtx: FVTX[] = [];
        for (let i = 0; i < fvtx_count; i++)
        {
            assert(readString(buffer, fvtx_entry_offset, 0x04) === 'FVTX');

            const buffer_size_array_offset = view.getUint32(fvtx_entry_offset + 0x30, true);
            const buffer_stride_array_offset = view.getUint32(fvtx_entry_offset + 0x38, true);
            const buffer_offset = view.getUint32(fvtx_entry_offset + 0x48, true);
            const buffer_count = view.getUint8(fvtx_entry_offset + 0x4D);

            // the buffer offset is relative to the start of the gpu region
            let start_of_buffer = memory_pool_data_offset + buffer_offset;
            const vertexBuffers: FVTX_VertexBuffer[] = [];
            for (let i = 0; i < buffer_count; i++)
            {
                const stride_offset = buffer_stride_array_offset + (i * 0x10);
                const stride = view.getUint32(stride_offset, true);

                const size_offset = buffer_size_array_offset + (i * 0x10);
                const size = view.getUint32(size_offset, true);

                const data = buffer.subarray(buffer_offset, size);
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

            fvtx.push({ vertexAttributes, vertexBuffers });
            fvtx_entry_offset += 0x58;
        }

        fmdl.push({ name: fmdl_name, fvtx });
        fmdl_entry_offset += 0x78; // TODO: not sure if this is the correct size for fmdl headers
    }
    
    return { fmdl };
}
