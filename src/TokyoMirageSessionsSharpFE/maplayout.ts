// maplayout.ts
// handles data from maplayout.layout files, which contain the 3d coordinates of gimmicks and more

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { mat4, vec3 } from "gl-matrix";
import { MathConstants, computeModelMatrixSRT } from "../MathHelpers.js";
import { assert, readString } from "../util.js";

/**
 * reads from a maplayout.layout file and returns a MapLayout object
 * @param buffer the maplayout.layout file
 */
export function parseLayout(buffer: ArrayBufferSlice): MapLayout
{
    assert(readString(buffer, 0x0, 0x04) === 'LYTS');

    const view = buffer.createDataView();
    
    let little_endian = false;
    if (view.getUint8(0x4) == 9)
    {
        little_endian = true;
    }

    const entry_count = view.getUint32(0x08, little_endian);

    const event_entries: MapLayoutEntry[] = [];
    const event_dir_entries: MapLayoutEntry[] = [];
    const object_entries: MapLayoutEntry[] = [];
    const enemy_entries: MapLayoutEntry[] = [];
    const npc_entries: MapLayoutEntry[] = [];
    const heal_point_entries: MapLayoutEntry[] = [];
    const treasurebox_01_entries: MapLayoutEntry[] = [];
    const treasurebox_02_entries: MapLayoutEntry[] = [];
    const blockside_entries: MapLayoutEntry[] = [];
    const blockwall_entries: MapLayoutEntry[] = [];
    const warp_entries: MapLayoutEntry[] = [];
    const gate_entries: MapLayoutEntry[] = [];
    const elevator_entries: MapLayoutEntry[] = [];
    const transparent_floor_entries: MapLayoutEntry[] = [];

    const entries: MapLayoutEntry[] = [];
    let entry_offset = ENTRY_START;
    for (let i = 0; i < entry_count; i++)
    {
        const group_index = view.getUint32(entry_offset + 0x0, little_endian);
        const unk_04 = view.getUint32(entry_offset + 0x4, little_endian);
        const id = view.getUint32(entry_offset + 0x08, little_endian);

        const position_x = view.getFloat32(entry_offset + 0xC, little_endian);
        const position_y = view.getFloat32(entry_offset + 0x10, little_endian);
        const position_z = view.getFloat32(entry_offset + 0x14, little_endian);
        const position = vec3.fromValues(position_x, position_y, position_z);

        const half_extent_x = view.getFloat32(entry_offset + 0x18, little_endian);
        const half_extent_y = view.getFloat32(entry_offset + 0x1C, little_endian);
        const half_extent_z = view.getFloat32(entry_offset + 0x20, little_endian);
        const half_extents = vec3.fromValues(half_extent_x, half_extent_y, half_extent_z);

        const rotation_x = view.getFloat32(entry_offset + 0x24, little_endian);
        const rotation_y = view.getFloat32(entry_offset + 0x28, little_endian);
        const rotation_z = view.getFloat32(entry_offset + 0x2C, little_endian);
        const rotation = vec3.fromValues
        (
            rotation_x * MathConstants.DEG_TO_RAD,
            rotation_y * MathConstants.DEG_TO_RAD,
            rotation_z * MathConstants.DEG_TO_RAD
        );

        const unk_8C_string_offset = view.getUint32(entry_offset + 0x8C, little_endian);
        const unk_8C = readString(buffer, unk_8C_string_offset, 0xFF, little_endian);

        const entry: MapLayoutEntry = { group_index, unk_04, id, position, half_extents, rotation, unk_8C };
        switch (group_index)
        {
            case GROUP_INDEX_EVENT:
                event_entries.push(entry);
                break;

            case GROUP_INDEX_EVENT_DIR:
                event_dir_entries.push(entry);
                break;

            case GROUP_INDEX_OBJECT:
                object_entries.push(entry);
                break;

            case GROUP_INDEX_ENEMY:
                enemy_entries.push(entry);
                break;

            case GROUP_INDEX_NPC:
                npc_entries.push(entry);
                break;
            
            case GROUP_INDEX_BLOCKSIDE:
                blockside_entries.push(entry);
                break;
            
            case GROUP_INDEX_BLOCKWALL:
                blockwall_entries.push(entry);
                break;

            case GROUP_INDEX_HEAL_POINT:
                heal_point_entries.push(entry);
                break;

            case GROUP_INDEX_WARP:
                warp_entries.push(entry);
                break;
            
            case GROUP_INDEX_GATE:
                gate_entries.push(entry);
                break;

            case GROUP_INDEX_ELEVATOR:
                elevator_entries.push(entry);
                break;

            case GROUP_INDEX_TRANSPARENT_FLOOR:
                transparent_floor_entries.push(entry);
                break;

            case GROUP_INDEX_TREASURE_BOX_01:
                treasurebox_01_entries.push(entry);
                break;

            case GROUP_INDEX_TREASURE_BOX_02:
                treasurebox_02_entries.push(entry);
                break;

            default:
                entries.push(entry);
                break;
            
        }
        entry_offset += ENTRY_SIZE;
    }

    let map_layout =
    {
        event_entries,
        event_dir_entries,
        object_entries,
        enemy_entries,
        npc_entries,
        treasurebox_01_entries,
        treasurebox_02_entries,
        blockside_entries,
        blockwall_entries,
        heal_point_entries,
        warp_entries,
        gate_entries,
        elevator_entries,
        transparent_floor_entries,
        entries,
    };
    return map_layout;
}

const ENTRY_START = 0x10;
const ENTRY_SIZE = 0xA0;
const GROUP_INDEX_EVENT = 0;
const GROUP_INDEX_EVENT_DIR = 1;
const GROUP_INDEX_2 = 2;
const GROUP_INDEX_OBJECT = 3;
const GROUP_INDEX_ENEMY = 4;
const GROUP_INDEX_NPC = 5;
const GROUP_INDEX_TREASURE_BOX_01 = 8;
const GROUP_INDEX_BLOCKSIDE = 9;
const GROUP_INDEX_BLOCKWALL = 10;
const GROUP_INDEX_HEAL_POINT = 16;
const GROUP_INDEX_WARP = 17;
const GROUP_INDEX_GATE = 18;
const GROUP_INDEX_ELEVATOR = 21;
const GROUP_INDEX_TRANSPARENT_FLOOR = 31;
const GROUP_INDEX_36 = 36;
const GROUP_INDEX_TREASURE_BOX_02 = 37;

/**
 * port of mapGetLayoutPoint() from lua scripts.
 * @param layout the maplayout file to read from
 * @param id the point's ID. all layout points are stored in group index 1.
 * @param offset_x this offset is relative to the layout point's facing direction
 * @param offset_y this offset is relative to the layout point's facing direction
 * @param offset_z this offset is relative to the layout point's facing direction
 * @returns the position and rotation of the layout point
 */
export function get_layout_point(layout: MapLayout, id: number, offset_x: number, offset_y: number, offset_z: number): LayoutPoint
{
    const layout_point = get_point_from_group(layout.event_dir_entries, id);

    if (offset_x == 0.0 && offset_y == 0.0 && offset_z == 0.0)
    {
        return { position: layout_point.position, rotation: layout_point.rotation };
    }

    let offset_matrix = mat4.create();
    computeModelMatrixSRT
    (
        offset_matrix,
        1.0, 1.0, 1.0,
        0.0, 0.0, 0.0,
        offset_x, offset_y, offset_z,
    );
    
    let rotation_matrix = mat4.create();
    computeModelMatrixSRT
    (
        rotation_matrix,
        1.0, 1.0, 1.0,
        layout_point.rotation[0], layout_point.rotation[1], layout_point.rotation[2],
        0.0, 0.0, 0.0,
    );

    let new_offset_matrix = mat4.create();
    mat4.multiply(new_offset_matrix, rotation_matrix, offset_matrix);

    const new_position = vec3.fromValues
    (
        layout_point.position[0] + new_offset_matrix[12],
        layout_point.position[1] + new_offset_matrix[13],
        layout_point.position[2] + new_offset_matrix[14]
    );

    return{ position: new_position, rotation: layout_point.rotation };
}

/**
 * @param group the array of entries to check
 * @param id the point's ID
 * @returns the position and rotation of the layout point
 */
export function get_point_from_group(group: MapLayoutEntry[], id: number): LayoutPoint
{
    for (let i = 0; i < group.length; i++)
    {
        if (group[i].id == id)
        {
            const layout_point = group[i];
            return { position: layout_point.position, rotation: layout_point.rotation };
        }
    }

    console.error(`layout point with id ${id} not found`);
    throw("whoops");
}

export interface MapLayout
{
    event_entries: MapLayoutEntry[];
    event_dir_entries: MapLayoutEntry[];
    object_entries: MapLayoutEntry[];
    enemy_entries: MapLayoutEntry[];
    npc_entries: MapLayoutEntry[];
    entries: MapLayoutEntry[];
    treasurebox_01_entries: MapLayoutEntry[];
    treasurebox_02_entries: MapLayoutEntry[];
    blockside_entries: MapLayoutEntry[];
    blockwall_entries: MapLayoutEntry[];
    heal_point_entries: MapLayoutEntry[];
    warp_entries: MapLayoutEntry[];
    gate_entries: MapLayoutEntry[];
    elevator_entries: MapLayoutEntry[];
    transparent_floor_entries: MapLayoutEntry[];
}

export interface MapLayoutEntry
{
    group_index: number;
    unk_04: number;
    id: number;
    position: vec3;
    half_extents: vec3;
    rotation: vec3;
    unk_8C: string; // has the gate type
}

export interface LayoutPoint
{
    position: vec3;
    rotation: vec3;
}
