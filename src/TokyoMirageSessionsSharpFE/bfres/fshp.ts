// fshp.ts
// Handles FSHP(caFe SHaPe) data, which are meshes for a model
// Meshes have an index buffer, which specifies which vertices in the vertex buffer to use for each triangle in the mesh.

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";
import { GfxFormat } from "../../gfx/platform/GfxPlatform.js";

/**
 * reads from a bfres file and returns an array of FSHP objects
 * @param buffer the bfres file
 * @param offset start of the fshp array
 * @param count number of fshp objects in the array
 * @param gpu_region_offset start of the gpu region in the bfres file. needed to access the index buffer data.
 */
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
        
        const fmat_index = view.getUint16(fshp_entry_offset + 0x52, true);
        const bone_index = view.getUint16(fshp_entry_offset + 0x54, true);
        const fvtx_index = view.getUint16(fshp_entry_offset + 0x56, true);
        const skin_bone_count = view.getUint8(fshp_entry_offset + 0x5A);

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

        fshp_array.push({ name, mesh: mesh_array, fmat_index, bone_index, fvtx_index, skin_bone_count });
        fshp_entry_offset += FSHP_ENTRY_SIZE;
    }

    return fshp_array;
}

const FSHP_ENTRY_SIZE = 0x60;
const MESH_ENTRY_SIZE = 0x38;

/**
 * Convert the format numbers used by index buffers into a format number that noclip.website understands
 * @param format index format number to convert
 */
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
    // note: technically this supports sub meshes, but I haven't seen them used yet.
}

export interface FSHP
{
    name: string;
    mesh: fshp_mesh[];
    fmat_index: number; // the index into this fmdl's fmat array for the material to use for this mesh
    bone_index: number; // the index into this fmdl's bone array for the bone to use for this mesh
    fvtx_index: number; // the index into this fmdl's fvtx array for the set of vertices to use for this mesh
    skin_bone_count: number;
}

enum IndexFormat
{
    Uint8,
    Uint16,
    Uint32,
}
