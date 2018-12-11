
// Quick hack to make a zipfile from scratch.

import * as CRC32 from 'crc-32';

export interface ZipFileEntry {
    filename: string;
    data: ArrayBuffer;
}

function writeString(buf: ArrayBuffer, offs: number, v: string): void {
    const a = new Uint8Array(buf, offs);
    for (let i = 0; i < v.length; i++)
        a[i] = v.charCodeAt(i);
}

function combineArrayBuffers(bufs: ArrayBuffer[]): ArrayBuffer {
    let size = 0;
    for (let i = 0; i < bufs.length; i++)
        size += bufs[i].byteLength;
    const buf = new Uint8Array(size);
    let offs = 0;
    for (let i = 0; i < bufs.length; i++) {
        buf.set(new Uint8Array(bufs[i]), offs);
        offs += bufs[i].byteLength;
    }
    return buf.buffer;
}

function makeLocalFileHeader(fileEntry: ZipFileEntry, crc32: number): ArrayBuffer {
    const dataSize = fileEntry.data.byteLength;
    const filenameSize = fileEntry.filename.length;

    const buf = new ArrayBuffer(0x1E + filenameSize);
    const view = new DataView(buf);

    writeString(buf, 0x00, 'PK\x03\x04');
    view.setUint16(0x04, 0x14, true);
    // no flags, no compression, no mod time/date
    view.setUint32(0x0E, crc32, true);
    view.setUint32(0x12, dataSize, true);
    view.setUint32(0x16, dataSize, true);
    view.setUint16(0x1A, filenameSize, true);
    writeString(buf, 0x1E, fileEntry.filename);

    return buf;
}

function makeCentralDirectoryFileHeader(fileEntry: ZipFileEntry, crc32: number, localHeaderOffset: number): ArrayBuffer {
    const dataSize = fileEntry.data.byteLength;
    const filenameSize = fileEntry.filename.length;

    const buf = new ArrayBuffer(0x2E + filenameSize);
    const view = new DataView(buf);

    writeString(buf, 0x00, 'PK\x01\x02');
    view.setUint16(0x04, 0x0A17, true);
    view.setUint16(0x06, 0x14, true);
    view.setUint32(0x10, crc32, true);
    view.setUint32(0x14, dataSize, true);
    view.setUint32(0x18, dataSize, true);
    view.setUint16(0x1C, filenameSize, true);
    view.setUint32(0x2A, localHeaderOffset, true);
    writeString(buf, 0x2E, fileEntry.filename);

    return buf;
}

function makeCentralDirectoryEnd(numEntries: number, cdOffset: number, cdSize: number): ArrayBuffer {
    const buf = new ArrayBuffer(0x16);
    const view = new DataView(buf);

    writeString(buf, 0x00, 'PK\x05\x06');
    view.setUint16(0x08, numEntries, true);
    view.setUint16(0x0A, numEntries, true);
    view.setUint32(0x0C, cdSize, true);
    view.setUint32(0x10, cdOffset, true);
    return buf;
}

export function makeZipFile(entries: ZipFileEntry[]): ArrayBuffer {
    // Local file entries.
    const buffers: ArrayBuffer[] = [];
    const offsets: number[] = [];
    const crc32s: number[] = [];

    let localHeaderOffset = 0;
    for (let i = 0; i < entries.length; i++) {
        const fileEntry = entries[i];
        const crc32 = CRC32.buf(new Uint8Array(fileEntry.data));
        crc32s.push(crc32);

        offsets.push(localHeaderOffset);
        const localHeader = makeLocalFileHeader(fileEntry, crc32);
        buffers.push(localHeader);
        buffers.push(fileEntry.data);
        localHeaderOffset += localHeader.byteLength + fileEntry.data.byteLength;
    }

    const centralDirectoryOffset = localHeaderOffset;
    let centralDirectorySize = 0;
    for (let i = 0; i < entries.length; i++) {
        // Now make the central directory.
        const fileEntry = entries[i], offset = offsets[i], crc32 = crc32s[i];
        const cdHeader = makeCentralDirectoryFileHeader(fileEntry, crc32, offset);
        buffers.push(cdHeader);
        centralDirectorySize += cdHeader.byteLength;
    }

    // End of record
    buffers.push(makeCentralDirectoryEnd(entries.length, centralDirectoryOffset, centralDirectorySize));

    // Now combine buffers.
    return combineArrayBuffers(buffers);
}
