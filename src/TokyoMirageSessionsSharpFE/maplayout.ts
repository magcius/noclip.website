// maplayout.ts
// handles data from maplayout.layout files, which contain the 3d coordinates of gimmicks and more

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { vec3 } from "gl-matrix";
import { MathConstants } from "../MathHelpers.js";
import { assert, readString } from "../util.js";

export function parseLayout(buffer: ArrayBufferSlice): MapLayout
{
    assert(readString(buffer, 0x0, 0x04) === 'LYTS');
    const view = buffer.createDataView();
    const entry_count = view.getUint32(0x08, true);

    const entries: MapLayoutEntry[] = [];
    let entry_offset = ENTRY_START;
    for (let i = 0; i < entry_count; i++)
    {
        const group_index = view.getUint32(entry_offset + 0x0, true);
        const id = view.getUint32(entry_offset + 0x08, true);

        const position_x = view.getFloat32(entry_offset + 0xC, true);
        const position_y = view.getFloat32(entry_offset + 0x10, true);
        const position_z = view.getFloat32(entry_offset + 0x14, true);
        const position = vec3.fromValues(position_x, position_y, position_z);

        // TODO: not actually scale
        const scale_x = view.getFloat32(entry_offset + 0x18, true);
        const scale_y = view.getFloat32(entry_offset + 0x1C, true);
        const scale_z = view.getFloat32(entry_offset + 0x20, true);
        const unknown = vec3.fromValues(scale_x, scale_y, scale_z);

        const rotation_x = view.getFloat32(entry_offset + 0x24, true);
        const rotation_y = view.getFloat32(entry_offset + 0x28, true);
        const rotation_z = view.getFloat32(entry_offset + 0x2C, true);
        const rotation = vec3.fromValues
        (
            rotation_x * MathConstants.DEG_TO_RAD,
            rotation_y * MathConstants.DEG_TO_RAD,
            rotation_z * MathConstants.DEG_TO_RAD
        );


        entries.push({ group_index, id, position, rotation, unknown });
        entry_offset += ENTRY_SIZE;
    }

    return { entries };
}

const ENTRY_START = 0x10;
const ENTRY_SIZE = 0xA0;

export interface MapLayout
{
    entries: MapLayoutEntry[];
}

export interface MapLayoutEntry
{
    group_index: number;
    id: number;
    position: vec3;
    rotation: vec3;
    unknown: vec3;
}
