// fmaa.ts
// material animations

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { Curve, parse_curves } from "./fska.js";
import { assert, readString } from "../../util.js";
import { user_data, parse_user_data } from "./user_data.js";

export function parseFMAA(buffer: ArrayBufferSlice, offset: number, count: number): FMAA[]
{
    const view = buffer.createDataView();

    let fmaa_entry_offset = offset;
    const fmaa: FMAA[] = [];
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fmaa_entry_offset, 0x04) === 'FMAA');

        const name_offset = view.getUint32(fmaa_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset, true);
        const frame_count = view.getUint32(fmaa_entry_offset + 0x58, true);

        const count_60 = view.getUint16(fmaa_entry_offset + 0x60, true); // TODO: there are multiple of these all in a row, not sure this is the correct one
        const material_animation_array_offset = view.getUint32(fmaa_entry_offset + 0x28, true);
        let material_animation_array_entry_offset = material_animation_array_offset;
        let material_animations: MaterialAnimation[] = [];
        for (let material_animation_index = 0; material_animation_index < count_60; material_animation_index++)
        {
            const target_material_string_offset = view.getUint32(material_animation_array_entry_offset, true);
            const target_material = read_bfres_string(buffer, target_material_string_offset, true);

            const curve_array_offset = view.getUint32(material_animation_array_entry_offset + 0x18, true);

            const parameter_animation_array_offset = view.getUint32(material_animation_array_entry_offset + 0x8, true);
            const parameter_animation_count = 1;
            let parameter_animation_array_entry_offset = parameter_animation_array_offset;
            let parameter_animations: ParameterAnimation[] = [];
            for (let parameter_animatin_index = 0; parameter_animatin_index < parameter_animation_count; parameter_animatin_index++)
            {
                const target_param_string_offset = view.getUint32(parameter_animation_array_entry_offset, true);
                const target_param = read_bfres_string(buffer, target_param_string_offset, true);
                
                const start_curve_index = 0; // TODO find this
                const curve_count = view.getUint32(parameter_animation_array_entry_offset + 0xA, true);
                const curves = parse_curves(buffer, curve_array_offset, curve_count, start_curve_index);

                parameter_animations.push({ target_param, curves });
                parameter_animation_array_entry_offset += PARAMETER_ANIMATION_ENTRY_SIZE;
            }

            material_animations.push({ target_material, parameter_animations });
            material_animation_array_entry_offset += MATERIAL_ANIMATION_ENTRY_SIZE;

        }

        const user_data_offset = view.getUint32(fmaa_entry_offset + 0x40, true);
        const user_data_count = view.getUint16(fmaa_entry_offset + 0x62, true); // TODO: there are multiple of these all in a row, not sure this is the correct one
        const user_data = parse_user_data(buffer, user_data_offset, user_data_count);

        fmaa.push({ name, frame_count, material_animations, user_data });
        fmaa_entry_offset += FMAA_ENTRY_SIZE;
    }

    return fmaa;
}

const FMAA_ENTRY_SIZE = 0x78; // TODO: not sure if this is correct
const MATERIAL_ANIMATION_ENTRY_SIZE = 0x40;
const PARAMETER_ANIMATION_ENTRY_SIZE = 0x70; // TODO: not sure if this is correct

export interface FMAA
{
    name: string;
    frame_count: number;
    material_animations: MaterialAnimation[];
    user_data: user_data[];
}

export interface MaterialAnimation
{
    target_material: string;
    parameter_animations: ParameterAnimation[];
}

export interface ParameterAnimation
{
    target_param: string;
    curves: Curve[];
}
