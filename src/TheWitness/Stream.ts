import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";
import { colorNewFromRGBA, Color } from "../Color";
import { vec2, vec3, quat, vec4 } from "gl-matrix";

export class Stream {
    private offset: number = 0;
    private view: DataView;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public readUint8(): number {
        return this.view.getUint8(this.offset++);
    }

    public readUint16(): number {
        return this.view.getUint16(this.offset, (this.offset += 2, true));
    }

    public readUint32(): number {
        return this.view.getUint32(this.offset, (this.offset += 4, true));
    }

    public readValue(max: number): number {
        if (max <= 0x100)
            return this.readUint8();
        else
            return this.readUint32();
    }

    public readFloat32(): number {
        return this.view.getFloat32(this.offset, (this.offset += 4, true));
    }

    public readByteString(n: number): string {
        return readString(this.buffer, this.offset, (this.offset += n, n));
    }

    public readBytes(n: number): ArrayBufferSlice {
        return this.buffer.subarray(this.offset, (this.offset += n, n));
    }

    public readPString(): string | null {
        const count = this.readUint32();
        if (count > 0) {
            const string = readString(this.buffer, this.offset, count - 1, false);
            this.offset += count - 1;
            return string;
        } else {
            return null;
        }
    }

    public readString(): string {
        const string = readString(this.buffer, this.offset, undefined, true);
        this.offset += string.length + 1;
        return string;
    }

    public readStringNull(): string | null {
        if (this.readValue(2) === 0)
            return null;
        return this.readString();
    }
}

export function Stream_read_Color(stream: Stream): Color {
    return colorNewFromRGBA(stream.readFloat32(), stream.readFloat32(), stream.readFloat32(), stream.readFloat32());
}

export function Stream_read_Vector2(stream: Stream): vec2 {
    return vec2.fromValues(stream.readFloat32(), stream.readFloat32());
}

export function Stream_read_Vector3(stream: Stream): vec3 {
    return vec3.fromValues(stream.readFloat32(), stream.readFloat32(), stream.readFloat32());
}

export function Stream_read_Vector4(stream: Stream): vec4 {
    return vec4.fromValues(stream.readFloat32(), stream.readFloat32(), stream.readFloat32(), stream.readFloat32());
}

export function Stream_read_Quaternion(stream: Stream): quat {
    return quat.fromValues(stream.readFloat32(), stream.readFloat32(), stream.readFloat32(), stream.readFloat32());
}

export function Stream_read_Array_float(stream: Stream): number[] {
    const count = stream.readUint32();
    const L: number[] = [];
    for (let i = 0; i < count; i++)
        L.push(stream.readFloat32());
    return L;
}

export function Stream_read_Array_int(stream: Stream): number[] {
    const count = stream.readUint32();
    const L: number[] = [];
    for (let i = 0; i < count; i++)
        L.push(stream.readUint32() | 0);
    return L;
}
