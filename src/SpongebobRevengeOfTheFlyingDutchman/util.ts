import { mat3, mat4, quat, vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color } from "../Color";

export const SIZE_F32 = 4;
export const SIZE_VEC3 = 12;
export const SIZE_VEC2 = 8;

export class DataStream {
    public view: DataView;

    constructor(
        public buffer: ArrayBufferSlice,
        public offs: number = 0,
        public littleEndian: boolean = false,
    ) { 
        this.view = buffer.createDataView();
    }

    public readInt8(): number {
        return this.view.getInt8(this.offs++);
    }

    public readInt16(): number {
        const v = this.view.getInt16(this.offs, this.littleEndian);
        this.offs += 0x02;
        return v;
    }

    public readInt32(): number {
        const v = this.view.getInt32(this.offs, this.littleEndian);
        this.offs += 0x04;
        return v;
    }

    public readUint8(): number {
        return this.view.getUint8(this.offs++);
    }

    public readUint16(): number { 
        const v = this.view.getUint16(this.offs, this.littleEndian); 
        this.offs += 0x02; 
        return v; 
    }

    public readUint32(): number {
        const v = this.view.getUint32(this.offs, this.littleEndian);
        this.offs += 0x04;
        return v;
    }

    public readFloat32(): number {
        const v = this.view.getFloat32(this.offs, this.littleEndian);
        this.offs += 0x04;
        return v;
    }

    public readMat4(): mat4 {
        return new Float32Array(this.readArrayStatic(this.readFloat32, 16));
    }

    public readMat3(): mat3 {
        return new Float32Array(this.readArrayStatic(this.readFloat32, 9));
    }

    public readVec2(): vec2 {
        return new Float32Array(this.readArrayStatic(this.readFloat32, 2));
    }

    public readVec3(): vec3 {
        return new Float32Array(this.readArrayStatic(this.readFloat32, 3));
    }

    public readQuat(): quat {
        return new Float32Array(this.readArrayStatic(this.readFloat32, 4));
    }

    public readRGB(): Color {
        return {
            r: this.readFloat32(),
            g: this.readFloat32(),
            b: this.readFloat32(),
            a: 0,
        }
    }

    public readRGBA(): Color {
        return {
            r: this.readFloat32(),
            g: this.readFloat32(),
            b: this.readFloat32(),
            a: this.readFloat32(),
        }
    }

    public readArrayStatic<T>(func: ((this: this) => T) | ((arg: DataStream) => T), num: number): T[] {
        const realFunc = func.bind(this, this);
        let ret: T[] = [];
        for (let i = 0; i < num; i++) {
            ret.push(realFunc());
        }
        return ret;
    }

    public readArrayDynamic<T>(
        readSize: ((this: this) => number) | ((arg: DataStream) => number),
        readData: ((this: this) => T) | ((arg: DataStream) => T),
    ) {
        const realReadSize = readSize.bind(this, this);
        const size = realReadSize();
        const realReadData = readData.bind(this, this);
        let ret: T[] = [];
        for (let i = 0; i < size; i++) {
            ret.push(realReadData());
        }
        return ret;
    }

    public readBuffer(size: number, elementSize: number) {
        return this.readSlice(size * elementSize);
    }

    public readFloat32Array(size: number) {
        const buffer = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            buffer[i] = this.readFloat32();
        }
        return buffer;
    }

    public readJunk(size: number): void {
        this.offs += size;
    }

    public skip(size: number) {
        this.offs += size;
    }

    public readSlice(size: number): ArrayBufferSlice {
        const v = this.buffer.subarray(this.offs, size);
        this.offs += size;
        return v;
    }

    public readSliceDynamic(
        readSize: ((this: this) => number) | ((arg: DataStream) => number)
    ): ArrayBufferSlice {
        const realReadSize = readSize.bind(this, this);
        const size = realReadSize();
        const v = this.buffer.subarray(this.offs, size);
        this.offs += size;
        return v;
    }

    public readOptional<T>(
        read: ((this: this) => T) | ((arg: DataStream) => T)
    ): T | undefined {
        const value = this.readUint8();
        if (value !== 0) {
            const realRead = read.bind(this, this);
            return realRead();
        }
        else {
            return undefined;
        }
    }
}

export function readTHeader(data: DataStream) {
    return {
        floats_unk: data.readArrayStatic(data.readFloat32, 4),
        transform: data.readMat4(),
        junk: data.readJunk(16),
        type: data.readUint16(),
        flags: data.readUint16(),
    }
}

export type THeader = ReturnType<typeof readTHeader>;