// fshp.ts
// Handles FSHP(caFe SHaPe) data, which are meshes for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";
import { GfxFormat } from "../../gfx/platform/GfxPlatform.js";

// reads from a bfres file and returns an array of FSHP objects
// buffer: the bfres file
// offset: start of the fshp array
// count: number of fshp objects in the array
export function parseFSHP(buffer: ArrayBufferSlice, offset: number, count: number, gpu_region_offset: number): FSHP[]
{
    const view = buffer.createDataView();
    
    const fshp_array: FSHP[] = [];
    let fshp_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fshp_entry_offset, 0x04) === 'FSHP');
        const name_offset = view.getUint32(fshp_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset, true);

        const fvtx_index = view.getUint16(fshp_entry_offset + 0x56, true);

        const lod_mesh_array_offset = view.getUint32(fshp_entry_offset + 0x18, true);
        const mesh_count = view.getUint8(fshp_entry_offset + 0x5B);
        const mesh_array: fshp_mesh[] = [];
        let mesh_entry_offset = lod_mesh_array_offset;
        for (let i = 0; i < mesh_count; i++)
        {
            const primitive_topology = view.getUint32(mesh_entry_offset + 0x24, true);
            assert(primitive_topology === 3); // triangle list

            const original_format = view.getUint32(mesh_entry_offset + 0x28, true);
            const index_buffer_format = convert_index_format(original_format);

            const index_buffer_info_offset = view.getUint32(mesh_entry_offset + 0x18, true);
            const index_buffer_size = view.getUint32(index_buffer_info_offset, true);
            const index_buffer_offset = gpu_region_offset + view.getUint32(mesh_entry_offset + 0x20, true);
            const index_buffer_data = buffer.subarray(index_buffer_offset, index_buffer_size);

            const index_count = view.getUint32(mesh_entry_offset + 0x2C, true);

            mesh_array.push({ index_buffer_format, index_buffer_data, index_count });
            mesh_entry_offset += MESH_ENTRY_SIZE;
        }

        fshp_array.push({ name, mesh: mesh_array, fvtx_index });
        fshp_entry_offset += FSHP_ENTRY_SIZE;
    }

    return fshp_array;
}

const FSHP_ENTRY_SIZE = 0x60;
const MESH_ENTRY_SIZE = 0x38;

// Convert the format numbers used by index buffers into a format number that noclip.website understands
// format: index format number to convert
function convert_index_format(format: IndexFormat)
{
    switch (format)
    {
        case IndexFormat.Uint8:
            return GfxFormat.U8_R;

        case IndexFormat.Uint16:
            return GfxFormat.U16_R;

        case IndexFormat.Uint32:
            return GfxFormat.U32_R;

        default:
            console.error(`index format ${format} not found`);
            throw "whoops";
    }
}

interface fshp_mesh
{
    index_buffer_format: GfxFormat;
    index_buffer_data: ArrayBufferSlice;
    index_count: number;
}

export interface FSHP
{
    name: string;
    mesh: fshp_mesh[];
    fvtx_index: number;
}

enum IndexFormat
{
    Uint8,
    Uint16,
    Uint32,
}
