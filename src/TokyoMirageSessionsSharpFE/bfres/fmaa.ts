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

        const user_data_offset = view.getUint32(fmaa_entry_offset + 0x40, true);
        const user_data_count = view.getUint16(fmaa_entry_offset + 0x62, true); // TODO: there are multiple of these all in a row, not sure this is the correct one
        const user_data = parse_user_data(buffer, user_data_offset, user_data_count);

        const count_60 = view.getUint16(fmaa_entry_offset + 0x60, true); // TODO: there are multiple of these all in a row, not sure this is the correct one
        const parameter_animation_count = 1; // TODO: actually calculate this
        const material_animation_array_offset = view.getUint32(fmaa_entry_offset + 0x28, true);
        let material_animation_entry_offset = material_animation_array_offset;
        let material_animations: MaterialAnimation[] = [];
        for (let material_animation_index = 0; material_animation_index < count_60; material_animation_index++)
        {
            const target_material_string_offset = view.getUint32(material_animation_entry_offset, true);
            const target_material = read_bfres_string(buffer, target_material_string_offset, true);
            const curve_array_offset = view.getUint32(material_animation_entry_offset + 0x18, true);
            const constant_array_offset = view.getUint32(material_animation_entry_offset + 0x20, true);

            const parameter_animation_array_offset = view.getUint32(material_animation_entry_offset + 0x8, true);
            let parameter_animation_entry_offset = parameter_animation_array_offset;
            let parameter_animations: ParameterAnimation[] = [];
            for (let parameter_animation_index = 0; parameter_animation_index < parameter_animation_count; parameter_animation_index++)
            {
                const target_param_string_offset = view.getUint16(parameter_animation_entry_offset, true);
                const target_param = read_bfres_string(buffer, target_param_string_offset, true);
                
                const start_curve_index = 0; // TODO find this
                const curve_count = view.getUint32(parameter_animation_entry_offset + 0xA, true);
                const constant_count = view.getUint16(parameter_animation_entry_offset + 0x10, true);

                let constants: number[] = [];
                let constant_entry_offset = constant_array_offset;
                for (let constant_index = 0; constant_index < constant_count; constant_index++)
                {
                    const value = view.getUint32(constant_entry_offset + 0x4, true);

                    constants.push(value);
                    constant_entry_offset += CONSTANT_ENTRY_SIZE;
                }
                // TODO: can one of these have both constants and curves?

                const curves = parse_curves(buffer, curve_array_offset, curve_count, start_curve_index);

                // TODO: parse constants!

                parameter_animations.push({ target_param, curves, constants });
                parameter_animation_entry_offset += PARAMETER_ANIMATION_ENTRY_SIZE;
            }

            const current_user_data = user_data.find((f) => f.key === target_material);
            let translate_x_curve_index: number | undefined = undefined;
            let translate_y_curve_index: number | undefined  = undefined;
            if (current_user_data != undefined)
            {
                for (let user_data_value_index = 0; user_data_value_index < current_user_data.values.length; user_data_value_index += 2)
                {
                    switch (current_user_data.values[user_data_value_index])
                    {
                        case "albedo0_translate_x":
                            translate_x_curve_index = Number(current_user_data.values[user_data_value_index + 1]);
                            break;
                        
                        case "albedo0_translate_y":
                            translate_y_curve_index = Number(current_user_data.values[user_data_value_index + 1]);
                            break;
                        
                        default:
                            break;
                    }
                }
            }

            material_animations.push({ target_material, parameter_animations, translate_x_curve_index, translate_y_curve_index });
            material_animation_entry_offset += MATERIAL_ANIMATION_ENTRY_SIZE;

        }

        fmaa.push({ name, frame_count, material_animations, user_data });
        fmaa_entry_offset += FMAA_ENTRY_SIZE;
    }

    return fmaa;
}

const FMAA_ENTRY_SIZE = 0x78; // TODO: not sure if this is correct
const MATERIAL_ANIMATION_ENTRY_SIZE = 0x40;
const PARAMETER_ANIMATION_ENTRY_SIZE = 0x70; // TODO: not sure if this is correct
const CONSTANT_ENTRY_SIZE = 0x8;
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
    translate_x_curve_index: number | undefined;
    translate_y_curve_index: number | undefined;
}

export interface ParameterAnimation
{
    target_param: string;
    curves: Curve[];
    constants: number[];
}
