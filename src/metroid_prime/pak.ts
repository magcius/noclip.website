
// Implements Retro's PAK format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";

export const enum CompressionMethod {
    NONE,
    ZLIB,
    CMPD_ZLIB,
}

export interface FileResource {
    name: string;
    fourCC: string;
    fileID: string;
    fileSize: number;
    fileOffset: number;
    compressionMethod: CompressionMethod;
    buffer: ArrayBufferSlice;
}

export interface PAK {
    namedResourceTable: Map<string, FileResource>;
    resourceTable: Map<string, FileResource>;
}

function parse_MP1(buffer: ArrayBufferSlice): PAK {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x00030005);

    // Named resource table.
    let offs = 0x08;

    interface NamedResourceTableEntry {
        fourCC: string;
        fileID: string;
        fileName: string;
    }

    const namedResourceTableEntries: NamedResourceTableEntry[] = [];

    const namedResourceTableCount = view.getUint32(offs);
    offs += 0x04;
    for (let i = 0; i < namedResourceTableCount; i++) {
        const fourCC = readString(buffer, offs + 0x00, 4, false);
        const fileID = readString(buffer, offs + 0x04, 4, false);
        const fileNameLength = view.getUint32(offs + 0x08);
        const fileName = readString(buffer, offs + 0x0C, fileNameLength, false);
        namedResourceTableEntries.push({ fourCC, fileID, fileName });
        offs += 0x0C + fileNameLength;
    }

    const namedResourceTable = new Map<string, FileResource>();
    const resourceTable = new Map<string, FileResource>();

    // Regular resource table.
    const resourceTableCount = view.getUint32(offs + 0x00);

    offs += 0x04;
    for (let i = 0; i < resourceTableCount; i++) {
        const isCompressed = !!view.getUint32(offs + 0x00);
        const fourCC = readString(buffer, offs + 0x04, 4, false);
        const fileID = readString(buffer, offs + 0x08, 4, false);
        let fileSize = view.getUint32(offs + 0x0C);
        let fileOffset = view.getUint32(offs + 0x10);

        offs += 0x14;

        if (resourceTable.has(fileID)) {
            const existingResource = resourceTable.get(fileID);
            // Skip files that are apparently the same.
            assert(fourCC === existingResource.fourCC);
            assert(fileSize === existingResource.fileSize);
            continue;
        }

        // Check for a named resource.
        let name = null;
        const namedResourceTableEntry = namedResourceTableEntries.find((nr) => nr.fileID === fileID);
        if (namedResourceTableEntry) {
            name = namedResourceTableEntry.fileName;
            assert(namedResourceTableEntry.fourCC === fourCC);
        }

        const fileBuffer = buffer.subarray(fileOffset, fileSize);

        const compressionMethod = isCompressed ? CompressionMethod.ZLIB : CompressionMethod.NONE;
        const fileResource: FileResource = { name, fourCC, fileID, fileSize, fileOffset, compressionMethod, buffer: fileBuffer };
        resourceTable.set(fileResource.fileID, fileResource);
        if (name !== null)
            namedResourceTable.set(fileResource.name, fileResource);
    }

    return { namedResourceTable, resourceTable };
}

function parse_DKCR(buffer: ArrayBufferSlice): PAK {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x00000002);

    const headerSize = view.getUint32(0x04);
    const md5Hash = readString(buffer, 0x08, 0x10, false);

    const sectionCount = view.getUint32(0x40);
    assert(sectionCount === 3);

    assert(readString(buffer, 0x44, 0x04, false) === 'STRG');
    const strgSize = view.getUint32(0x48);
    assert(readString(buffer, 0x4C, 0x04, false) === 'RSHD');
    const rshdSize = view.getUint32(0x50);
    assert(readString(buffer, 0x54, 0x04, false) === 'DATA');
    const dataSize = view.getUint32(0x58);

    interface NamedResourceTableEntry {
        fourCC: string;
        fileID: string;
        fileName: string;
    }

    const namedResourceTableEntries: NamedResourceTableEntry[] = [];

    const namedResourceTableOffs = 0x80;
    let namedResourceTableIdx = namedResourceTableOffs;
    const namedResourceTableCount = view.getUint32(namedResourceTableIdx + 0x00);
    namedResourceTableIdx += 0x04;
    for (let i = 0; i < namedResourceTableCount; i++) {
        const fileName = readString(buffer, namedResourceTableIdx + 0x00, -1, true);
        const fileNameLength = fileName.length + 1;
        namedResourceTableIdx += fileNameLength;
        const fourCC = readString(buffer, namedResourceTableIdx + 0x00, 4, false);
        const fileID = readString(buffer, namedResourceTableIdx + 0x04, 8, false);
        namedResourceTableEntries.push({ fourCC, fileID, fileName });
        namedResourceTableIdx += 0x0C;
    }

    const resourceTableOffs = align(namedResourceTableIdx, 0x40);
    let resourceTableIdx = resourceTableOffs;
    assert((resourceTableOffs - namedResourceTableOffs) === strgSize);
    const dataOffs = resourceTableOffs + rshdSize;

    // Regular resource table.
    const resourceTableCount = view.getUint32(resourceTableIdx + 0x00);
    resourceTableIdx += 0x04;

    const namedResourceTable = new Map<string, FileResource>();
    const resourceTable = new Map<string, FileResource>();

    for (let i = 0; i < resourceTableCount; i++) {
        const isCompressed = !!view.getUint32(resourceTableIdx + 0x00);
        const fourCC = readString(buffer, resourceTableIdx + 0x04, 4, false);
        const fileID = readString(buffer, resourceTableIdx + 0x08, 8, false);
        const fileSize = view.getUint32(resourceTableIdx + 0x10);
        const fileOffset = dataOffs + view.getUint32(resourceTableIdx + 0x14);

        resourceTableIdx += 0x18;

        if (resourceTable.has(fileID)) {
            const existingResource = resourceTable.get(fileID);
            // Skip files that are apparently the same.
            assert(fourCC === existingResource.fourCC);
            assert(fileSize === existingResource.fileSize);
            continue;
        }

        // Check for a named resource.
        let name = null;
        const namedResourceTableEntry = namedResourceTableEntries.find((nr) => nr.fileID === fileID);
        if (namedResourceTableEntry) {
            name = namedResourceTableEntry.fileName;
            assert(namedResourceTableEntry.fourCC === fourCC);
        }

        const fileBuffer = buffer.slice(fileOffset, fileOffset + fileSize);

        const compressionMethod = isCompressed ? CompressionMethod.CMPD_ZLIB : CompressionMethod.NONE;
        const fileResource: FileResource = { name, fourCC, fileID, fileSize, fileOffset, compressionMethod, buffer: fileBuffer };
        resourceTable.set(fileResource.fileID, fileResource);
        if (name !== null)
            namedResourceTable.set(fileResource.name, fileResource);
    }

    return { namedResourceTable, resourceTable };
}

export function parse(buffer: ArrayBufferSlice): PAK {
    const view = buffer.createDataView();

    const magic = view.getUint32(0x00);

    // Metroid Prime 1.
    if (magic === 0x00030005)
        return parse_MP1(buffer);

    // Donkey Kong Country Returns.
    if (magic === 0x00000002)
        return parse_DKCR(buffer);

    throw "whoops";
}
