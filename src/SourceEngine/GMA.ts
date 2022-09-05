
// Garry's Mod ADdon
// https://github.com/Facepunch/gmad/blob/master/include/AddonReader.h

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";

class Stream {
    private offset: number = 0;
    private view: DataView;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public tell(): number {
        return this.offset;
    }

    public readUint8(): number {
        return this.view.getUint8(this.offset++);
    }

    public readUint32(): number {
        return this.view.getUint32(this.offset, (this.offset += 4, true));
    }

    public readUint64(): bigint {
        return this.view.getBigUint64(this.offset, (this.offset += 8, true));
    }

    public readFloat32(): number {
        return this.view.getFloat32(this.offset, (this.offset += 4, true));
    }

    public readByteString(n: number): string {
        return readString(this.buffer, this.offset, (this.offset += n, n));
    }

    public readString(): string {
        const string = readString(this.buffer, this.offset, undefined, true);
        this.offset += string.length + 1;
        return string;
    }
}

interface GMAFile {
    fileID: number;
    filename: string;
    data: ArrayBufferSlice;
}

export class GMA {
    public name: string;
    public desc: any;
    public author: string;

    public files: GMAFile[] = [];

    constructor(private buffer: ArrayBufferSlice) {
        const stream = new Stream(buffer);
        assert(stream.readByteString(4) === 'GMAD');
        const formatVersion = stream.readUint8();
        assert(formatVersion === 0x03);

        const steamID = stream.readUint64();
        const timestamp = stream.readUint64();

        const requiredContents: string[] = [];
        if (formatVersion > 0x01) {
            while (true) {
                const str = stream.readString();
                if (!str.length)
                    break;
                requiredContents.push(str);
            }
        }

        this.name = stream.readString();
        this.desc = JSON.parse(stream.readString());
        this.author = stream.readString();
        const addonVersion = stream.readUint32();

        interface GMAFileEntry {
            fileID: number;
            filename: string;
            offset: bigint;
            fileSize: bigint;
        }

        const entries: GMAFileEntry[] = [];

        let fileID = 1;
        let fileOffset = BigInt(0);
        while (true) {
            const sentinel = stream.readUint32();
            if (sentinel === 0)
                break;

            const filename = stream.readString();
            const fileSize = stream.readUint64();
            const crc = stream.readUint32();
            entries.push({ fileID, filename, offset: fileOffset, fileSize });
            fileOffset += fileSize;
            fileID++;
        }

        let dataOffset = BigInt(stream.tell());

        this.files = entries.map((entry) => {
            const { fileID, filename, offset, fileSize } = entry;
            const fileOffset = dataOffset + offset;
            assert(fileOffset <= BigInt(0xFFFFFFFF) && fileSize <= BigInt(0xFFFFFFFF));
            const data = this.buffer.subarray(Number(fileOffset), Number(fileSize));
            return { fileID, filename, data };
        });
    }
}
