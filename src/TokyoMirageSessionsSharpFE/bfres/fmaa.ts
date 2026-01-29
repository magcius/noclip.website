// fmaa.ts
// Handles FMAA (caFe MAterial Animation) data, which are material animations for a model

import { Curve, AnimationConstant, parse_constants, parse_curves } from "./animation_common.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { parse_user_data } from "./user_data.js";
import { assert, readString } from "../../util.js";

export function parseFMAA(buffer: ArrayBufferSlice, offset: number, count: number): FMAA[]
{
    const view = buffer.createDataView();

    let fmaa_entry_offset = offset;
    const fmaa: FMAA[] = [];
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fmaa_entry_offset, 0x04) === 'FMAA');

        const name_offset = view.getUint32(fmaa_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset);
        const frame_count = view.getUint32(fmaa_entry_offset + 0x58, true);

        const user_data_offset = view.getUint32(fmaa_entry_offset + 0x40, true);
        const user_data_count = view.getUint16(fmaa_entry_offset + 0x60, true);
        const user_data = parse_user_data(buffer, user_data_offset, user_data_count);

        const material_animation_array_offset = view.getUint32(fmaa_entry_offset + 0x28, true);
        const material_animation_count = view.getUint16(fmaa_entry_offset + 0x62, true);
        let material_animation_entry_offset = material_animation_array_offset;
        let material_animations: MaterialAnimation[] = [];
        for (let material_animation_index = 0; material_animation_index < material_animation_count; material_animation_index++)
        {
            const target_material_string_offset = view.getUint32(material_animation_entry_offset, true);
            const target_material = read_bfres_string(buffer, target_material_string_offset);
            const curve_array_offset = view.getUint32(material_animation_entry_offset + 0x18, true);
            const constant_array_offset = view.getUint32(material_animation_entry_offset + 0x20, true);
            
            const shader_param_animation_array_offset = view.getUint32(material_animation_entry_offset + 0x8, true);
            const shader_param_animation_count = view.getUint16(material_animation_entry_offset + 0x32, true);
            let shader_param_animation_entry_offset = shader_param_animation_array_offset;
            let shader_param_animations: ShaderParamAnimation[] = [];
            for (let shader_param_animation_index = 0; shader_param_animation_index < shader_param_animation_count; shader_param_animation_index++)
            {
                const target_param_string_offset = view.getUint16(shader_param_animation_entry_offset, true);
                const target_param = read_bfres_string(buffer, target_param_string_offset);

                const curve_start_index = view.getUint16(shader_param_animation_entry_offset + 0x8, true);
                const float_curve_count = view.getUint16(shader_param_animation_entry_offset + 0xA, true);
                const integer_curve_count = view.getUint16(shader_param_animation_entry_offset + 0xC, true);
                const curves = parse_curves(buffer, curve_array_offset, float_curve_count, curve_start_index);

                const constant_start_index = view.getUint16(shader_param_animation_entry_offset + 0xE, true);
                const constant_count = view.getUint16(shader_param_animation_entry_offset + 0x10, true);
                const constants = parse_constants(buffer, constant_array_offset, constant_start_index, constant_count);

                shader_param_animations.push({ target_param, curves, constants });
                shader_param_animation_entry_offset += SHADER_PARAM_ANIMATION_ENTRY_SIZE;
            }

            // which curve applies to which texture and transformation is specified in user data
            // the key is the material name
            // the value is a string array: odd indices are the shader param name, even indices are the curve index
            let curve_index_map = new Map<string, string>();
            const curve_index_table = user_data.get(target_material);
            if (curve_index_table != undefined)
            {
                for (let value_index = 0; value_index < curve_index_table.length; value_index += 2)
                {
                    const key: string = String(curve_index_table[value_index]);
                    const value: string = String(curve_index_table[value_index + 1]);
                    curve_index_map.set(key, value);
                }
            }

            material_animations.push({ target_material, shader_param_animations, curve_index_map });
            material_animation_entry_offset += MATERIAL_ANIMATION_ENTRY_SIZE;
        }

        fmaa.push({ name, frame_count, material_animations, user_data });
        fmaa_entry_offset += FMAA_ENTRY_SIZE;
    }

    return fmaa;
}

const FMAA_ENTRY_SIZE = 0x70;
const MATERIAL_ANIMATION_ENTRY_SIZE = 0x40;
const SHADER_PARAM_ANIMATION_ENTRY_SIZE = 0x18;

export interface FMAA
{
    name: string;
    frame_count: number;
    material_animations: MaterialAnimation[];
    user_data: Map<string, number[] | string[]>;
}

export interface MaterialAnimation
{
    target_material: string;
    shader_param_animations: ShaderParamAnimation[];
    curve_index_map: Map<string, string>;
}

export interface ShaderParamAnimation
{
    target_param: string;
    curves: Curve[];
    constants: AnimationConstant[];
}

export interface TextureSRTCurveIndices
{
    scale_x: number | undefined;
    scale_y: number | undefined;
    rotate: number | undefined;
    translate_x: number | undefined;
    translate_y: number | undefined;
}
