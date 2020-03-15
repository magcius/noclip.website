import ArrayBufferSlice from '../ArrayBufferSlice';

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
