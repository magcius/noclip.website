import ArrayBufferSlice from '../ArrayBufferSlice';
import { ViewerRenderInput } from '../viewer';
import { SFAAnimationController } from './animation';
import { mat4, vec3 } from 'gl-matrix';
import { Color } from '../Color';
import { Camera } from '../Camera';
import { getMatrixTranslation } from '../MathHelpers';

export function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

export function dataCopy(data: DataView, byteOffset: number = 0, byteLength?: number): DataView {
    const start = data.byteOffset + byteOffset;
    const arrayBufferSlice = new ArrayBufferSlice(data.buffer, start, byteLength);
    const arrayBuffer = arrayBufferSlice.copyToBuffer();
    return new DataView(arrayBuffer);
}

export function arrayBufferSliceFromDataView(data: DataView): ArrayBufferSlice {
    return new ArrayBufferSlice(data.buffer, data.byteOffset, data.byteLength);
}

export function interpS16(n: number): number {
    // Bitwise operators automatically convert numbers to 32-bit signed integers.
    return ((n & 0xffff) << 16) >> 16;
}

export function signExtend(n: number, bits: number) {
    const shift = 32 - bits;
    return (n << shift) >> shift;
}

export function angle16ToRads(a: number): number {
    return interpS16(a) * Math.PI / 32768;
}

export function mat4SetRow(mtx: mat4, row: number, m0: number, m1: number, m2: number, m3: number) {
    // mat4's are Float32Arrays in column-major order
    mtx[row] = m0;
    mtx[4 + row] = m1;
    mtx[8 + row] = m2;
    mtx[12 + row] = m3;
}

// Because I'm sick of column-major...
export function mat4FromRowMajor(
    m00: number, m01: number, m02: number, m03: number,
    m10: number, m11: number, m12: number, m13: number,
    m20: number, m21: number, m22: number, m23: number,
    m30: number, m31: number, m32: number, m33: number) {
    return mat4.fromValues(
        m00, m10, m20, m30,
        m01, m11, m21, m31,
        m02, m12, m22, m32,
        m03, m13, m23, m33,
    )
}

export function mat4SetValue(mtx: mat4, row: number, col: number, m: number) {
    mtx[4 * col + row] = m;
}

export function readVec3(data: DataView, byteOffset: number = 0): vec3 {
    return vec3.fromValues(
        data.getFloat32(byteOffset + 0),
        data.getFloat32(byteOffset + 4),
        data.getFloat32(byteOffset + 8)
        );
}

// Reads bitfields. Bits are pulled from the most significant bits of each byte
// in the sequence.
export class HighBitReader {
    dv: DataView
    baseOffs: number;
    offs: number;
    num: number;
    buf: number;

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.baseOffs = offs;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    public peek(bits: number): number {
        if (bits > 24) {
            throw Error(`Cannot read more than 24 bits`);
        }

        while (this.num < bits) {
            this.buf |= this.dv.getUint8(this.offs) << (24 - this.num);
            this.offs++;
            this.num += 8;
        }

        return (this.buf >>> (32 - bits)) & ((1 << bits) - 1);
    }

    public drop(bits: number) {
        this.peek(bits); // Ensure buffer has bits to drop
        this.buf <<= bits;
        this.num -= bits;
    }

    public get(bits: number): number {
        const x = this.peek(bits);
        this.drop(bits);
        return x;
    }
}

// Reads bitfields. Bits are pulled from the least significant bits of each byte
// in the sequence.
export class LowBitReader {
    dv: DataView
    baseOffs: number;
    offs: number;
    num: number;
    buf: number;

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.baseOffs = offs;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    public peek(bits: number): number {
        if (bits > 32) {
            throw Error(`Cannot read more than 32 bits`);
        }

        while (this.num < bits) {
            this.buf |= this.dv.getUint8(this.offs) << this.num;
            this.offs++;
            this.num += 8;
        }

        return this.buf & ((1 << bits) - 1);
    }

    public drop(bits: number) {
        this.peek(bits); // Ensure buffer has bits to drop
        this.buf >>>= bits;
        this.num -= bits;
    }

    public get(bits: number): number {
        const x = this.peek(bits);
        this.drop(bits);
        return x;
    }

    public seekBit(bitAddr: number) {
        this.offs = this.baseOffs + (bitAddr >>> 3);
        this.num = 0;
        this.buf = 0;
        this.drop(bitAddr & 0x7);
    }
}

export function createDownloadLink(data: DataView, filename: string, text?: string): HTMLElement {
    const aEl = document.createElement('a');
    aEl.href = URL.createObjectURL(new Blob([data], {type: 'application/octet-stream'}));
    aEl.download = filename;
    if (text !== undefined) {
        aEl.append(text);
    }
    return aEl;
}

export function getCamPos(v: vec3, camera: Camera): void {
    getMatrixTranslation(v, camera.worldMatrix);
}

export interface ViewState {
    viewerInput: ViewerRenderInput;
    animController: SFAAnimationController;
    modelViewMtx: mat4;
    invModelViewMtx: mat4;
    outdoorAmbientColor: Color;
}
