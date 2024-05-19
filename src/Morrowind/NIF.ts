
import { mat3, mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, nArray, readString } from "../util.js";
import { str } from "crc-32/*";

class Stream {
    private offset: number = 0;
    private view: DataView;

    public version: number;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public readUint8(): number {
        return this.view.getUint8(this.offset++);
    }

    public readBool(): boolean {
        return !!this.readUint32();
    }

    public readUint16(): number {
        return this.view.getUint16(this.offset, (this.offset += 2, true));
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

    public readString(): string {
        const num = this.readUint32();
        return readString(this.buffer, this.offset, (this.offset += num, num));
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
}

function version(a: number, b: number, c: number, d: number) {
    return a << 24 | b << 16 | c << 8 | d;
}

interface NiParse {
    parse(stream: Stream): void;
}

// https://github.com/niftools/nifxml/blob/master/nif.xml
class NiObjectNET {
    public name: string;

    public parse(stream: Stream): void {
        this.name = stream.readString();
        const extraDataPtr = stream.readUint32();
        const timeController = stream.readUint32();
    }
}

class RecordRef<T> {
    public index: number = -1;

    public parse(stream: Stream): void {
        this.index = stream.readUint32();
    }

    public get(nif: NIF): T | null {
        return nif.records[this.index] as T;
    }
}

class NiAVObject extends NiObjectNET {
    public flags: number;
    public translation = vec3.create();
    public rotation = mat3.create();
    public scale = 1.0;
    public properties: RecordRef<NiParse>[] = [];

    public override parse(stream: Stream): void {
        super.parse(stream);

        const flags = stream.readUint16();
        stream.readVector3(this.translation);
        stream.readMatrix33(this.rotation);
        this.scale = stream.readFloat32();
        stream.readVector3(vec3.create()); // velocity

        const numProperties = stream.readUint32();
        this.properties = nArray(numProperties, () => new RecordRef<NiParse>());
        for (let i = 0; i < numProperties; i++)
            this.properties[i].parse(stream);

        const hasBounds = stream.readBool();
        assert(!hasBounds);
    }
}

class NiGeometryData {}
class NiSkinData {}

class NiGeometry extends NiAVObject {
    public data = new RecordRef<NiGeometryData>();
    public skin = new RecordRef<NiSkinData>();

    public override parse(stream: Stream): void {
        super.parse(stream);
        this.data.parse(stream);
        this.skin.parse(stream);
    }
}

class NiTriShape extends NiGeometry {
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
            const type = stream.readString();
            const record = this.newRecord(type);
            record.parse(stream);
            this.records.push(record);
        }
    }

    private newRecord(type: string): NiParse {
        if (type === 'NiTriShape')
            return new NiTriShape();
        else
            throw "whoops";
    }
}
