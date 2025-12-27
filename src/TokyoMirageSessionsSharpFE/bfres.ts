import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";

export interface FRES
{
    // fmdl: FMDL[];
}

export function parse(buffer: ArrayBufferSlice): FRES
{
    // assert(readString(buffer, 0x00, 0x04) === 'FRES');

    // offsets are in relation to themselves, not the start of the file.
    // for example, reading an offset of 0x4C from location 0x20 actually points to 0x6C in the file
    const view = buffer.createDataView();

    // parse FMDL files
    const fmdl_group_offset = 0x20 + view.getUint32(0x20, false);
    const fmdl_count = view.getUint32(fmdl_group_offset + 0x4, false);

    // header is length 0x8, each entry is length 0x10 but the first entry is empty so the data really starts 0x18 in
    let entry_offset = fmdl_group_offset + 0x18;
    const names: string[] = [];
    const data_offsets: number[] = [];
    for (let i = 0; i < fmdl_count; i++)
    {
        const name_offset = entry_offset + 0x8;
        names.push(readString(buffer, name_offset + view.getUint32(name_offset, false), 0xFF, true));
        const data_offset = entry_offset + 0xC;
        data_offsets.push(data_offset + view.getUint32(data_offset, false));
        entry_offset += 0xC;
    }

    return {};
}
