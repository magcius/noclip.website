// fmat.ts
// Handles FMAT (caFe MATerial) data, which are materials for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";
import { user_data, parse_user_data } from "./user_data.js";

// reads from a bfres file and returns an array of FMAT objects
// buffer: the bfres file
// offset: start of the fmat array
// count: number of fmat objects in the array
export function parseFMAT(buffer: ArrayBufferSlice, offset: number, count: number): FMAT[]
{
    const view = buffer.createDataView();

    const fmat_array: FMAT[] = [];
    let fmat_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fmat_entry_offset, 0x04) === 'FMAT');

        const name_offset = view.getUint32(fmat_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset, true);
        
        const texture_name_array_offset = view.getUint32(fmat_entry_offset + 0x30, true);
        const texture_name_count = view.getUint8(fmat_entry_offset + 0x9D);
        const texture_name_array: string[] = [];
        let texture_name_entry_offset = texture_name_array_offset;
        for (let i = 0; i < texture_name_count; i++)
        {
            const texture_name_offset = view.getUint32(texture_name_entry_offset, true);
            const texture_name = read_bfres_string(buffer, texture_name_offset, true);
            
            texture_name_array.push(texture_name);
            texture_name_entry_offset += TEXTURE_NAME_ENTRY_SIZE;
        }

        const user_data_array_offset = view.getUint32(fmat_entry_offset + 0x68, true);
        const user_data_count = view.getUint16(fmat_entry_offset + 0xA6, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);
        

        fmat_array.push({ name, texture_names: texture_name_array, user_data: user_data_array });
        fmat_entry_offset += FMAT_ENTRY_SIZE;
    }

    return fmat_array;
}

const FMAT_ENTRY_SIZE = 0xA8;
const TEXTURE_NAME_ENTRY_SIZE = 0x8;

export interface FMAT
{
    name: string;
    texture_names: string[];
    user_data: user_data[];
}
