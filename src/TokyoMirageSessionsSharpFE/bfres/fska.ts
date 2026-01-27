// fska.ts
// Handles FSKA (caFe SKeletal Animation) data, which is a skeletal animation for a model

import { Curve, parse_curves } from "./animation_common.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { assert, readString } from "../../util.js";

/**
 * reads from a bfres file and returns an array of FSKA objects
 */
export function parseFSKA(buffer: ArrayBufferSlice, offset: number, count: number): FSKA[]
{
    const view = buffer.createDataView();

    let fska_entry_offset = offset;
    const fska: FSKA[] = [];
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fska_entry_offset, 0x04) === 'FSKA');

        const name_offset = view.getUint32(fska_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset);

        const frame_count = view.getUint32(fska_entry_offset + 0x40, true);

        const bone_animation_array_offset = view.getUint32(fska_entry_offset + 0x28, true);
        const bone_animation_count = view.getUint32(fska_entry_offset + 0x4C, true);
        let bone_animations: BoneAnimation[] = [];
        let bone_animation_entry_offset = bone_animation_array_offset;
        for (let bone_animation_index = 0; bone_animation_index < bone_animation_count; bone_animation_index++)
        {
            const bone_name_offset = view.getUint32(bone_animation_entry_offset, true);
            const bone_name = read_bfres_string(buffer, bone_name_offset);

            const flags = view.getUint32(bone_animation_entry_offset + 0x28, true);
            const initial_scaling = (flags >> 3) & 0x1;
            const initial_rotation = (flags >> 4) & 0x1;
            const initial_translation = (flags >> 5) & 0x1;
            // assuming every bone has these set
            assert(initial_scaling == 1);
            assert(initial_rotation == 1);
            assert(initial_translation == 1);

            const initial_value_array_offset = view.getUint32(bone_animation_entry_offset + 0x10, true);
            let initial_values: number[] = [];
            // scale xyz
            initial_values.push(view.getFloat32(initial_value_array_offset, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x4, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x8, true));
            // rotation xyz (4th component is always 1)
            initial_values.push(view.getFloat32(initial_value_array_offset + 0xC, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x10, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x14, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x18, true));
            // translation xyz
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x1C, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x20, true));
            initial_values.push(view.getFloat32(initial_value_array_offset + 0x24, true));

            const curve_array_offset = view.getUint32(bone_animation_entry_offset + 0x8, true);
            const curve_count = view.getUint8(bone_animation_entry_offset + 0x2E);
            let curves: Curve[] = parse_curves(buffer, curve_array_offset, curve_count, 0);

            bone_animations.push({ name: bone_name, flags, initial_values, curves });
            bone_animation_entry_offset += BONE_ANIMATION_ENTRY_SIZE;
        }

        fska.push({ name, frame_count, bone_animations });
        fska_entry_offset += FSKA_ENTRY_SIZE;
    }

    return fska;
}

const FSKA_ENTRY_SIZE = 0x78; // TODO: not sure this is correct
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
    flags: number;
    initial_values: number[];
    curves: Curve[];
}
