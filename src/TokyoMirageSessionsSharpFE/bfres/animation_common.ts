// animation_common.ts
// handles data that is shared between multiple different animation types in bfres files

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { vec4 } from "gl-matrix";
import { assert } from "../../util.js";

/**
 * reads from a curve array in a bfres file and returns an array of Curve objects
 * @param buffer the bfres file
 * @param offset offset of the curve array
 * @param count number of curves to read
 * @param start_index which index to start reading from
 */
export function parse_curves(buffer: ArrayBufferSlice, offset: number, count: number, start_index: number): Curve[]
{
    const view = buffer.createDataView();
    let curves: Curve[] = [];
    let curve_entry_offset = offset + (start_index * CURVE_ENTRY_SIZE);
    for (let curve_index = start_index; curve_index < start_index + count; curve_index++)
    {                
        const flags = view.getUint16(curve_entry_offset + 0x10, true);
        const frame_type = flags & 0x3;
        const key_type = (flags >> 0x2) & 0x3;
        const curve_type: CurveType = (flags >> 0x4) & 0x7;
        // currently only support cubic
        assert(curve_type == CurveType.CubicSingle);
        const key_count = view.getUint16(curve_entry_offset + 0x12, true);
        const start_frame = view.getFloat32(curve_entry_offset + 0x18, true);
        const end_frame = view.getFloat32(curve_entry_offset + 0x1C, true);

        // used to convert the stored values to the actual value
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
                    // u8
                    frames.push(view.getUint8(frame_entry_offset));
                    frame_entry_offset += 0x1;
                    break;

                default:
                    console.error(`unknown frame type`);
                    throw("whoops");
            }
        }

        const key_array_offset = view.getUint32(curve_entry_offset + 0x8, true);
        let keys: vec4[] = [];
        let key_entry_offset = key_array_offset;
        for (let i = 0; i < key_count; i++)
        {
            // keyframes store four coefficients that can be used to interpolate a value
            // see getPointCubic() in Spline.ts
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
                    console.error(`unknown key type`);
                    throw("whoops");
            }

            keys.push(vec4.fromValues(cubic, square, linear, constant));
        }

        curves.push({ curve_type, start_frame, end_frame, frames, keys });
        curve_entry_offset += CURVE_ENTRY_SIZE;
    }

    return curves;
}

/**
 * reads from a table of animation constant values and returns an array of numbers
 * @param buffer the bfres file
 * @param offset the offset of the constants array
 * @param start_index which index to start reading from
 * @param count how many constants to read
 */
export function parse_constants(buffer: ArrayBufferSlice, offset: number, start_index: number, count: number): AnimationConstant[]
{
    const view = buffer.createDataView();

    let constants: AnimationConstant[] = [];
    let constant_entry_offset = offset + (start_index * CONSTANT_ENTRY_SIZE);
    for (let i = start_index; i < start_index + count; i++)
    {
        const animation_data_offset = view.getUint32(constant_entry_offset + 0x0, true);
        const value = view.getUint32(constant_entry_offset + 0x4, true);

        constants.push({ animation_data_offset, value });
        constant_entry_offset += CONSTANT_ENTRY_SIZE;
    }

    return constants;
}

const CURVE_ENTRY_SIZE = 0x30;
const CONSTANT_ENTRY_SIZE = 0x8;

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

export interface AnimationConstant
{
    animation_data_offset: number;
    value: number;
}
