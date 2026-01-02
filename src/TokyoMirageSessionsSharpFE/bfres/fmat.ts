// fmat.ts
// Handles FMAT (caFe MATerial) data, which are materials for a model

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";

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

        fmat_array.push({ name });
        fmat_entry_offset += FMAT_ENTRY_SIZE;
    }

    return fmat_array;
}

const FMAT_ENTRY_SIZE = 0xA8;

export interface FMAT
{
    name: string;
}
