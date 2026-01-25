// fska.ts
// Handles FSKA (caFe SKeletal Animation) data, which is a skeletal animation for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { vec4 } from "gl-matrix";
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
        const name = read_bfres_string(buffer, name_offset, true);

        const frame_count = view.getUint32(fska_entry_offset + 0x40, true);

        const bone_animation_array_offset = view.getUint32(fska_entry_offset + 0x28, true);
        const bone_animation_count = view.getUint32(fska_entry_offset + 0x4C, true);
        let bone_animations: BoneAnimation[] = [];
        let bone_animation_entry_offset = bone_animation_array_offset;
        for (let bone_animation_index = 0; bone_animation_index < bone_animation_count; bone_animation_index++)
        {
            const bone_name_offset = view.getUint32(bone_animation_entry_offset, true);
            const bone_name = read_bfres_string(buffer, bone_name_offset, true);

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
            let curves: Curve[] = [];
            let curve_entry_offset = curve_array_offset;
            for (let curve_index = 0; curve_index < curve_count; curve_index++)
            {                
                const flags = view.getUint16(curve_entry_offset + 0x10, true);
                const frame_type = flags & 0x3;
                const key_type = (flags >> 0x2) & 0x3;
                const curve_type: CurveType = (flags >> 0x4) & 0x7;
                // currently only support cubic
                assert(curve_type == CurveType.CubicSingle);
                // console.log(`frame ${frame_type} key ${key_type} curve ${curve_type}`);

                const key_count = view.getUint16(curve_entry_offset + 0x12, true);

                const start_frame = view.getFloat32(curve_entry_offset + 0x18, true);
                const end_frame = view.getFloat32(curve_entry_offset + 0x1C, true);

                // used to convert the stored values to the actual value
                // this allows more granularity
                const data_scale = view.getFloat32(curve_entry_offset + 0x20, true);
                const data_offset = view.getFloat32(curve_entry_offset + 0x24, true);

                const frame_array_offset = view.getUint32(curve_entry_offset, true);
                let frames: number[] = [];
                let frame_entry_offset = frame_array_offset;
                for (let i = 0; i < key_count; i++)
                {
                    switch(frame_type)
                    {
                        case 0:
                            // f32
                            frames.push(view.getFloat32(frame_entry_offset, true));
                            frame_entry_offset += 0x4;
                            break;

                        case 1:
                            // 16 bit fixed point
                            let frame = view.getInt16(frame_entry_offset, true);
                            frame = frame / 32;
                            frames.push(frame);
                            frame_entry_offset += 0x2;
                            break;

                        case 2:
                            // byte
                            // TODO: is this int or uint?
                            frames.push(view.getInt8(frame_entry_offset));
                            frame_entry_offset += 0x1;
                            break;

                        default:
                            console.error(`unknown frame type in bone ${bone_name}`);
                            throw("whoops");
                    }
                }

                const key_array_offset = view.getUint32(curve_entry_offset + 0x8, true);
                let keys: vec4[] = [];
                let key_entry_offset = key_array_offset;
                for (let i = 0; i < key_count; i++)
                {
                    // keyframes store four coefficients that can be used to interpolate a value
                    let constant: number;
                    let linear: number;
                    let square: number;
                    let cubic: number;
                    switch(key_type)
                    {
                        case 0:
                            // f32
                            // only constant has data_offset added to it
                            constant = view.getFloat32(key_entry_offset + 0x0, true) * data_scale + data_offset;
                            linear = view.getFloat32(key_entry_offset + 0x4, true) * data_scale;
                            square = view.getFloat32(key_entry_offset + 0x8, true) * data_scale;
                            cubic = view.getFloat32(key_entry_offset + 0xC, true) * data_scale;
                            key_entry_offset += 0x10;
                            break;

                        case 1:
                            // s16
                            constant = view.getInt16(key_entry_offset + 0x0, true) * data_scale + data_offset;
                            linear = view.getInt16(key_entry_offset + 0x2, true) * data_scale;
                            square = view.getInt16(key_entry_offset + 0x4, true) * data_scale;
                            cubic = view.getInt16(key_entry_offset + 0x6, true) * data_scale;
                            key_entry_offset += 0x8;
                            break;

                        case 2:
                            // s8
                            constant = view.getInt8(key_entry_offset + 0x0) * data_scale + data_offset;
                            linear = view.getInt8(key_entry_offset + 0x1) * data_scale;
                            square = view.getInt8(key_entry_offset + 0x2) * data_scale;
                            cubic = view.getInt8(key_entry_offset + 0x3) * data_scale;
                            key_entry_offset += 0x4;
                            break;

                        default:
                            console.error(`unknown key type in bone ${bone_name}`);
                            throw("whoops");
                    }

                    keys.push(vec4.fromValues(cubic, square, linear, constant));
                }

                curves.push({ curve_type, start_frame, end_frame, frames, keys });
                curve_entry_offset += CURVE_ENTRY_SIZE;
            }

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
const CURVE_ENTRY_SIZE = 0x30;

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

export enum CurveType
{
    CubicSingle,
    LinearSingle,
    BakedSingle,
    StepInteger,
    BakedInteger,
    StepBoolean,
    BakedBoolean,
}

export interface Curve
{
    curve_type: CurveType;
    start_frame: number;
    end_frame: number;
    frames: number[];
    keys: vec4[];
}
