// fska.ts
// Handles FSKA (caFe SKeletal Animation) data, which is a skeleton animation for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { assert, readString } from "../../util.js";

/**
 * reads from a bfres file and returns an array of FSKA objects
 */
export function parseFSKA(buffer: ArrayBufferSlice, offset: number, count: number, gpu_region_offset: number): FSKA[]
{
    const view = buffer.createDataView();

    let fska_entry_offset = offset;
    const fska: FSKA[] = [];
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fska_entry_offset, 0x04) === 'FSKA');

        const name_offset = view.getUint32(fska_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset, true);

        const frame_count = view.getUint32(fska_entry_offset + 0x40, true);

        const bone_animation_array_offset = view.getUint32(fska_entry_offset + 0x28, true);
        const bone_animation_count = view.getUint32(fska_entry_offset + 0x4C, true);
        let bone_animations: BoneAnimation[] = [];
        let bone_animation_entry_offset = bone_animation_array_offset;
        for (let i = 0; i < bone_animation_count; i++)
        {
            const bone_name_offset = view.getUint32(bone_animation_entry_offset, true);
            const bone_name = read_bfres_string(buffer, bone_name_offset, true);

            bone_animations.push({ name: bone_name });
            bone_animation_entry_offset += BONE_ANIMATION_ENTRY_SIZE;
        }

        fska.push({ name, frame_count, bone_animations });
        fska_entry_offset += FSKA_ENTRY_SIZE;
    }

    return fska;
}

const FSKA_ENTRY_SIZE = 0x78; // TODO: not sure what this is
const BONE_ANIMATION_ENTRY_SIZE = 0x38;


export interface FSKA
{
    name: string;
    frame_count: number;
    bone_animations: BoneAnimation[];
}

export interface BoneAnimation
{
    name: string;
}

