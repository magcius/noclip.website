
// Implements Retro's PAK format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

export interface FileResource {
    name: string;
    fourCC: string;
    fileID: string;
    fileSize: number;
    fileOffset: number;
    isCompressed: boolean;
    decompressedSize: number;
    buffer: ArrayBufferSlice;
}

export interface PAK {
    namedResourceTable: Map<string, FileResource>;
    resourceTable: Map<string, FileResource>;
}

export function parse(buffer: ArrayBufferSlice): PAK {
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

        let decompressedSize = fileSize;
        if (isCompressed) {
            decompressedSize = view.getUint32(fileOffset);
            fileOffset += 0x04;
            fileSize -= 0x04;
        }

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

        const fileResource: FileResource = { name, fourCC, fileID, fileSize, fileOffset, isCompressed, decompressedSize, buffer: fileBuffer };
        resourceTable.set(fileResource.fileID, fileResource);
        if (name !== null)
            namedResourceTable.set(fileResource.name, fileResource);
    }

    return { namedResourceTable, resourceTable };
}
