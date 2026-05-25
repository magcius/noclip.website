
// Reader for the modern Ragnarok Online data.grf (signature "Event Horizon",
// version 0x300). This is the same archive Gravity ships, with a custom magic
// string and a 4-byte-wider header layout to accommodate 4 GiB+ archives.
//
// Layout (deduced empirically; standard v0x200 with three changes):
//   header (46 bytes):
//     0x00..0x0E  signature (15 bytes, ignored)
//     0x0F..0x1D  padding/key (15 bytes, unused)
//     0x1E..0x25  fileTableOffset (u64 LE) -- was u32 + u32 reservedFiles
//     0x26..0x29  fileCountPre   (u32 LE)
//     0x2A..0x2D  version        (u32 LE, == 0x300)
//   file table header at HEADER_SIZE + fileTableOffset:
//     u32 _reserved (= 0; new in v0x300)
//     u32 packedSize
//     u32 realSize
//     packedSize bytes of zlib-deflated entries
//   each entry:
//     CP949 filename, null-terminated
//     u32 compressedSize
//     u32 lengthAligned
//     u32 realSize
//     u8  type
//     u64 offset (from end of header) -- was u32
//   file data at HEADER_SIZE + entry.offset:
//     lengthAligned bytes; zlib-deflate when realSize !== compressedSize.
//     The DES encryption modes (type bits 0x02 / 0x04) used in pre-v0x200
//     archives don't appear in this GRF; entries we've sampled are all type 0x01.

import { closeSync, openSync, readSync } from "fs";
import { inflateSync } from "zlib";

const HEADER_SIZE = 46;
const FILELIST_TYPE_FILE = 0x01;
const FILELIST_TYPE_ENCRYPT_MIXED = 0x02;
const FILELIST_TYPE_ENCRYPT_HEADER = 0x04;

export interface GrfEntry {
    compressedSize: number;
    lengthAligned: number;
    realSize: number;
    type: number;
    offset: number;
}

export class Grf {
    public readonly version: number;
    public readonly files: Map<string, GrfEntry> = new Map();
    private readonly fd: number;

    constructor(private readonly path: string) {
        this.fd = openSync(this.path, "r");

        const header = Buffer.alloc(HEADER_SIZE);
        readSync(this.fd, header, 0, HEADER_SIZE, 0);

        const fileTableOffset = Number(header.readBigUInt64LE(0x1E));
        const fileCountPre = header.readUInt32LE(0x26);
        this.version = header.readUInt32LE(0x2A);
        if (this.version !== 0x300)
            throw new Error(`${this.path}: only v0x300 supported, got 0x${this.version.toString(16)}`);

        const tableHeader = Buffer.alloc(12);
        readSync(this.fd, tableHeader, 0, 12, HEADER_SIZE + fileTableOffset);
        const packedSize = tableHeader.readUInt32LE(4);
        const realSize = tableHeader.readUInt32LE(8);

        const packed = Buffer.alloc(packedSize);
        readSync(this.fd, packed, 0, packedSize, HEADER_SIZE + fileTableOffset + 12);
        const raw = inflateSync(packed);
        if (raw.length !== realSize)
            throw new Error(`${this.path}: file table size mismatch (got ${raw.length}, expected ${realSize})`);

        const decoder = new TextDecoder("euc-kr");
        let p = 0;
        let parsed = 0;
        while (p < raw.length && parsed < fileCountPre) {
            const start = p;
            while (p < raw.length && raw[p] !== 0) p++;
            if (p + 1 + 17 > raw.length) break;
            const filename = decoder.decode(raw.slice(start, p)).toLowerCase();
            p++;
            const entry: GrfEntry = {
                compressedSize: raw.readUInt32LE(p),
                lengthAligned: raw.readUInt32LE(p + 4),
                realSize: raw.readUInt32LE(p + 8),
                type: raw[p + 12],
                offset: Number(raw.readBigUInt64LE(p + 13)),
            };
            p += 21;
            parsed++;
            if (entry.type & FILELIST_TYPE_FILE)
                this.files.set(filename, entry);
        }
    }

    public close(): void {
        closeSync(this.fd);
    }

    public read(filename: string): Buffer | null {
        const entry = this.files.get(filename.toLowerCase());
        if (entry === undefined) return null;
        if (entry.type & (FILELIST_TYPE_ENCRYPT_MIXED | FILELIST_TYPE_ENCRYPT_HEADER))
            throw new Error(`${filename}: DES-encrypted entries not implemented (type=0x${entry.type.toString(16)})`);
        const buf = Buffer.alloc(entry.lengthAligned);
        readSync(this.fd, buf, 0, entry.lengthAligned, HEADER_SIZE + entry.offset);
        if (entry.realSize === entry.compressedSize)
            return buf.subarray(0, entry.realSize);
        return inflateSync(buf.subarray(0, entry.compressedSize));
    }
}
