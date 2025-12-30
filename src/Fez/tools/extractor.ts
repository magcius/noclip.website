
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import * as BYML from "../../byml.js";
import * as Yaz0 from '../../Common/Compression/Yaz0.js';
import * as JKRArchive from "../../Common/JSYSTEM/JKRArchive.js";
import { openSync, readSync, closeSync, readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync } from "fs";
import { assertExists, hexzero, assert, readString } from "../../util.js";
import { Endianness } from "../../endian.js";
import { loadRustLib } from "../../rustlib.js";
import path from "path";

// Standalone tool designed for node to extract data.

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
}

const pathBaseIn  = `../../../data/Fez_raw`;
const pathBaseOut = `../../../data/Fez`;

export class ContentReader {
    public Position = 0;
    private view: DataView;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public ReadBytes(byteLength: number): ArrayBufferSlice {
        const v = this.buffer.subarray(this.Position, byteLength);
        this.Position += byteLength;
        return v;
    }

    public ReadByte(): number {
        return this.view.getUint8(this.Position++);
    }

    public ReadInt32(): number {
        const v = this.view.getInt32(this.Position, true);
        this.Position += 0x04;
        return v;
    }

    public Read7BitEncodedInt(): number {
        let v = 0;
        for (let i = 0; i < 5; i++) {
            const b = this.ReadByte();
            v |= (b & 0x7F) << (i * 7);
            if (!(b & 0x80))
                break;
        }
        return v;
    }

    public ReadString(): string {
        const size = this.Read7BitEncodedInt();
        const str = readString(this.buffer, this.Position, size);
        this.Position += size;
        return str;
    }
}

function extractPak(pakname: string): void {
    const buffer = fetchDataSync(pakname);
    const reader = new ContentReader(buffer);
    const numFiles = reader.ReadInt32();
    for (let i = 0; i < numFiles; i++) {
        const filename = reader.ReadString();
        const size = reader.ReadInt32();
        const data = reader.ReadBytes(size);
        const dstPath = `${pathBaseOut}/xnb/${filename}.xnb`;
        mkdirSync(path.dirname(dstPath), { recursive: true });
        writeFileSync(dstPath, Buffer.from(data.copyToBuffer()));
        console.log(`Extracted ${filename}.xnb`);
    }
}

async function main() {
    extractPak(`${pathBaseIn}/Essentials.pak`);
    extractPak(`${pathBaseIn}/Other.pak`);
    extractPak(`${pathBaseIn}/Updates.pak`);
}

main();
