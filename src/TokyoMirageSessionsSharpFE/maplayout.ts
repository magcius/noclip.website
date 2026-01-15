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

    const treasurebox_01_entries: MapLayoutEntry[] = [];
    const treasurebox_02_entries: MapLayoutEntry[] = [];
    const blockside_entries: MapLayoutEntry[] = [];
    const blockwall_entries: MapLayoutEntry[] = [];
    const warp_entries: MapLayoutEntry[] = [];
    const gate_entries: MapLayoutEntry[] = [];
    const group_1: MapLayoutEntry[] = [];
    const entries: MapLayoutEntry[] = [];
    let entry_offset = ENTRY_START;
    for (let i = 0; i < entry_count; i++)
    {
        const group_index = view.getUint32(entry_offset + 0x0, true);
        const unk_04 = view.getUint32(entry_offset + 0x4, true);
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
        switch (group_index)
        {
            case 1:
                group_1.push({ group_index, unk_04, id, position, rotation, unknown });
                break;

            case GROUP_INDEX_TREASURE_BOX_01:
                treasurebox_01_entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;
            
            case GROUP_INDEX_BLOCKSIDE:
                blockside_entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;
            
            case GROUP_INDEX_BLOCKWALL:
                blockwall_entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;
            
            case GROUP_INDEX_WARP:
                warp_entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;
            
            case GROUP_INDEX_GATE:
                gate_entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;

            case GROUP_INDEX_TREASURE_BOX_02:
                treasurebox_02_entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;

            default:
                entries.push({ group_index, unk_04, id, position, rotation, unknown });
                break;
            
        }
        entry_offset += ENTRY_SIZE;
    }

    return { treasurebox_01_entries, treasurebox_02_entries, blockside_entries, blockwall_entries, warp_entries, gate_entries, group_1, entries };
}

const ENTRY_START = 0x10;
const ENTRY_SIZE = 0xA0;
const GROUP_INDEX_TREASURE_BOX_01 = 8;
const GROUP_INDEX_BLOCKSIDE = 9;
const GROUP_INDEX_BLOCKWALL = 10;
const GROUP_INDEX_WARP = 17;
const GROUP_INDEX_GATE = 18;
const GROUP_INDEX_TREASURE_BOX_02 = 37;

export function get_layout_point(layout: MapLayout, id: number): MapLayoutEntry
{
    for (let i = 0; i < layout.group_1.length; i++)
    {
        if (layout.group_1[i].id == id)
        {
            return layout.group_1[i];
        }

    }

    console.error(`layout point with id ${id} not found`);
    throw("whoops");
}

export interface MapLayout
{
    treasurebox_01_entries: MapLayoutEntry[];
    treasurebox_02_entries: MapLayoutEntry[];
    blockside_entries: MapLayoutEntry[];
    blockwall_entries: MapLayoutEntry[];
    warp_entries: MapLayoutEntry[];
    gate_entries: MapLayoutEntry[];
    group_1: MapLayoutEntry[];
    entries: MapLayoutEntry[];
}

export interface MapLayoutEntry
{
    group_index: number;
    unk_04: number;
    id: number;
    position: vec3;
    rotation: vec3;
    unknown: vec3;
}
