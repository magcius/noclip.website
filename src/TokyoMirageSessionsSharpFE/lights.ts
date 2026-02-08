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
    let ldat_count = view.getUint32(ldat_offset + 0x8, false);
    if (ldat_count === 0)
    {
        // b016_01.lig has this as a little endian uint32
        ldat_count = view.getUint32(ldat_offset + 0x8, true);
    }

    let lights: Light[] = [];
    let ldat_entry_offset = ldat_offset + 0x10;
    for (let i = 0; i < ldat_count; i++)
    {
        const position_x = view.getFloat32(ldat_entry_offset + 0x0, little_endian);
        const position_y = view.getFloat32(ldat_entry_offset + 0x4, little_endian);
        const position_z = view.getFloat32(ldat_entry_offset + 0x8, little_endian);
        const position = vec3.fromValues(position_x, position_y, position_z);

        const color_r = view.getFloat32(ldat_entry_offset + 0x20, little_endian);
        const color_g = view.getFloat32(ldat_entry_offset + 0x24, little_endian);
        const color_b = view.getFloat32(ldat_entry_offset + 0x28, little_endian);
        const color = colorNewFromRGBA(color_r, color_g, color_b, 1.0);

        lights.push({ position, color });
        ldat_entry_offset += LDAT_ENTRY_SIZE;
    }

    return lights;
}

const LDAT_ENTRY_SIZE = 0X50;

export interface Light
{
    position: vec3;
    color: Color;
}
