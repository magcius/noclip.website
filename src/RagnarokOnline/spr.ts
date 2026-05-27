import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DecodedImage } from "./bmp.js";

export interface SprModel {
    indexed: DecodedImage[];
    rgba: DecodedImage[];
    indexedTopRow: Int16Array;
    indexedBottomRow: Int16Array;
    rgbaTopRow: Int16Array;
    rgbaBottomRow: Int16Array;
}

function findVisibleRows(img: DecodedImage): { top: number, bottom: number } {
    const w = img.width, h = img.height;
    let top = -1, bottom = -1;
    for (let y = 0; y < h; y++) {
        const base = y * w * 4 + 3;
        for (let x = 0; x < w; x++) {
            if (img.rgba[base + x * 4] !== 0) { top = y; break; }
        }
        if (top !== -1) break;
    }
    for (let y = h - 1; y >= 0; y--) {
        const base = y * w * 4 + 3;
        for (let x = 0; x < w; x++) {
            if (img.rgba[base + x * 4] !== 0) { bottom = y; break; }
        }
        if (bottom !== -1) break;
    }
    return { top, bottom };
}

function visibleRowArrays(imgs: DecodedImage[]): { top: Int16Array, bottom: Int16Array } {
    const top = new Int16Array(imgs.length);
    const bottom = new Int16Array(imgs.length);
    for (let i = 0; i < imgs.length; i++) {
        const r = findVisibleRows(imgs[i]);
        top[i] = r.top;
        bottom[i] = r.bottom;
    }
    return { top, bottom };
}

class Reader {
    private view: DataView;
    public offs = 0;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public get byteLength(): number { return this.view.byteLength; }

    public assertCanRead(n: number): void {
        if (this.offs + n > this.view.byteLength)
            throw new Error(`SPR: unexpected end of file (need ${n} bytes at ${this.offs})`);
    }

    public u8(): number { this.assertCanRead(1); const v = this.view.getUint8(this.offs); this.offs += 1; return v; }
    public u16(): number { this.assertCanRead(2); const v = this.view.getUint16(this.offs, true); this.offs += 2; return v; }
    public u32(): number { this.assertCanRead(4); const v = this.view.getUint32(this.offs, true); this.offs += 4; return v; }

    public bytes(n: number): Uint8Array {
        this.assertCanRead(n);
        const v = this.buffer.createTypedArray(Uint8Array, this.offs, n);
        this.offs += n;
        return v;
    }

    public byteAt(o: number): number { return this.view.getUint8(o); }
}

const MAX_VERSION = 0x0201;

function zeroDecompress(r: Reader, end: number, width: number, height: number): Uint8Array {
    const total = width * height;
    const out = new Uint8Array(total);

    let run = 0;
    let color = 0;
    let at = 0;
    for (let i = 0; i < total; i++) {
        if (run === 0) {
            if (r.offs >= end)
                throw new Error("SPR: RLE stream overran its chunk");
            color = r.u8();
            if (color === 0) {
                if (r.offs >= end)
                    throw new Error("SPR: RLE run length missing");
                run = r.u8();
            }
        }
        if (run > 0) {
            out[at++] = 0;
            run--;
        } else {
            out[at++] = color;
        }
    }
    return out;
}

function compositeIndexed(indices: Uint8Array, palette: Uint8Array, width: number, height: number): DecodedImage {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const pe = idx * 4;
        const o = i * 4;

        if (idx === 0) {
            rgba[o + 0] = 0;
            rgba[o + 1] = 0;
            rgba[o + 2] = 0;
            rgba[o + 3] = 0;
        } else {
            rgba[o + 0] = palette[pe + 0];
            rgba[o + 1] = palette[pe + 1];
            rgba[o + 2] = palette[pe + 2];
            rgba[o + 3] = 255;
        }
    }
    return { width, height, rgba };
}

export function parseSPR(buffer: ArrayBufferSlice): SprModel {
    const r = new Reader(buffer);

    const id = r.u16();
    const ver = r.u16();

    if (id !== (("P".charCodeAt(0) << 8) | "S".charCodeAt(0)))
        throw new Error(`SPR: bad magic 0x${id.toString(16)}`);
    if (ver > MAX_VERSION)
        throw new Error(`SPR: unsupported version 0x${ver.toString(16)}`);

    const indexedCount = r.u16();

    const palette = new Uint8Array(256 * 4);
    if (ver >= 0x0101) {
        if (r.byteLength < 1024)
            throw new Error("SPR: file too small for an embedded palette");
        const palOff = r.byteLength - 1024;
        for (let i = 0; i < 256 * 4; i++)
            palette[i] = r.byteAt(palOff + i);
    }

    let rgbaCount = 0;
    if (ver >= 0x0200)
        rgbaCount = r.u16();

    const indexed: DecodedImage[] = [];
    for (let i = 0; i < indexedCount; i++) {
        const w = r.u16();
        const h = r.u16();

        let indices: Uint8Array;
        if (ver >= 0x0201) {

            const compressedSize = r.u16();
            const chunkEnd = r.offs + compressedSize;
            if (chunkEnd > r.byteLength)
                throw new Error("SPR: RLE chunk runs past end of file");
            indices = zeroDecompress(r, chunkEnd, w, h);
            r.offs = chunkEnd;
        } else {
            indices = r.bytes(w * h).slice();
        }

        indexed.push(compositeIndexed(indices, palette, w, h));
    }

    const rgba: DecodedImage[] = [];
    if (ver >= 0x0200) {
        for (let m = 0; m < rgbaCount; m++) {
            const w = r.u16();
            const h = r.u16();
            const out = new Uint8Array(w * h * 4);

            for (let y = h - 1; y >= 0; y--) {
                const row = w * y;
                for (let x = 0; x < w; x++) {
                    const px = r.u32();
                    const o = (row + x) * 4;
                    out[o + 0] = (px >>> 24) & 0xff;
                    out[o + 1] = (px >>> 16) & 0xff;
                    out[o + 2] = (px >>> 8) & 0xff;
                    out[o + 3] = px & 0xff;
                }
            }
            rgba.push({ width: w, height: h, rgba: out });
        }
    }

    const indexedRows = visibleRowArrays(indexed);
    const rgbaRows = visibleRowArrays(rgba);
    return {
        indexed, rgba,
        indexedTopRow: indexedRows.top, indexedBottomRow: indexedRows.bottom,
        rgbaTopRow: rgbaRows.top, rgbaBottomRow: rgbaRows.bottom,
    };
}
