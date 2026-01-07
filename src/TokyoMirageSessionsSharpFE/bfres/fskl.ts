// fvtx.ts
// Handles FSKL (caFe SKeLeton) data, which is a skeleton for transforming meshes

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { align, assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";

export function parseFSKL(buffer: ArrayBufferSlice, offset: number): FSKL
{
    const view = buffer.createDataView();
    assert(readString(buffer, offset, 0x04) === 'FSKL');

    const bone_array_offset = view.getUint32(offset + 0x10, true);
    const bone_count = view.getUint32(offset + 0x38, true);
    const bone_array: FSKL_Bone[] = [];
    let bone_entry_offset = bone_array_offset;
    for (let i = 0; i < bone_count; i++)
    {
        const name_offset = view.getUint32(bone_entry_offset, true);
        const name = read_bfres_string(buffer, name_offset, true);
        
        bone_array.push({ name });
        bone_entry_offset += BONE_ENTRY_SIZE;
    }

    return { bones: bone_array };
}

const BONE_ENTRY_SIZE = 0x60;

export interface FSKL
{
    bones: FSKL_Bone[];
}

export interface FSKL_Bone
{
    name: string;
}
