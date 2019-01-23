
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

export interface FileRecord {
    nameHash: number;
    byteOffset: number;
    byteSize: number;
}

export interface BHD5 {
    fileRecords: FileRecord[];
}

export function parse(buffer: ArrayBufferSlice): BHD5 {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) == 'BHD5');
    assert(view.getUint32(0x04, true) == 0x000000FF);
    assert(view.getUint32(0x08, true) == 0x00000001);

    const unk1 = view.getUint32(0x0C, true); // Seems related to fize size?
    const groupTableCount  = view.getUint32(0x10, true);
    const groupTableOffset = view.getUint32(0x14, true);

    const fileRecords: FileRecord[] = [];

    // XXX(jstpierre): Seems the file is divided up into a number of groups?
    // This is probably for some DVD balancing nonsense.
    let groupTableIdx = groupTableOffset;
    for (let i = 0; i < groupTableCount; i++) {
        const recordTableCount = view.getUint32(groupTableIdx, true);
        groupTableIdx += 0x04;
        const recordTableOffs = view.getUint32(groupTableIdx, true);
        groupTableIdx += 0x04;

        // Now iterate through each record in the group and add it to
        // a table...
        let recordTableIdx = recordTableOffs;
        for (let j = 0; j < recordTableCount; j++) {
            const nameHash = view.getUint32(recordTableIdx, true);
            recordTableIdx += 0x04;
            const byteSize = view.getUint32(recordTableIdx, true);
            recordTableIdx += 0x04;
            const byteOffset = view.getUint32(recordTableIdx, true);
            recordTableIdx += 0x04;
            assert (view.getUint32(recordTableIdx, true) == 0x00000000);
            recordTableIdx += 0x04;

            const fileRecord: FileRecord = { nameHash, byteOffset, byteSize };
            fileRecords.push(fileRecord);
        }
    }

    return { fileRecords };
}
