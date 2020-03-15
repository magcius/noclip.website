import ArrayBufferSlice from '../ArrayBufferSlice';

export function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

export function interpS16(n: number): number {
    const u16 = new Uint16Array(1);
    const s16 = new Int16Array(u16.buffer);
    u16[0] = n & 0xffff;
    return s16[0];
}

// Reads bitfields. Bits are pulled from the least significant bits of each byte
// in the sequence.
export class LowBitReader {
    dv: DataView
    offs: number
    num: number
    buf: number

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
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
}

export function createDownloadLink(data: ArrayBufferSlice, filename: string, text?: string): HTMLElement {
    const aEl = document.createElement('a')
    aEl.href = URL.createObjectURL(new Blob([data.createDataView()], {type: 'application/octet-stream'}))
    aEl.download = filename
    if (text !== undefined) {
        aEl.append(text)
    }
    return aEl
}
