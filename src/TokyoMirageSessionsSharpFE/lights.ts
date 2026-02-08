// lights.ts
// handles data in .lig files

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { vec3 } from "gl-matrix";
import { assert, readString } from "../util.js";

export function parseLights(buffer: ArrayBufferSlice): Light[]
{
    assert(readString(buffer, 0x0, 0x04) === 'LIGF');
    
    const view = buffer.createDataView();

    let little_endian = true;
    if (view.getUint8(0x20) == 0)
    {
        little_endian = false;
    }

    const ldat_offset = view.getUint32(0x20, little_endian);
    const ltyp_offset = view.getUint32(0x24, little_endian);
    const lnam_offset = view.getUint32(0x28, little_endian);
    const lnna_offset = view.getUint32(0x2C, little_endian);

    let ldat_count = view.getUint32(ldat_offset + 0x8, false);
    if (ldat_count === 0)
    {
        // b016_01.lig has this as a little endian uint32
        ldat_count = view.getUint32(ldat_offset + 0x8, true);
    }

    const ltyp_count = view.getUint32(ltyp_offset + 0x8, false);
    let ltyp_array: LightType[] = [];
    let ltyp_entry_offset = ltyp_offset + 0x10;
    for (let i = 0; i < ltyp_count; i++)
    {
        const type = view.getUint32(ltyp_entry_offset, little_endian);

        ltyp_array.push(type);
        ltyp_entry_offset += LTYP_ENTRY_SIZE;
    }

    const lnam_count = view.getUint32(lnam_offset + 0x8, false);
    let lnam_entry_offset = lnam_offset + 0x10;
    let lnam_string_offsets: number[] = [];
    for (let i = 0; i < lnam_count; i++)
    {
        const offset = view.getUint32(lnam_entry_offset, little_endian);

        lnam_string_offsets.push(offset);
        lnam_entry_offset += LNAM_ENTRY_SIZE;
    }

    // the last string offset is the end of the string table, so the real count is lnam_count - 1
    let lnam_array: string[] = [];
    for (let i = 0; i < lnam_count - 1; i++)
    {
        const start = lnam_string_offsets[i];
        const end = lnam_string_offsets[i + 1];
        const length = end - start;
        const string = readString(buffer, start + lnam_offset, length);

        lnam_array.push(string);
    }

    const lnna_count = view.getUint32(lnna_offset + 0x8, false);
    let lnna_entry_offset = lnna_offset + 0x10;
    let lnna_string_offsets: number[] = [];
    for (let i = 0; i < lnna_count; i++)
    {
        const offset = view.getUint32(lnna_entry_offset, little_endian);

        lnna_string_offsets.push(offset);
        lnna_entry_offset += LNNA_ENTRY_SIZE;
    }

    let lnna_array: string[] = [];
    for (let i = 0; i < lnna_count - 1; i++)
    {
        const start = lnna_string_offsets[i];
        const end = lnna_string_offsets[i + 1];
        const length = end - start;
        const string = readString(buffer, start + lnna_offset, length);

        lnna_array.push(string);
    }

    let lights: Light[] = [];
    let ldat_entry_offset = ldat_offset + 0x10;
    for (let i = 0; i < ldat_count; i++)
    {
        const type = ltyp_array[i];
        const name = lnam_array[i];
        const name2 = lnna_array[i];

        const position_x = view.getFloat32(ldat_entry_offset + 0x0, little_endian);
        const position_y = view.getFloat32(ldat_entry_offset + 0x4, little_endian);
        const position_z = view.getFloat32(ldat_entry_offset + 0x8, little_endian);
        const position = vec3.fromValues(position_x, position_y, position_z);

        const color_r = view.getFloat32(ldat_entry_offset + 0x20, little_endian);
        const color_g = view.getFloat32(ldat_entry_offset + 0x24, little_endian);
        const color_b = view.getFloat32(ldat_entry_offset + 0x28, little_endian);
        const color = colorNewFromRGBA(color_r, color_g, color_b, 1.0);

        lights.push({ type, name, name2, position, color });
        ldat_entry_offset += LDAT_ENTRY_SIZE;
    }

    return lights;
}

const LDAT_ENTRY_SIZE = 0x50;
const LTYP_ENTRY_SIZE = 0x4;
const LNAM_ENTRY_SIZE = 0x4;
const LNNA_ENTRY_SIZE = 0x4;

export interface Light
{
    type: LightType,
    name: string;
    name2: string;
    position: vec3;
    color: Color;
}

export enum LightType
{
    Directional,
    Point,
}
