// fmdl.ts
// Handles FMDL (caFe MoDeL) data, which has various subsections that represent a model.

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { read_bfres_string } from "./bfres_switch.js";
import { assert, readString } from "../../util.js";
import { FSKL, parseFSKL } from "./fskl.js";
import { FVTX, parseFVTX } from "./fvtx.js";
import { FSHP, parseFSHP } from "./fshp.js";
import { FMAT, parseFMAT } from "./fmat.js";
import { parse_user_data } from "./user_data.js";

/**
 * reads from a bfres file and returns an array of FMDL objects
 * @param buffer the bfres file
 * @param offset start of the fmdl array
 * @param count number of fmdl objects in the array
 * @param gpu_region_offset start of the gpu region in the bfres file.
 */
export function parseFMDL(buffer: ArrayBufferSlice, offset: number, count: number, gpu_region_offset: number): FMDL[]
{
    const view = buffer.createDataView();

    let fmdl_entry_offset = offset;
    const fmdl: FMDL[] = [];
    for (let i = 0; i < count; i++)
    {
        assert(readString(buffer, fmdl_entry_offset, 0x04) === 'FMDL');

        const fmdl_name_offset = view.getUint32(fmdl_entry_offset + 0x8, true);
        const fmdl_name = read_bfres_string(buffer, fmdl_name_offset);

        const fskl_offset = view.getUint32(fmdl_entry_offset + 0x18, true);
        const fskl = parseFSKL(buffer, fskl_offset);

        const fvtx_array_offset = view.getUint32(fmdl_entry_offset + 0x20, true);
        const fvtx_count = view.getUint16(fmdl_entry_offset + 0x68, true);
        const fvtx_array: FVTX[] = parseFVTX(buffer, fvtx_array_offset, fvtx_count, gpu_region_offset);

        const fshp_array_offset = view.getUint32(fmdl_entry_offset + 0x28, true);
        const fshp_count = view.getUint16(fmdl_entry_offset + 0x6A, true);
        const fshp_array: FSHP[] = parseFSHP(buffer, fshp_array_offset, fshp_count, gpu_region_offset);
        
        const fmat_array_offset = view.getUint32(fmdl_entry_offset + 0x38, true);
        const fmat_count = view.getUint16(fmdl_entry_offset + 0x6C, true);
        const fmat_array: FMAT[] = parseFMAT(buffer, fmat_array_offset, fmat_count);
        
        const user_data_array_offset = view.getUint32(fmdl_entry_offset + 0x50, true);
        const user_data_count = view.getUint16(fmdl_entry_offset + 0x70, true);
        const user_data = parse_user_data(buffer, user_data_array_offset, user_data_count);

        fmdl.push({ fskl, name: fmdl_name, fvtx: fvtx_array, fshp: fshp_array, fmat: fmat_array, user_data });
        fmdl_entry_offset += FMDL_ENTRY_SIZE;
    }

    return fmdl;
}

const FMDL_ENTRY_SIZE = 0x78;

export interface FMDL
{
    name: string;
    fskl: FSKL;
    fvtx: FVTX[];
    fshp: FSHP[];
    fmat: FMAT[];
    user_data: Map<string, number[] | string[]>;
}
