
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString, assert } from "../util.js";

// Dark Souls BND307D7R6 (Binder)
// https://github.com/JKAnderson/SoulsFormats/blob/master/SoulsFormats/Formats/BND3.cs

export interface BNDFile {
    name: string;
    data: ArrayBufferSlice;
}

export interface BND {
    files: BNDFile[];
}

export function parse(buffer: ArrayBufferSlice, dataBuffer: ArrayBufferSlice | null = null): BND {
    const view = buffer.createDataView();

    if (dataBuffer === null) {
        assert(readString(buffer, 0x00, 0x04, false) === 'BND3');
        dataBuffer = buffer;
    } else {
        assert(readString(buffer, 0x00, 0x04, false) === 'BHF3');
        assert(readString(dataBuffer, 0x00, 0x04, false) === 'BDF3');
    }

    if (dataBuffer === null)
        dataBuffer = buffer;

    const fileCount = view.getUint32(0x10, true);
    const fileHeadersEnd = view.getUint32(0x14, true);

    let fileTableIdx = 0x20;
    const files: BNDFile[] = [];
    for (let i = 0; i < fileCount; i++) {
        const flags = view.getUint8(fileTableIdx + 0x00);
        assert(flags === 0x40);

        const compressedSize = view.getUint32(fileTableIdx + 0x04, true);
        const fileDataOffs = view.getUint32(fileTableIdx + 0x08, true);
        const id = view.getUint32(fileTableIdx + 0x0C, true);
        const fileNameOffs = view.getUint32(fileTableIdx + 0x10, true);
        const uncompressedSize = view.getUint32(fileTableIdx + 0x14, true);

        const name = readString(buffer, fileNameOffs, -1, true);
        const data = dataBuffer.subarray(fileDataOffs, compressedSize);
        files.push({ name, data });

        fileTableIdx += 0x18;
    }

    return { files };
}
