
// Zelda ARchive / Grezzo ARchive

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import * as CMB from './cmb';

const enum Magic {
    ZAR1 = 'ZAR\x01', // OoT3D
    GAR2 = 'GAR\x02', // MM3D
    GAR5 = 'GAR\x05', // LM3DS
}

export interface ZARFile {
    name: string;
    buffer: ArrayBufferSlice;
}

export interface ZAR {
    files: ZARFile[];
    version: CMB.Version;
}

export function findFile(zar: ZAR, filePath: string): ZARFile | null {
    const f = zar.files.find((file) => file.name.toLowerCase() === filePath.toLowerCase());
    if (f !== undefined)
        return f;
    else
        return null;
}

export function findFileData(zar: ZAR, filePath: string): ArrayBufferSlice | null {
    const file = findFile(zar, filePath);
    if (file !== null)
        return file.buffer;
    else
        return null;
}

function parseZelda(buffer: ArrayBufferSlice): ZAR {
    const view = buffer.createDataView();

    const magic: Magic = readString(buffer, 0x00, 0x04, false) as Magic;
    assert([Magic.ZAR1, Magic.GAR2].includes(magic));
    const version = magic == Magic.ZAR1 ? CMB.Version.Ocarina : CMB.Version.Majora;

    const size = view.getUint32(0x04, true);
    const numFileTypes = view.getUint16(0x08, true);
    const numFiles = view.getUint16(0x0A, true);
    const fileTypeTableOffs = view.getUint32(0x0C, true);
    const fileTableOffs = view.getUint32(0x10, true);
    const dataOffsTableOffs = view.getUint32(0x14, true);

    const codename = readString(buffer, 0x18, 0x08, true);
    assert(['queen', 'jenkins'].includes(codename));

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

    return { files, version };
}

function parseLM3DS(buffer: ArrayBufferSlice): ZAR {
    const view = buffer.createDataView();

    const magic: Magic = readString(buffer, 0x00, 0x04, false) as Magic;
    assert([Magic.GAR5].includes(magic));
    const version = CMB.Version.LuigisMansion;

    const size = view.getUint32(0x04, true);
    const numFileTypes = view.getUint16(0x08, true);
    const numFiles = view.getUint16(0x0A, true);
    const fileTypeTableOffs = view.getUint32(0x0C, true);
    const fileTableOffs = view.getUint32(0x10, true);
    const dataOffsStart = view.getUint32(0x14, true);

    const codename = readString(buffer, 0x18, 0x08, true);
    assert(['SYSTEM'].includes(codename));

    const files: ZARFile[] = [];

    let fileTypeTableIdx = fileTypeTableOffs;
    for (let i = 0; i < numFileTypes; i++) {
        const numFiles = view.getUint32(fileTypeTableIdx + 0x00, true);
        const flags = view.getUint32(fileTypeTableIdx + 0x04, true);
        const firstFile = view.getUint32(fileTypeTableIdx + 0x08, true);
        const fileExtensionOffs = view.getUint32(fileTypeTableIdx + 0x0C, true);
        const fileExtension = readString(buffer, fileExtensionOffs, 0x10, true);
        // Folder structure, p'haps?
        const unkBlockOffs = view.getUint32(fileTypeTableIdx + 0x10, true);
        // Rest appear to be 0.
        assert(view.getUint32(fileTypeTableIdx + 0x14, true) === 0x00);
        assert(view.getUint32(fileTypeTableIdx + 0x18, true) === 0x00);
        assert(view.getUint32(fileTypeTableIdx + 0x1C, true) === 0x00);
        fileTypeTableIdx += 0x20;

        // Parse out files.
        for (let j = 0; j < numFiles; j++) {
            const fileTableIdx = fileTableOffs + (firstFile + j) * 0x10;

            const fileSize = view.getUint32(fileTableIdx + 0x00, true);
            const fileDataOffs = view.getUint32(fileTableIdx + 0x04, true);
            const fileNameOffs = view.getUint32(fileTableIdx + 0x08, true);
            const fileNameWithoutExtension = readString(buffer, fileNameOffs, 0xFF, true);
            const fileName = `${fileNameWithoutExtension}.${fileExtension}`;

            const fileBuffer = buffer.subarray(fileDataOffs, fileSize);
            files.push({ name: fileName, buffer: fileBuffer });
        }
    }

    return { files, version };
}

export function parse(buffer: ArrayBufferSlice): ZAR {
    const magic: Magic = readString(buffer, 0x00, 0x04, false) as Magic;
    if ([Magic.ZAR1, Magic.GAR2].includes(magic))
        return parseZelda(buffer);
    else if ([Magic.GAR5].includes(magic))
        return parseLM3DS(buffer);
    else
        throw "whoops";
}
