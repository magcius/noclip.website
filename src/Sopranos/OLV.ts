import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { MathConstants } from "../MathHelpers.js";
import { readString } from "../util.js";

const PROTOTYPE_SIZE = 0x104;
const INSTANCE_SIZE = 0x88;
const PROTOTYPE_TABLE_AT = 0x667C;
const INSTANCE_TABLE_AT = 0x16A80;
const INSTANCE_TABLE_END = 0x38A80;
const STRING_TABLE_AT = 0x18;
const INSTANCE_COUNT_AT = 0x4C;
const POSITION_AT = 0x08;
const NAME_AT = 0x14;
const PROTOTYPE_AT = 0x16;
const ROTATION_AT = 0x22;
const NAME_LIMIT = 120;
const FULL_TURN = 0x10000;

export interface Placement {
    name: string;
    prototype: string;
    x: number;
    y: number;
    z: number;
    // Heading about the vertical axis, in radians. The file turns the other way and measures from
    // the opposite axis.
    rotation: number;
}

function nameAt(data: ArrayBufferSlice, strings: number, offset: number): string {
    const start = strings + offset;
    if (start <= 0 || start >= data.byteLength) {
        return '';
    }
    const name = readString(data, start, NAME_LIMIT + 1);
    return name.length > 0 && name.length <= NAME_LIMIT ? name : '';
}

/**
 * Read every object a level places. An `.OLV` is a memory image of the runtime object manager, so
 * every array sits at an offset the executable hard-codes and the header repeats.
 * @param data The whole `.OLV` file.
 * @returns One entry per placed object, in file order. Entries with an unnamed prototype are
 * dropped; that is how the table's unused tail reads.
 */
export function readPlacements(data: ArrayBufferSlice): Placement[] {
    if (data.byteLength <= INSTANCE_TABLE_END) {
        return [];
    }
    const view = data.createDataView();
    if (view.getUint32(0x00, true) !== PROTOTYPE_TABLE_AT || view.getUint32(0x04, true) !== PROTOTYPE_TABLE_AT ||
        view.getUint32(0x08, true) !== INSTANCE_TABLE_AT || view.getUint32(0x0C, true) !== INSTANCE_TABLE_END)
        return [];
    const strings = view.getUint32(STRING_TABLE_AT, true);
    const count = view.getUint32(INSTANCE_COUNT_AT, true);
    const placements: Placement[] = [];
    for (let index = 1; index <= count; index++) {
        const at = INSTANCE_TABLE_AT + index * INSTANCE_SIZE;
        if (at + INSTANCE_SIZE > INSTANCE_TABLE_END) {
            break;
        }
        const prototype = view.getUint16(at + PROTOTYPE_AT, true);
        const label = nameAt(data, strings, view.getUint16(PROTOTYPE_TABLE_AT + prototype * PROTOTYPE_SIZE + NAME_AT, true));
        if (label === '') {
            continue;
        }
        placements.push({
            name: nameAt(data, strings, view.getUint16(at + NAME_AT, true)),
            prototype: label,
            x: view.getInt16(at + POSITION_AT + 0, true),
            y: view.getInt16(at + POSITION_AT + 2, true),
            z: view.getInt16(at + POSITION_AT + 4, true),
            rotation: Math.PI - view.getInt16(at + ROTATION_AT, true) / FULL_TURN * MathConstants.TAU,
        });
    }
    return placements;
}
