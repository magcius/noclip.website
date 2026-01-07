// fvtx.ts
// Handles FSKL (caFe SKeLeton) data, which is a skeleton for transforming meshes

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { align, assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";
import { vec3 } from "gl-matrix";
import { user_data, parse_user_data } from "./user_data.js";

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
        
        // TODO: user data
        const user_data_array_offset = view.getUint32(bone_entry_offset + 0x8, true);
        const user_data_count = view.getUint16(bone_entry_offset + 0x32, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);

        const parent_index = view.getInt16(bone_entry_offset + 0x2A, true);

        const scale_x = view.getFloat32(bone_entry_offset + 0x38, true);
        const scale_y = view.getFloat32(bone_entry_offset + 0x3C, true);
        const scale_z = view.getFloat32(bone_entry_offset + 0x40, true);
        const scale = vec3.fromValues(scale_x, scale_y, scale_z);

        const rotation_x = view.getFloat32(bone_entry_offset + 0x44, true);
        const rotation_y = view.getFloat32(bone_entry_offset + 0x48, true);
        const rotation_z = view.getFloat32(bone_entry_offset + 0x4C, true);
        const rotation = vec3.fromValues(rotation_x, rotation_y, rotation_z);

        const translation_x = view.getFloat32(bone_entry_offset + 0x54, true);
        const translation_y = view.getFloat32(bone_entry_offset + 0x58, true);
        const translation_z = view.getFloat32(bone_entry_offset + 0x5C, true);
        const translation = vec3.fromValues(translation_x, translation_y, translation_z);

        bone_array.push({ name, parent_index, scale, rotation, translation, user_data: user_data_array });
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
    parent_index: number;
    scale: vec3;
    rotation: vec3;
    translation: vec3;
    user_data: user_data[];
}
