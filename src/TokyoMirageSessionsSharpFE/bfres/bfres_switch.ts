// bfres_switch.ts
// handles BFRES (Binary caFe RESources) files, which 3d graphics related resources
// In Tokyo Mirage Sessions ♯FE these usually contain a single model
// Levels have a main bfres file that contains the level model, with a few pieces broken out into separate bfres files.
// There are many versions of the BFRES format, and it was used on both Wii U and Switch games
// Tokyo Mirage Sessions ♯FE (Wii U JP) uses v3.5.0.2
// Tokyo Mirage Sessions ♯FE Encore (Switch) uses v0.9.0.0

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { FSKL, parseFSKL } from "./fskl.js";
import { FVTX, parseFVTX } from "./fvtx.js";
import { FSHP, parseFSHP } from "./fshp.js";
import { FMAT, parseFMAT } from "./fmat.js";
import { user_data, parse_user_data } from "./user_data.js";

export function parse(buffer: ArrayBufferSlice): FRES
{
    assert(readString(buffer, 0x00, 0x04) === 'FRES');
    const view = buffer.createDataView();
    // only switch bfres files have this
    assert(view.getUint32(0x4, true) === 0x20202020);

    // find the gpu region of the file
    const memory_pool_info_offset = view.getUint32(0xB0, true);
    const gpu_region_offset = view.getUint32(memory_pool_info_offset + 8, true);

    // parse fmdl

    const fmdl_array_offset = view.getUint32(0x28, true);
    const fmdl_count = view.getUint16(0xDC, true);

    let fmdl_entry_offset = fmdl_array_offset;
    const fmdl: FMDL[] = [];
    for (let i = 0; i < fmdl_count; i++)
    {
        assert(readString(buffer, fmdl_entry_offset, 0x04) === 'FMDL');

        const fmdl_name_offset = view.getUint32(fmdl_entry_offset + 0x8, true);
        const fmdl_name = read_bfres_string(buffer, fmdl_name_offset, true);

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
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);

        fmdl.push({ fskl, name: fmdl_name, fvtx: fvtx_array, fshp: fshp_array, fmat: fmat_array, user_data: user_data_array });
        fmdl_entry_offset += FMDL_ENTRY_SIZE;
    }
    
    return { fmdl };
}

const FMDL_ENTRY_SIZE = 0x78; // TODO: not sure if this is the correct size

export function read_bfres_string(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): string
{
    // first two bytes are the size
    return readString(buffer, offs + 0x02, 0xFF, true);
}

export interface FMDL
{
    name: string;
    fskl: FSKL;
    fvtx: FVTX[];
    fshp: FSHP[];
    fmat: FMAT[];
    user_data: user_data[];
}

export interface FRES
{
    fmdl: FMDL[];
}
