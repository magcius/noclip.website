
// Zelda ARchive

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

const enum Magic {
    ZAR1 = 'ZAR\x01',
    GAR2 = 'GAR\x02',
}

export interface ZARFile {
    name: string;
    buffer: ArrayBufferSlice;
}

export interface ZAR {
    files: ZARFile[];
}

export function findFile(zar: ZAR, filePath: string): ZARFile | null {
    const f = zar.files.find((file) => file.name.toLowerCase() === filePath.toLowerCase());
    if (f !== undefined)
        return f;
    else
        return null;
}

export function parse(buffer: ArrayBufferSlice): ZAR {
    const view = buffer.createDataView();

    const magic: Magic = readString(buffer, 0x00, 0x04, false) as Magic;
    assert([Magic.ZAR1, Magic.GAR2].includes(magic));

    const size = view.getUint32(0x04, true);
    const numFileTypes = view.getUint16(0x08, true);
    const numFiles = view.getUint16(0x0A, true);
    const fileTypeTableOffs = view.getUint32(0x0C, true);
    const fileTableOffs = view.getUint32(0x10, true);
    const dataOffsTableOffs = view.getUint32(0x14, true);

    const codename = readString(buffer, 0x18, 0x08, false);
    assert(['queen\0\0\0', 'jenkins\0'].includes(codename));

    const files: ZARFile[] = [];

    let fileTableIdx = fileTableOffs;
    let dataOffsTableIdx = dataOffsTableOffs;
    for (let i = 0; i < numFiles; i++) {
        const fileSize = view.getUint32(fileTableIdx + 0x00, true);
        const filePathOffs = view.getUint32(fileTableIdx + (magic === Magic.GAR2 ? 0x08 : 0x04), true);
        const filePath = readString(buffer, filePathOffs, 0xFF, true);
        const fileDataOffs = view.getUint32(dataOffsTableIdx + 0x00, true);

        const fileBuffer = buffer.subarray(fileDataOffs, fileSize);
        files.push({ name: filePath, buffer: fileBuffer });

        fileTableIdx += (magic === Magic.GAR2 ? 0x0C : 0x08);
        dataOffsTableIdx += 0x04;
    }

    return { files };
}
