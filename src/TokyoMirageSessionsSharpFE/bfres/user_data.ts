// user_data.ts
// Handles user data, which are custom parameters that many parts of a BFRES file can use
// They follow a key value format

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";

/**
 * reads from a bfres file and returns an array of user data objects
 * @param buffer the bfres file
 * @param offset ostart of the user data array
 * @param count number of user data objects in the array
 */
export function parse_user_data(buffer: ArrayBufferSlice, offset: number, count: number): user_data[]
{
    const view = buffer.createDataView();

    let user_data_array: user_data[] = [];
    let user_data_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        const key_offset = view.getUint32(user_data_entry_offset, true);
        const key = read_bfres_string(buffer, key_offset);
        
        const data_offset = view.getUint32(user_data_entry_offset + 0x8, true);
        if (data_offset == null)
        {
            continue;
        }
        const data_count = view.getUint32(user_data_entry_offset + 0x10, true);
        const data_type = view.getUint8(user_data_entry_offset + 0x14);
        let values: number[] | string[] = [];
        switch (data_type)
        {
            case 0:
                // s32
                let s32_values: number[] = [];
                for (let j = 0; j < data_count; j++)
                {
                    s32_values.push(view.getInt32(data_offset + (j * 0x4), true));
                }
                values = s32_values;
                break;
            
            case 1:
                // f32
                let f32_values: number[] = [];
                for (let j = 0; j < data_count; j++)
                {
                    f32_values.push(view.getFloat32(data_offset + (j * 0x4), true));
                }
                values = f32_values;
                break;
            
            case 2:
                // string
                let string_values: string[] = [];
                for (let j = 0; j < data_count; j++)
                {
                    const string_offset = view.getUint32(data_offset + (j * 0x8), true);
                    const string = read_bfres_string(buffer, string_offset);
                    string_values.push(string);
                }
                values = string_values;
                break;
            
            case 3:
                // byte
                let byte_values: number[] = [];
                for (let j = 0; j < data_count; j++)
                {
                    // TODO: is this signed or unsigned?
                    byte_values.push(view.getInt8(data_offset + (j * 0x1)));
                }
                values = byte_values;
                break;
        }
        user_data_array.push({ key, values });
        user_data_entry_offset += USER_DATA_ENTRY_SIZE;
    }

    return user_data_array;
}

const USER_DATA_ENTRY_SIZE = 0x40;

export interface user_data
{
    key: string;
    values: number[] | string[];
}
