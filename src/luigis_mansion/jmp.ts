
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";

const enum JMPFieldType {
    Int = 0,
    String = 1,
    Float = 2,
}

interface JMPField {
    nameHash: number;
    bitmask: number;
    recordOffset: number;
    shift: number;
    type: JMPFieldType;
}

function parse(buffer: ArrayBufferSlice): any[] {
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
        const shift = view.getInt8(0x0A);
        const type = view.getUint8(0x0B);
        fields.push({ nameHash, bitmask, recordOffset, shift, type });
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

            record[field.nameHash] = value;
        }
        records.push(record);

        recordTableIdx += recordSize;
    }

    return records;
}
