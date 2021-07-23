import { mat4, quat, vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color } from "../Color";

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

    public readMat3(): mat4 {
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
}
