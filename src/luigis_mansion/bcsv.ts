
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";

function readStringSJIS(buffer: ArrayBufferSlice, offs: number): string {
    return readString(buffer, offs, -1, true, 'sjis');
}

export const enum BcsvFieldType {
    S32 = 0,
    // TODO(jstpierre): Verify
    STRING = 1,
    F32 = 2,
    S16 = 4,
    S8 = 5,
    SJIS = 6,
}

export interface BcsvField {
    nameHash: number;
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
        const bitmask = view.getUint32(fieldTableIdx + 0x04, littleEndian);
        const recordOffset = view.getUint16(fieldTableIdx + 0x08, littleEndian);
        const shift = view.getInt8(fieldTableIdx + 0x0A);
        const type = view.getUint8(fieldTableIdx + 0x0B);
        fields.push({ nameHash, bitmask, recordOffset, shift, type });
        fieldTableIdx += 0x0C;
    }

    let recordTableIdx = recordOffs;
    const records: BcsvRecord[] = [];
    for (let i = 0; i < recordCount; i++) {
        const record: BcsvRecord = [];

        for (let j = 0; j < fields.length; j++) {
            const field = fields[j];
            const fieldOffs = recordTableIdx + field.recordOffset;
            let value;
            switch (field.type) {
            case BcsvFieldType.S32:
                value = (view.getInt32(fieldOffs, littleEndian) & field.bitmask) >> field.shift;
                break;
            case BcsvFieldType.STRING:
                value = readString(buffer, fieldOffs, 0x20, true);
                break;
            case BcsvFieldType.F32:
                value = view.getFloat32(fieldOffs, littleEndian);
                break;
            case BcsvFieldType.S16:
                value = ((view.getInt16(fieldOffs, littleEndian) & field.bitmask) >> field.shift) << 16 >> 16;
                break;
            case BcsvFieldType.S8:
                value = ((view.getInt8(fieldOffs) & field.bitmask) >> field.shift) << 24 >> 24;
                break;
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
    for (let i = 0; i < bcsv.fields.length; i++)
        if (bcsv.fields[i].nameHash === nameHash)
            return i;
    return -1;
}
