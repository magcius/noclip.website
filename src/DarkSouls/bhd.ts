
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

export interface FileRecord {
    nameHash: number;
    name: string;
    buffer: ArrayBufferSlice;
}

export interface BHD {
    fileRecords: FileRecord[];
}

export function parse(buffer: ArrayBufferSlice, dataBuffer: ArrayBufferSlice): BHD {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x0C, false) == 'BHF307D7R6\0\0');
    assert(readString(dataBuffer, 0x00, 0x0C, false) == 'BDF307D7R6\0\0');
    const count = view.getUint32(0x10, true);

    const fileRecords: FileRecord[] = [];

    let idx = 0x20;
    for (let i = 0; i < count; i++) {
        // Unk.
        idx += 0x04;
        const recordSize = view.getUint32(idx, true);
        idx += 0x04;
        const recordOffs = view.getUint32(idx, true);
        idx += 0x04;
        const nameHash = view.getUint32(idx, true);
        idx += 0x04;
        const nameOffs = view.getUint32(idx, true);
        const name = readString(buffer, nameOffs, -1, true);
        idx += 0x04;
        // Unk.
        idx += 0x04;

        const recordDataBuffer = dataBuffer.subarray(recordOffs, recordSize);
        const fileRecord: FileRecord = { name, nameHash, buffer: recordDataBuffer };
        fileRecords.push(fileRecord);
    }

    return { fileRecords };
}
