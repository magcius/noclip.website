// bfres_switch.ts
// handles BFRES (Binary caFe RESources) files, which contain 3d graphics related data
// In Tokyo Mirage Sessions ♯FE these usually contain a single model
// Levels have a main bfres file that contains the level model, with a few pieces broken out into separate bfres files.
// There are many versions of the BFRES format, and it was used for both Wii U and Switch games
// Tokyo Mirage Sessions ♯FE (Wii U JP) uses v3.5.0.2
// Tokyo Mirage Sessions ♯FE Encore (Switch) uses v0.9.0.0

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { FMAA, parseFMAA } from "./fmaa.js";
import { FMDL, parseFMDL } from "./fmdl.js";
import { FSKA, parseFSKA } from "./fska.js";
import { assert, readString } from "../../util.js";

/**
 * reads from a BFRES file and returns a FRES object
 * @param buffer the BFRES file
 */
export function parseBFRES(buffer: ArrayBufferSlice): FRES
{
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'FRES');
    // only switch bfres files have this
    assert(view.getUint32(0x4, true) === 0x20202020);

    const name_offset = view.getUint32(0x20, true);
    const name = read_bfres_string(buffer, name_offset, true);

    const memory_pool_info_offset = view.getUint32(0xB0, true);
    const gpu_region_offset = view.getUint32(memory_pool_info_offset + 8, true);

    const fmdl_array_offset = view.getUint32(0x28, true);
    const fmdl_count = view.getUint16(0xDC, true);
    const fmdl = parseFMDL(buffer, fmdl_array_offset, fmdl_count, gpu_region_offset);

    const fska_array_offset = view.getUint32(0x58, true);
    const fska_count = view.getUint16(0xE2, true);
    const fska = parseFSKA(buffer, fska_array_offset, fska_count);

    const fmaa_array_offset = view.getUint32(0x68, true);
    const fmaa_count = view.getUint16(0xE4, true);
    const fmaa = parseFMAA(buffer, fmaa_array_offset, fmaa_count);

    const embedded_file_count = view.getUint16(0xEC, true);
    const embedded_file_array_offset = view.getUint32(0xB8, true);
    const embedded_file_dictionary_offset = view.getUint32(0xC0, true);
    const embedded_files = parse_external_files(buffer, embedded_file_dictionary_offset, embedded_file_array_offset, embedded_file_count);
    
    return { name, fmdl, fska, fmaa, embedded_files };
}

const EMBEDDED_FILE_ENTRY_SIZE = 0xC;
const RESOURCE_DICTIONARY_ENTRY_SIZE = 0x10;

/**
 * string tables in BFRES files have the length of the string as the first two bytes
 * this reads a string starting two bytes after the specified offset
 */
export function read_bfres_string(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): string
{
    return readString(buffer, offs + 0x02, 0xFF, true);
}

export function parse_external_files(buffer: ArrayBufferSlice, name_array_offset: number, file_array_offset: number, count: number): EmbeddedFile[]
{
    const view = buffer.createDataView();

    let embedded_file_names: string[] = [];
    // skip over the header (0x8 bytes) and the first entry which is fake (0x10 bytes)
    const embedded_file_dictionary_entry_offset = name_array_offset + 0x18;
    for (let i = 0; i < count; i++)
    {
        const name_offset = view.getUint32(embedded_file_dictionary_entry_offset + 0x8, true);
        const name = read_bfres_string(buffer, name_offset, true);

        embedded_file_names.push(name);
        embedded_file_dictionary_entry_offset + RESOURCE_DICTIONARY_ENTRY_SIZE;
    }

    const embedded_file_array: EmbeddedFile[] = [];
    let embedded_file_entry_offset = file_array_offset;
    for (let i = 0; i < count; i++)
    {
        const name = embedded_file_names[i];
        const offset = view.getUint32(embedded_file_entry_offset, true);
        const size = view.getUint32(embedded_file_entry_offset + 0x8, true);
        const file_buffer = buffer.subarray(offset, size);

        embedded_file_array.push({ name, buffer: file_buffer });
        embedded_file_entry_offset += EMBEDDED_FILE_ENTRY_SIZE;
    }

    return embedded_file_array;
}

export interface FRES
{
    name: string;
    fmdl: FMDL[];
    fska: FSKA[];
    fmaa: FMAA[];
    embedded_files: EmbeddedFile[];
}

export interface EmbeddedFile
{
    name: string;
    buffer: ArrayBufferSlice;
}
