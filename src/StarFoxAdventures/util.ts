import ArrayBufferSlice from '../ArrayBufferSlice';
import { ViewerRenderInput } from '../viewer';
import { SFAAnimationController } from './animation';
import { mat4 } from 'gl-matrix';

export function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

export function interpS16(n: number): number {
    // Bitwise operators convert numbers to 32-bit signed integers.
    return ((n & 0xffff) << 16) >> 16;
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

// Reads bitfields. Bits are pulled from the least significant bits of each byte
// in the sequence.
export class LowBitReader {
    dv: DataView
    baseOffs: number;
    offs: number
    num: number
    buf: number

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.baseOffs = offs;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    public peek(bits: number): number {
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

export function createDownloadLink(data: ArrayBufferSlice, filename: string, text?: string): HTMLElement {
    const aEl = document.createElement('a');
    aEl.href = URL.createObjectURL(new Blob([data.createDataView()], {type: 'application/octet-stream'}));
    aEl.download = filename;
    if (text !== undefined) {
        aEl.append(text);
    }
    return aEl;
}

export interface ViewState {
    viewerInput: ViewerRenderInput;
    animController: SFAAnimationController;
    modelViewMtx: mat4;
    invModelViewMtx: mat4;
}
