
// Zelda ARchive

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

export interface ZARFile {
    name: string;
    buffer: ArrayBufferSlice;
}

export interface ZAR {
    files: ZARFile[];
}

export function parse(buffer: ArrayBufferSlice): ZAR {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'ZAR\x01');

    const size = view.getUint32(0x04, true);
    const numFileTypes = view.getUint16(0x08, true);
    const numFiles = view.getUint16(0x0A, true);
    const fileTypeTableOffs = view.getUint32(0x0C, true);
    const fileTableOffs = view.getUint32(0x10, true);
    const dataOffsTableOffs = view.getUint32(0x14, true);

    assert(readString(buffer, 0x18, 0x08, false) === 'queen\0\0\0');

    const files: ZARFile[] = [];

    let fileTableIdx = fileTableOffs;
    let dataOffsTableIdx = dataOffsTableOffs;
    for (let i = 0; i < numFiles; i++) {
        const fileSize = view.getUint32(fileTableIdx + 0x00, true);
        const fileNameOffs = view.getUint32(fileTableIdx + 0x04, true);
        const fileName = readString(buffer, fileNameOffs, 0xFF, true);
        const fileDataOffs = view.getUint32(dataOffsTableIdx + 0x00, true);

        const fileBuffer = buffer.subarray(fileDataOffs, fileSize);
        files.push({ name: fileName, buffer: fileBuffer });

        fileTableIdx += 0x08;
        dataOffsTableIdx += 0x04;
    }

    return { files };
}
