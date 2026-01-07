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

        const user_data_array_offset = view.getUint32(fmat_entry_offset + 0x68, true);
        const user_data_count = view.getUint16(fmat_entry_offset + 0xA6, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);
        

        fmat_array.push({ name, user_data: user_data_array });
        fmat_entry_offset += FMAT_ENTRY_SIZE;
    }

    return fmat_array;
}

const FMAT_ENTRY_SIZE = 0xA8;

export interface FMAT
{
    name: string;
    // shader_assign: FMAT_ShaderAssign;
    user_data: user_data[];
}

export interface FMAT_ShaderAssign
{

}
