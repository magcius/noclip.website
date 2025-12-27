import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";

export enum AttributeFormat
{
    unorm_8           = 0x0,
    unorm_8_8         = 0x4,
    unorm_16_16       = 0x7,
    unorm_8_8_8_8     = 0xA,
    uint_8            = 0x100,
    uint_8_8          = 0x104,
    uint_8_8_8_8      = 0x10A,
    snorm_8           = 0x200,
    snorm_8_8         = 0x204,
    snorm_16_16       = 0x207,
    snorm_8_8_8_8     = 0x20A,
    snorm_10_10_10_2  = 0x20B,
    sint_8            = 0x300,
    sint_8_8          = 0x304,
    sint_8_8_8_8      = 0x30A,
    float_32          = 0x806,
    float_16_16       = 0x808,
    float_32_32       = 0x80D,
    float_16_16_16_16 = 0x80F,
    float_32_32_32    = 0x811,
    float_32_32_32_32 = 0x813,
}

export interface FVTX_VertexAttribute
{
    name: string;
    bufferIndex: number;
    bufferOffset: number;
    format: AttributeFormat;
}

export interface FVTX_VertexBuffer
{
    data: ArrayBufferSlice;
    stride: number;
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

// offsets are in relation to themselves, not the start of the file.
// for example, reading an offset of 0x4C from location 0x20 actually points to 0x6C in the file
// offset_location: location of the offset from the start of the file
// returns the offset relative to the start of the file
function read_bfres_offset(view: DataView<ArrayBufferLike>, offset_location: number): number
{
    return offset_location + view.getUint32(offset_location, false);
}

export function parse(buffer: ArrayBufferSlice): FRES
{
    // assert(readString(buffer, 0x00, 0x04) === 'FRES');

    const view = buffer.createDataView();
    
    // parse FMDL data

    const fmdl_group_offset = read_bfres_offset(view, 0x20);
    const fmdl_count = view.getUint32(fmdl_group_offset + 0x4, false);

    // header is length 0x8, each entry is length 0x10 but the first entry is empty so the data really starts 0x18 in
    let entry_offset = fmdl_group_offset + 0x18;
    const fmdl_header_offsets: number[] = [];

    for (let i = 0; i < fmdl_count; i++)
    {
        fmdl_header_offsets.push(read_bfres_offset(view, entry_offset + 0xC));
        entry_offset += 0x10;
    }

    const fmdl: FMDL[] = [];
    for (let i = 0; i < fmdl_header_offsets.length; i++)
    {
        // assert(readString(buffer, fmdl_header_offsets[i], 0x04) === 'FMDL');
        const fmdl_name_offset = read_bfres_offset(view, fmdl_header_offsets[i] + 0x4);
        const name = readString(buffer, fmdl_name_offset, 0xFF, true)
        const fskl_header_offset = read_bfres_offset(view, fmdl_header_offsets[i] + 0xC);
        const fvtx_array_offset = read_bfres_offset(view, fmdl_header_offsets[i] + 0x10);
        const fshp_array_offset = read_bfres_offset(view, fmdl_header_offsets[i] + 0x14);
        const fmat_array_offset = read_bfres_offset(view, fmdl_header_offsets[i] + 0x18);
        const user_data_array_offset = read_bfres_offset(view, fmdl_header_offsets[i] + 0x1C);
        const fvtx_count = view.getUint16(fmdl_header_offsets[i] + 0x20, false);
        const fshp_count = view.getUint16(fmdl_header_offsets[i] + 0x22, false);
        const fmat_count = view.getUint16(fmdl_header_offsets[i] + 0x24, false);
        const user_data_count = view.getUint16(fmdl_header_offsets[i] + 0x26, false);
        const vertex_total = view.getUint32(fmdl_header_offsets[i] + 0x28, false);

        // TODO fskl

        // parse fvtx data
        let fvtx_entry_offset = fvtx_array_offset;
        const fvtx: FVTX[] = [];
        for (let i = 0; i < fvtx_count; i++)
        {
            // assert(readString(buffer, fvtx_entry_offset, 0x04) === 'FVTX');
            const attribute_count = view.getUint8(fvtx_entry_offset + 0x4);
            const buffer_count = view.getUint8(fvtx_entry_offset + 0x5);
            const attribute_array_offset = read_bfres_offset(view, fvtx_entry_offset + 0x10);
            const buffer_array_offset = read_bfres_offset(view, fvtx_entry_offset + 0x18);

            const vertexAttributes: FVTX_VertexAttribute[] = [];
            let attribute_entry_offset = attribute_array_offset;
            for (let i = 0; i < attribute_count; i++)
            {
                const attribute_name_offset = read_bfres_offset(view, attribute_entry_offset);
                const name = readString(buffer, attribute_name_offset, 0xFF, true)
                const bufferIndex = view.getUint8(attribute_entry_offset + 0x4);
                // TODO: does this offset need to be adjusted like all the other bfres offsets?
                const bufferOffset = view.getUint16(attribute_entry_offset + 0x6);
                const format = view.getUint32(attribute_entry_offset + 0x8);

                vertexAttributes.push({ name, bufferIndex, bufferOffset, format });
                attribute_entry_offset += 0xC;
            }

            const vertexBuffers: FVTX_VertexBuffer[] = [];
            let buffer_entry_offset = buffer_array_offset;
            for (let i = 0; i < buffer_count; i++)
            {
                const size = view.getUint32(buffer_entry_offset + 0x4);
                const stride = view.getUint16(buffer_entry_offset + 0xC);
                const data_offset = read_bfres_offset(view, buffer_entry_offset + 0x14);
                const data = buffer.subarray(data_offset, size);

                vertexBuffers.push({ data, stride });
                buffer_entry_offset += 0x18;
            }

            fvtx.push({ vertexAttributes, vertexBuffers });
            fvtx_entry_offset += 0x20;
        }

        fmdl.push({ name, fvtx })
    }
    console.log(fmdl);
    return { fmdl };
}
