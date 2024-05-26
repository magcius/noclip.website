
import { mat3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";
import { NIFParse } from "./NIFParse.js";
import { Color } from "../Color.js";

export class Stream {
    private offset: number = 0;
    private view: DataView;

    public version: number;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public readBool(): boolean {
        return !!this.readUint32();
    }

    public readUint8(): number {
        return this.view.getUint8(this.offset++);
    }

    public readUint16(): number {
        return this.view.getUint16(this.offset, (this.offset += 2, true));
    }

    public readInt16(): number {
        return this.view.getInt16(this.offset, (this.offset += 2, true));
    }

    public readUint32(): number {
        return this.view.getUint32(this.offset, (this.offset += 4, true));
    }

    public readFloat32(): number {
        return this.view.getFloat32(this.offset, (this.offset += 4, true));
    }

    public readBytes(n: number): ArrayBufferSlice {
        return this.buffer.subarray(this.offset, (this.offset += n, n));
    }

    public readSizedString(): string {
        const num = this.readUint32();
        return readString(this.buffer, this.offset, (this.offset += num, num));
    }

    public readString(): string {
        return this.readSizedString();
    }

    public readLine(max = 0x100): string {
        const buf = this.buffer.createTypedArray(Uint8Array, this.offset);
        let S = '';
        for (let i = 0; i < max; i++) {
            const ch = buf[i];
            this.offset++;
            if (ch === 0x0A)
                break;
            S += String.fromCharCode(ch);
        }
        return S;
    }

    public readVector3(dst: vec3): void {
        vec3.set(dst, this.readFloat32(), this.readFloat32(), this.readFloat32());
    }

    public readMatrix33(dst: mat3): void {
        mat3.set(dst,
            this.readFloat32(), this.readFloat32(), this.readFloat32(),
            this.readFloat32(), this.readFloat32(), this.readFloat32(),
            this.readFloat32(), this.readFloat32(), this.readFloat32(),
        );
    }

    public readColor(dst: Color): void {
        dst.r = this.readFloat32();
        dst.g = this.readFloat32();
        dst.b = this.readFloat32();
        dst.a = this.readFloat32();
    }
}

export interface NiParse {
    parse(stream: Stream): void;
}

export class RecordRef<T> {
    public index: number = -1;

    public parse(stream: Stream): void {
        this.index = stream.readUint32();
    }

    public get(nif: NIF): T | null {
        return nif.records[this.index] as T;
    }
}

export class NIF {
    public records: NiParse[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const stream = new Stream(buffer);

        const versionString = stream.readLine();
        assert(versionString === 'NetImmerse File Format, Version 4.0.0.2');
    
        const version = stream.readUint32();
        assert(version === 0x04000002);
        stream.version = version;
    
        const numRecords = stream.readUint32();
        for (let i = 0; i < numRecords; i++) {
            const type = stream.readSizedString();
            const record = NIFParse.newRecord(type);
            record.parse(stream);
            this.records.push(record);
        }
    }
}
