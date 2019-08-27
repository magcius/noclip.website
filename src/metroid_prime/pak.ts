
// Implements Retro's PAK format as seen in Metroid Prime 1.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";
import { InputStream } from "./stream";

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

function parse_MP1(stream: InputStream): PAK {
    stream.assetIdLength = 4;
    assert(stream.readUint32() === 0);

    // Named resource table.
    interface NamedResourceTableEntry {
        fourCC: string;
        fileID: string;
        fileName: string;
    }

    const namedResourceTableEntries: NamedResourceTableEntry[] = [];

    const namedResourceTableCount = stream.readUint32();

    for (let i = 0; i < namedResourceTableCount; i++) {
        const fourCC = stream.readFourCC();
        const fileID = stream.readAssetID();
        const fileNameLength = stream.readUint32();
        const fileName = stream.readString(fileNameLength);
        namedResourceTableEntries.push({ fourCC, fileID, fileName });
    }

    const namedResourceTable = new Map<string, FileResource>();
    const resourceTable = new Map<string, FileResource>();

    // Regular resource table.
    const resourceTableCount = stream.readUint32();

    for (let i = 0; i < resourceTableCount; i++) {
        const isCompressed = !!stream.readUint32();
        const fourCC = stream.readFourCC();
        const fileID = stream.readAssetID();
        let fileSize = stream.readUint32();
        let fileOffset = stream.readUint32();

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

        const fileBuffer = stream.getBuffer().subarray(fileOffset, fileSize);

        const compressionMethod = isCompressed ? CompressionMethod.ZLIB : CompressionMethod.NONE;
        const fileResource: FileResource = { name, fourCC, fileID, fileSize, fileOffset, compressionMethod, buffer: fileBuffer };
        resourceTable.set(fileResource.fileID, fileResource);
        if (name !== null)
            namedResourceTable.set(fileResource.name, fileResource);
    }

    return { namedResourceTable, resourceTable };
}

function parse_MP3(stream: InputStream): PAK {
    stream.assetIdLength = 8;
    assert(stream.readUint32() === 64);

    const md5Hash = stream.readString(0x10, false);
    stream.align(64);

    const sectionCount = stream.readUint32();
    assert(sectionCount === 3);

    assert(stream.readFourCC() === 'STRG');
    const strgSize = stream.readUint32();
    assert(stream.readFourCC() === 'RSHD');
    const rshdSize = stream.readUint32();
    assert(stream.readFourCC() === 'DATA');
    const dataSize = stream.readUint32();
    stream.align(64);
    
    const namedResourceTableOffs = stream.tell();
    const resourceTableOffs = namedResourceTableOffs + strgSize;
    const dataOffs = resourceTableOffs + rshdSize;

    // Named resource table.
    stream.goTo(namedResourceTableOffs);

    interface NamedResourceTableEntry {
        fourCC: string;
        fileID: string;
        fileName: string;
    }

    const namedResourceTableEntries: NamedResourceTableEntry[] = [];
    const namedResourceTableCount = stream.readUint32();

    for (let i = 0; i < namedResourceTableCount; i++) {
        const fileName = stream.readString();
        const fourCC = stream.readFourCC();
        const fileID = stream.readAssetID();
        namedResourceTableEntries.push({ fourCC, fileID, fileName });
    }

    // Regular resource table.
    stream.goTo(resourceTableOffs);
    const resourceTableCount = stream.readUint32();

    const namedResourceTable = new Map<string, FileResource>();
    const resourceTable = new Map<string, FileResource>();

    for (let i = 0; i < resourceTableCount; i++) {
        const isCompressed = !!stream.readUint32();
        const fourCC = stream.readFourCC();
        const fileID = stream.readAssetID();
        const fileSize = stream.readUint32();
        const fileOffset = stream.readUint32() + dataOffs;

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

        const fileBuffer = stream.getBuffer().slice(fileOffset, fileOffset + fileSize);

        const compressionMethod = isCompressed ? CompressionMethod.CMPD_ZLIB : CompressionMethod.NONE;
        const fileResource: FileResource = { name, fourCC, fileID, fileSize, fileOffset, compressionMethod, buffer: fileBuffer };
        resourceTable.set(fileResource.fileID, fileResource);
        if (name !== null)
            namedResourceTable.set(fileResource.name, fileResource);
    }

    return { namedResourceTable, resourceTable };
}

export function parse(buffer: ArrayBufferSlice): PAK {
    const stream = new InputStream(buffer);
    const magic = stream.readUint32();

    // Metroid Prime 1/2.
    if (magic === 0x00030005)
        return parse_MP1(stream);

    // Metroid Prime 3/Donkey Kong Country Returns.
    if (magic === 0x00000002)
        return parse_MP3(stream);

    throw "whoops";
}
