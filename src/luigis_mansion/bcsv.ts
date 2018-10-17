
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";

const sjisDecoder = new TextDecoder('sjis');

function readStringSJIS(buffer: ArrayBufferSlice, offs: number): string {
    const arr = buffer.createTypedArray(Uint8Array, offs);
    const raw = sjisDecoder.decode(arr);
    const nul = raw.indexOf('\u0000');
    let str: string;
    if (nul >= 0)
        str = raw.slice(0, nul);
    else
        str = raw;
    return str;
}

// Luigi's Mansion
export function bcsvHashLM(str: string): number {
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

// Super Mario Galaxy
export function bcsvHashSMG(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 0x1F + str.charCodeAt(i)) >>> 0;
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

    'GalaxyName',
    'ZoneName',
    'ScenarioNo', 'ScenarioName', 'PowerStarId', 'AppearPowerStarObj', 'Comet', 'LuigiModeTimer', 'IsHidden', 'Hidden',
    'WorldNo',
    'SceneNo', 'MarioNo',
    'PlanetName', 'LowFlag', 'MiddleFlag', 'BloomFlag', 'WaterFlag', 'WaterFlag', 'IndirectFlag',
    'Obj_arg0', 'Obj_arg1', 'Obj_arg2', 'Obj_arg3', 'Obj_arg4', 'Obj_arg5', 'Obj_arg6', 'Obj_arg7',
];

const hashLookup = new Map<number, string>();
nameTable.forEach((name) => {
    hashLookup.set(bcsvHashLM(name), name);
    hashLookup.set(bcsvHashSMG(name), name);
});

function findNameFromHash(hash: number): string {
    const name = hashLookup.get(hash);
    if (name !== undefined)
        return name;
    else
        return `Unk$${hash}`;
}

export const enum BcsvFieldType {
    Int = 0,
    String = 1,
    Float = 2,
    Short = 4,
    Byte = 5,
    SJIS = 6,
}

export interface BcsvField {
    nameHash: number;
    debugName: string;
    bitmask: number;
    recordOffset: number;
    shift: number;
    type: BcsvFieldType;
}

export type BcsvValue = number | string;
export type BcsvRecord  = BcsvValue[];

export interface Bcsv {
    fields: BcsvField[];
    records: BcsvRecord[];
}

export function parse(buffer: ArrayBufferSlice, littleEndian: boolean = false): Bcsv {
    const view = buffer.createDataView();

    const recordCount = view.getUint32(0x00, littleEndian);
    const fieldCount = view.getUint32(0x04, littleEndian);
    const recordOffs = view.getUint32(0x08, littleEndian);
    const recordSize = view.getUint32(0x0C, littleEndian);
    const strTableOffs = recordOffs + (recordCount * recordSize);

    let fieldTableIdx = 0x10;
    const fields: BcsvField[] = [];
    for (let i = 0; i < fieldCount; i++) {
        const nameHash = view.getUint32(fieldTableIdx + 0x00, littleEndian);
        const debugName = findNameFromHash(nameHash);
        const bitmask = view.getUint32(fieldTableIdx + 0x04, littleEndian);
        const recordOffset = view.getUint16(fieldTableIdx + 0x08, littleEndian);
        const shift = view.getInt8(fieldTableIdx + 0x0A);
        const type = view.getUint8(fieldTableIdx + 0x0B);
        fields.push({ nameHash, debugName, bitmask, recordOffset, shift, type });
        fieldTableIdx += 0x0C;
    }

    let recordTableIdx = recordOffs;
    const records: BcsvRecord[] = [];
    for (let i = 0; i < recordCount; i++) {
        const record: BcsvRecord = [];

        for (const field of fields) {
            const fieldOffs = recordTableIdx + field.recordOffset;
            let value;
            switch (field.type) {
            case BcsvFieldType.Int:
                value = (view.getUint32(fieldOffs, littleEndian) >> field.shift) & field.bitmask;
                break;
            case BcsvFieldType.String:
                value = readString(buffer, fieldOffs, 0x20, true);
                break;
            case BcsvFieldType.Float:
                value = view.getFloat32(fieldOffs, littleEndian);
                break;
            case BcsvFieldType.Short:
                value = (view.getUint16(fieldOffs, littleEndian) >> field.shift) & field.bitmask;
                break;
            case BcsvFieldType.Byte:
                value = (view.getUint8(fieldOffs) >> field.shift) & field.bitmask;
            case BcsvFieldType.SJIS: {
                const strOffs = strTableOffs + view.getUint32(fieldOffs, littleEndian);
                value = readStringSJIS(buffer, strOffs);
                break;
            }
            default:
                throw new Error(`Unknown field type ${field.type}`);
            }

            record.push(value);
        }
        records.push(record);

        recordTableIdx += recordSize;
    }

    return { fields, records };
}

export function getFieldIndexFromHash(bcsv: Bcsv, nameHash: number): number {
    return bcsv.fields.findIndex((field) => field.nameHash === nameHash);
}

export function getFieldIndexFromName(bcsv: Bcsv, name: string): number {
    const nameHash2 = bcsvHashSMG(name);
    const index2 = getFieldIndexFromHash(bcsv, nameHash2);
    if (index2 >= 0)
        return index2;

    const nameHash1 = bcsvHashLM(name);
    const index1 = getFieldIndexFromHash(bcsv, nameHash1);
    if (index1 >= 0)
        return index1;

    return -1;
}

export function getField<T extends BcsvValue>(bcsv: Bcsv, record: BcsvRecord, name: string, fallback: T | null = null): T {
    const index = getFieldIndexFromName(bcsv, name);
    if (index === -1)
        return fallback;
    return record[index] as T;
}
