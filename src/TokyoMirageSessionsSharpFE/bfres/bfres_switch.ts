import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { FVTX, parseFVTX } from "./fvtx.js";
import { FSHP, parseFSHP } from "./fshp.js";

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

        const fvtx_array_offset = view.getUint32(fmdl_entry_offset + 0x20, true);
        const fvtx_count = view.getUint16(fmdl_entry_offset + 0x68, true);
        const fvtx_array: FVTX[] = parseFVTX(buffer, fvtx_array_offset, fvtx_count, gpu_region_offset);

        const fshp_array_offset = view.getUint32(fmdl_entry_offset + 0x28, true);
        const fshp_count = view.getUint16(fmdl_entry_offset + 0x6A, true);
        const fshp_array: FSHP[] = parseFSHP(buffer, fshp_array_offset, fshp_count, gpu_region_offset);
        
        const fmat_array_offset = view.getUint32(fmdl_entry_offset + 0x38, true);
        const fmat_count = view.getUint16(fmdl_entry_offset + 0x6C, true);
        
        const user_data_array_offset = view.getUint32(fmdl_entry_offset + 0x50, true);
        const user_data_array_count = view.getUint16(fmdl_entry_offset + 0x70, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_array_count);
        console.log(user_data_array);

        fmdl.push({ name: fmdl_name, fvtx: fvtx_array, fshp: fshp_array, user_data: user_data_array });
        fmdl_entry_offset += FMDL_ENTRY_SIZE;
    }
    
    return { fmdl };
}

const FMDL_ENTRY_SIZE = 0x78; // TODO: not sure if this is the correct size
const FMDL_USER_DATA_ENTRY_SIZE = 0x40;

export function read_bfres_string(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): string
{
    // first two bytes are the size
    return readString(buffer, offs + 0x02, 0xFF, true);
}

function parse_user_data(buffer: ArrayBufferSlice, offset: number, count: number): user_data[]
{
    const view = buffer.createDataView();

    let user_data_array: user_data[] = [];
    let user_data_entry_offset = offset;
    for (let i = 0; i < count; i++)
    {
        const name_offset = view.getUint32(user_data_entry_offset, true);
        const name = read_bfres_string(buffer, name_offset, true);
        
        const data_offset = view.getUint32(user_data_entry_offset + 0x8, true);
        if (data_offset == null)
        {
            continue;
        }
        const data_count = view.getUint32(user_data_entry_offset + 0x10, true);
        const data_type = view.getUint8(user_data_entry_offset + 0x14);
        let data_numbers: number[] = [];
        let data_strings: string[] = [];
        switch (data_type)
        {
            case 0:
                // s32
                for (let j = 0; j < data_count; j++)
                {
                    data_numbers.push(view.getInt32(data_offset + (j * 0x4), true));
                }
                break;
            
            case 1:
                // float
                for (let j = 0; j < data_count; j++)
                {
                    data_numbers.push(view.getFloat32(data_offset + (j * 0x4), true));
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
                    // TODO is this signed or unsigned?
                    data_numbers.push(view.getInt8(data_offset + (j * 0x1)));
                }
                break;
        }
        user_data_array.push({ name, numbers: data_numbers, strings: data_strings });
        user_data_entry_offset += FMDL_USER_DATA_ENTRY_SIZE;
    }
    return user_data_array;
}

interface user_data
{
    name: string;
    numbers: number[];
    strings: string[];
}

export interface FMDL
{
    name: string;
    // fskl: FSKL;
    fvtx: FVTX[];
    fshp: FSHP[];
    // fmat: FMAT[];
    user_data: user_data[];
}

export interface FRES
{
    fmdl: FMDL[];
}
