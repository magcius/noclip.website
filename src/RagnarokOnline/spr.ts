
// Parser for Ragnarok Online's SPR sprite-image format (magic "SP").
//
// A .spr holds the bitmap frames a character/monster/effect animates through.
// Two kinds of frame coexist: palette-indexed frames (an 8-bit index per pixel,
// run-length-encoded in newer versions, resolved against a 256-color palette
// embedded in the file's last 1024 bytes), and — in versions >= 0x0200 —
// true-color RGBA frames stored bottom-up as packed pixels.
//
// Palette index 0 is the transparency key: those pixels decode to alpha 0. We
// composite every frame to top-down RGBA8 (the same DecodedImage shape the BMP
// and water decoders produce), so the renderer treats sprite frames and other
// textures uniformly.
//
// All multi-byte values are little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DecodedImage } from "./bmp.js";

// A decoded .spr: the palette-indexed frames composited against the embedded
// palette, and the optional true-color (RGBA) frames newer versions append. A
// clip with clip_type 0 references `indexed[spr_index]`; any other clip type
// references `rgba[spr_index]`.
export interface SprModel {
    indexed: DecodedImage[];
    rgba: DecodedImage[];
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

// Highest SPR version we accept; matches the original loader's ceiling and the
// modern corpus (no newer SPR layout exists in the data we target).
const MAX_VERSION = 0x0201;

// Run-length-decodes the indexed-image stream into exactly width*height palette
// indices. A 0x00 byte is a marker followed by a length byte that expands into
// that many transparent (index 0) pixels; any other byte is one literal index.
function zeroDecompress(r: Reader, end: number, width: number, height: number): Uint8Array {
    const total = width * height;
    const out = new Uint8Array(total);

    let run = 0;       // remaining transparent pixels in the current run
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

// Composites width*height palette indices to top-down RGBA8. Index 0 is the
// transparency key (alpha 0); other indices take their RGB from the palette at
// full opacity. `palette` is 256 entries of R,G,B,flags (4 bytes each).
function compositeIndexed(indices: Uint8Array, palette: Uint8Array, width: number, height: number): DecodedImage {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const pe = idx * 4;
        const o = i * 4;
        // Zero the RGB of keyed texels (not just alpha) so the transparent color
        // never bleeds into opaque neighbours under linear filtering.
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
    // Magic 'SP' is stored as bytes 'S','P' => little-endian word 'P'<<8 | 'S'.
    if (id !== (("P".charCodeAt(0) << 8) | "S".charCodeAt(0)))
        throw new Error(`SPR: bad magic 0x${id.toString(16)}`);
    if (ver > MAX_VERSION)
        throw new Error(`SPR: unsupported version 0x${ver.toString(16)}`);

    const indexedCount = r.u16();

    // The embedded palette (versions >= 0x0101) is the file's last 1024 bytes:
    // 256 entries of R,G,B,flags.
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
            // RLE: a WORD payload size, then bytes that decode to exactly w*h
            // indices. Bound the decode to the declared chunk so a malformed run
            // can't read past it.
            const compressedSize = r.u16();
            const chunkEnd = r.offs + compressedSize;
            if (chunkEnd > r.byteLength)
                throw new Error("SPR: RLE chunk runs past end of file");
            indices = zeroDecompress(r, chunkEnd, w, h);
            r.offs = chunkEnd; // skip any unread padding in the chunk
        } else {
            // Raw: w*h index bytes, one per pixel.
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
            // Pixels are stored bottom-up as packed DWORDs whose little-endian
            // byte order is a,b,g,r; flip rows to produce top-down RGBA8.
            for (let y = h - 1; y >= 0; y--) {
                const row = w * y;
                for (let x = 0; x < w; x++) {
                    const px = r.u32();
                    const o = (row + x) * 4;
                    out[o + 0] = (px >>> 24) & 0xff; // r
                    out[o + 1] = (px >>> 16) & 0xff; // g
                    out[o + 2] = (px >>> 8) & 0xff;  // b
                    out[o + 3] = px & 0xff;          // a
                }
            }
            rgba.push({ width: w, height: h, rgba: out });
        }
    }

    return { indexed, rgba };
}
