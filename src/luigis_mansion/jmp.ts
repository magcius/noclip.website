
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";

export const enum JMPFieldType {
    Int = 0,
    String = 1,
    Float = 2,
}

export interface JMPField {
    nameHash: number;
    name: string;
    bitmask: number;
    recordOffset: number;
    shift: number;
    type: JMPFieldType;
}

function nameHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash <<= 8;
        hash += str.charCodeAt(i);
        // const r6 = Math.floor((4993 * hash) >>> 32);
        const r6 = Math.floor((4993 * hash) / 0x100000000);
        const r0 = (((hash - r6) / 2) + r6) >> 24;
        hash -= r0 * 33554393;
    }
    return hash;
}

const nameTable = [
    'pos_x', 'pos_y', 'pos_z',
    'dir_x', 'dir_y', 'dir_z',
    'scale_x', 'scale_y', 'scale_z',
    'pnt0_x', 'pnt0_y', 'pnt0_z',
    'furniture_x', 'furniture_y', 'furniture_z',
    'name', 'dmd_name', 'path_name', 'create_name', 'character_name', 'access_name', 'CodeName',
    'arg0', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'arg6', 'arg7', 'arg8',
    'room_no',
];

const hashLookup = new Map<number, string>();
nameTable.forEach((name) => {
    hashLookup.set(nameHash(name), name);
});

function findNameFromHash(hash: number): string {
    const name = hashLookup.get(hash);
    if (name !== undefined)
        return name;
    else
        return `Unk$${hash}`;
}

export function parse(buffer: ArrayBufferSlice): any[] {
    const view = buffer.createDataView();

    const recordCount = view.getUint32(0x00, false);
    const fieldCount = view.getUint32(0x04, false);
    const recordOffs = view.getUint32(0x08, false);
    const recordSize = view.getUint32(0x0C, false);

    let fieldTableIdx = 0x10;
    const fields: JMPField[] = [];
    for (let i = 0; i < fieldCount; i++) {
        const nameHash = view.getUint32(fieldTableIdx + 0x00);
        const bitmask = view.getUint32(fieldTableIdx + 0x04);
        const recordOffset = view.getUint16(fieldTableIdx + 0x08);
        const shift = view.getInt8(fieldTableIdx + 0x0A);
        const type = view.getUint8(fieldTableIdx + 0x0B);
        const name = findNameFromHash(nameHash);
        fields.push({ nameHash, name, bitmask, recordOffset, shift, type });
        fieldTableIdx += 0x0C;
    }

    let recordTableIdx = recordOffs;
    const records: any[] = [];
    for (let i = 0; i < recordCount; i++) {
        let record: any = {};

        for (const field of fields) {
            const fieldOffs = recordTableIdx + field.recordOffset;
            let value;
            switch (field.type) {
            case JMPFieldType.Int:
                value = (view.getUint32(fieldOffs, false) >> field.shift) & field.bitmask;
                break;
            case JMPFieldType.String:
                value = readString(buffer, fieldOffs, 0x20, true);
                break;
            case JMPFieldType.Float:
                value = view.getFloat32(fieldOffs, false);
                break;
            }

            record[field.name] = value;
        }
        records.push(record);

        recordTableIdx += recordSize;
    }

    return records;
}
