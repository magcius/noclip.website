// apak.ts
// handles APAK (Atlas PAK?) data, which bundles multiple files together
// as far as I'm aware Tokyo Mirage Sessions ♯FE is the only game that uses this

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import { assert, readString } from "../util.js";
import { DataFetcher } from "../DataFetcher.js";

/**
 * reads an APAK file and returns an APAK object
 * @param buffer the APAK file
 */
export function parseAPAK(buffer: ArrayBufferSlice): APAK
{
    assert(readString(buffer, 0x00, 0x04) === 'APAK');
    const view = buffer.createDataView();
    
    const file_count = view.getUint32(0x08, true);
    let file_array: file[] = [];
    let file_info_entry_offset = FILE_INFO_ARRAY_START;
    for (let i = 0; i < file_count; i++)
    {
        const file_name = readString(buffer, file_info_entry_offset + 0x20, 0x20);
        const data_offset = view.getUint32(file_info_entry_offset + 0x04, true);
        const data_size = view.getUint32(file_info_entry_offset + 0x08, true);
        const data = buffer.subarray(data_offset, data_size);

        file_array.push({ name: file_name, data });
        file_info_entry_offset += FILE_INFO_ENTRY_SIZE;
    }

    return { files: file_array };
}

const FILE_INFO_ARRAY_START = 0x18;
const FILE_INFO_ENTRY_SIZE = 0x40;

/**
 * returns an array of all the files in an APAK file with a specified file extension
 * @param apak the apak file
 * @param type the file extension to look for
 */
export function get_files_of_type(apak: APAK, type: string)
{
    let file_data_array: ArrayBufferSlice[] = [];

    for (let i = 0; i < apak.files.length; i++)
    {
        const file = apak.files[i];
        const extension: string = file.name.slice((Math.max(0, file.name.lastIndexOf(".")) || Infinity) + 1);
        if (extension === type)
        {
            file_data_array.push(file.data);
        }
    }

    return file_data_array;
}

/**
 * returns a file that matches the specified filename
 * @param apak the apak file
 * @param name the file name
 */
export function get_file_by_name(apak: APAK, name: string): ArrayBufferSlice | undefined
{
    const file = apak.files.find((f) => f.name === name);
    if (file !== undefined)
    {
        return file.data;
    }
    else
    {
        return undefined;
    }
}

export async function get_fres_from_apak(apak_path: string, bfres_name: string, data_fetcher: DataFetcher): Promise<FRES>
{
    const apak = parseAPAK(await data_fetcher.fetchData(apak_path));
    const bfres = get_file_by_name(apak, bfres_name);
    if (bfres == undefined)
    {
        console.error(`file ${bfres_name} not found`);
        throw("whoops");
    }
    const fres = parseBFRES(bfres);
    return fres;
}

export interface APAK
{
    files: file[];
}

interface file
{
    name: string;
    data: ArrayBufferSlice;
}
