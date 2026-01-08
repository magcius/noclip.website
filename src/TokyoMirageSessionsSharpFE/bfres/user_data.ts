// user_data.ts
// Handles user data, which are custom parameters that many parts of a BFRES file can use
// They follow a key value format

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";

// reads from a bfres file and returns an array of user data objects
// buffer: the bfres file
// offset: start of the user data array
// count: number of user data objects in the array
export function parse_user_data(buffer: ArrayBufferSlice, offset: number, count: number): user_data[]
{
    const view = buffer.createDataView();

    let user_data_array: user_data[] = [];
    let user_data_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        const key_offset = view.getUint32(user_data_entry_offset, true);
        const key = read_bfres_string(buffer, key_offset, true);
        
        const data_offset = view.getUint32(user_data_entry_offset + 0x8, true);
        if (data_offset == null)
        {
            continue;
        }
        const data_count = view.getUint32(user_data_entry_offset + 0x10, true);
        const data_type = view.getUint8(user_data_entry_offset + 0x14);
        let values = [];
        switch (data_type)
        {
            case 0:
                // s32
                for (let j = 0; j < data_count; j++)
                {
                    values.push(view.getInt32(data_offset + (j * 0x4), true));
                }
                break;
            
            case 1:
                // float
                for (let j = 0; j < data_count; j++)
                {
                    values.push(view.getFloat32(data_offset + (j * 0x4), true));
                }
                break;
            
            case 2:
                // string
                // TODO
                break;
            
            case 3:
                // byte
                for (let j = 0; j < data_count; j++)
                {
                    // TODO: is this signed or unsigned?
                    values.push(view.getInt8(data_offset + (j * 0x1)));
                }
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
