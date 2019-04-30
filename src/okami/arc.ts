
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";

// Okami's simple packfile format

export interface FileEntry {
    filename: string;
    type: string;
    buffer: ArrayBufferSlice;
}

export interface Archive {
    files: FileEntry[];
}

export function parse(buffer: ArrayBufferSlice): Archive {
    const view = buffer.createDataView();
    const numEntries = view.getUint32(0x00);

    let entryTableIdx = 0x04;
    const files: FileEntry[] = [];
    for (let i = 0; i < numEntries; i++) {
        const fileDataOffs = view.getUint32(entryTableIdx + 0x00);

        let fileDataEnd: number;
        if (i < numEntries - 1)
            fileDataEnd = view.getUint32(entryTableIdx + 0x04);
        else
            fileDataEnd = buffer.byteLength;

        const fileType = readString(buffer, fileDataOffs - 0x18, 0x04, true);
        const filename = readString(buffer, fileDataOffs - 0x14, 0x14, true);
        const fileData = buffer.slice(fileDataOffs, fileDataEnd);
        files.push({ filename, type: fileType, buffer: fileData });

        entryTableIdx += 0x04;
    }
    return { files };
}
