
// Nintendo SARC archive format.

import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

export interface SARCFile {
    name: string;
    offset: number;
    buffer: ArrayBufferSlice;
}

export interface SARC {
    buffer: ArrayBufferSlice;
    files: SARCFile[];
}

export function parse(buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'SARC');

    let littleEndian;
    switch (view.getUint16(0x06, false)) {
    case 0xFEFF:
        littleEndian = false;
        break;
    case 0xFFFE:
        littleEndian = true;
        break;
    default:
        throw new Error("Invalid BOM");
    }

    assert(view.getUint16(0x04, littleEndian) === 0x14); // Header length.

    const dataOffset = view.getUint32(0x0C, littleEndian);

    const version = view.getUint16(0x10, littleEndian);
    assert(version === 0x100);

    assert(readString(buffer, 0x14, 0x04) === 'SFAT');
    assert(view.getUint16(0x18, littleEndian) === 0x0C);
    const fileCount = view.getUint16(0x1A, littleEndian);

    const sfntTableOffs = 0x20 + 0x10 * fileCount;
    assert(readString(buffer, sfntTableOffs, 0x04) === 'SFNT');
    assert(view.getUint16(sfntTableOffs + 0x04, littleEndian) === 0x08);
    const sfntStringTableOffs = sfntTableOffs + 0x08;

    const files: SARCFile[] = [];
    let fileTableIdx = 0x20;
    for (let i = 0; i < fileCount; i++) {
        const nameHash = view.getUint32(fileTableIdx + 0x00, littleEndian);
        const flags = view.getUint32(fileTableIdx + 0x04, littleEndian);
        let name;
        if (!!(flags >>> 24)) {
            const nameOffs = ((flags & 0x00FFFFFF) * 4);
            name = readString(buffer, sfntStringTableOffs + nameOffs, 0xFF);
        } else {
            name = nameHash.toString(16);
        }
        const fileStart = view.getUint32(fileTableIdx + 0x08, littleEndian);
        const fileEnd = view.getUint32(fileTableIdx + 0x0C, littleEndian);
        const startOffs = dataOffset + fileStart;
        const endOffs = dataOffset + fileEnd;
        files.push({ name, offset: startOffs, buffer: buffer.slice(startOffs, endOffs) });
        fileTableIdx += 0x10;
    }

    return { buffer, files };
}
