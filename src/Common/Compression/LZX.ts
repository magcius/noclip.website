
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert, nArray } from "../../util";

// Microsoft LZX

// https://docs.microsoft.com/en-us/previous-versions/bb417343(v=msdn.10)#microsoft-lzx-data-compression-format
// https://github.com/FNA-XNA/FNA/blob/master/src/Content/LzxDecoder.cs

class BitStream {
    public offs: number = 0;
    public nbits!: number;
    public sink!: number;

    constructor(private view: DataView) {
        this.reset();
    }

    public reset(): void {
        this.nbits = 0;
        this.sink = 0;
    }

    public fill(nbits: number): void {
        while (this.nbits < nbits) {
            const b = this.view.getUint16(this.offs + 0x00, true);
            this.sink |= b << (16 - this.nbits);
            this.nbits += 16;
            // JS can only hold 53-bit integers...
            assert(this.nbits < 53);
        }
    }

    public peek(nbits: number): number {
        return this.sink >>> (32 - nbits);
    }

    public eat(nbits: number): void {
        this.sink <<= nbits;
        this.nbits -= nbits;
    }

    public read(nbits: number): number {
        if (nbits > 0) {
            this.fill(nbits);
            const val = this.peek(nbits);
            this.eat(nbits);
            return val;
        } else {
            return 0;
        }
    }
}

const enum BlockType {
    Undefined = 0x00,
    Verbatim = 0x01,
    Aligned = 0x02,
    Uncompressed = 0x03,
}

class HuffmanTable {
    public len: Uint8Array;
    public cw: Uint16Array;

    constructor(public nbits: number, public maxSymbols: number) {
        this.len = new Uint8Array(this.maxSymbols);
        this.cw = new Uint16Array((1 << this.nbits));
    }
}

export class LZXState {
    public positionSlots: number;
    public window: Uint8Array;
    public windowOffs: number = 0;
    public R0: number = 1;
    public R1: number = 1;
    public R2: number = 1;
    public header: boolean = false;

    public pretreeHuffTable = new HuffmanTable(6, 20);
    public maintreeHuffTable: HuffmanTable;
    public lengthHuffTable = new HuffmanTable(12, 249 + 1);
    public alignedHuffTable = new HuffmanTable(7, 8);

    // Tables for extra things.
    public extraBitsTable: Uint8Array;
    public positionBaseTable: Uint32Array;

    constructor(windowBits: number) {
        const windowSize = 1 << windowBits;
        this.window = new Uint8Array(windowSize);
        this.window.fill(0xDC);

        if (windowBits === 15)
            this.positionSlots = 30;
        else if (windowBits === 16)
            this.positionSlots = 32;
        else if (windowBits === 17)
            this.positionSlots = 34;
        else if (windowBits === 18)
            this.positionSlots = 36;
        else if (windowBits === 19)
            this.positionSlots = 38;
        // TODO(jstpierre): This deviates from spec. Probably intentionally?
        else if (windowBits === 20)
            this.positionSlots = 42;
        else if (windowBits === 21)
            this.positionSlots = 50;
        else
            throw "whoops";

        this.maintreeHuffTable = new HuffmanTable(12, 256 + this.positionSlots << 3);

        this.extraBitsTable = new Uint8Array(this.positionSlots - 3);
        this.positionBaseTable = new Uint32Array(this.positionSlots - 3);
        for (let i = 1, j = 0, k = 0; i < this.extraBitsTable.length; i++) {
            this.extraBitsTable[i] = j;
            this.positionBaseTable[i] = k;
            k += 1 << j;
            if (i & 1)
                j++;
        }
    }
}

function buildHuffTable(tbl: HuffmanTable): void {
    // Build the code word table from the Canonical length table.

    // TODO(jstpierre): Faster implementation of this.
    const cwn: number[][] = nArray(tbl.nbits, () => []);

    // First, bucket our lengths.
    for (let sym = 0; sym < tbl.maxSymbols; sym++) {
        const len = tbl.len[sym];
        assert(len > 0);
        assert(len < tbl.nbits);
        cwn[len].push(sym);
    }

    const m = (1 << tbl.nbits) - 1;

    // Now go through and assign codes to each layer.
    let code = 0;
    assert(cwn[0].length === 0);
    const cw = tbl.cw;
    for (let len = 1; len < tbl.nbits; len++) {
        const cwe = cwn[len];

        // Fill our codewords table with all matching combinations.
        // For e.g. a code length of 2, we have 00, 01, 10, 11
        // To make reading easier, we pad things out to nbits, so if nbits is 6, we pad to 01xxxx.
        // That way the reader can just read nbits bits. Once they have the symbol, they can use
        // the len table to advance the proper amount.

        const nv = (m >>> len);

        for (let i = 0; i < cwe.length; i++) {
            for (let j = 0; j < nv; j++)
                cw[code++] = cwe[i];
            assert((code & nv) === 0);
        }

        code <<= 1;
    }
}

function readHuffSym(tbl: HuffmanTable, bs: BitStream): number {
    bs.fill(tbl.nbits);
    const v = bs.peek(tbl.nbits);
    const sym = tbl.cw[v];
    bs.eat(tbl.len[sym]);
    return sym;
}

function readHuffLen(dst: HuffmanTable, state: LZXState, first: number, last: number, bs: BitStream): void {
    const pret = state.pretreeHuffTable;

    for (let i = 0; i < 20; i++)
        pret.len[i] = bs.read(4);
    buildHuffTable(pret);

    for (let i = first; i < last;) {
        const op = readHuffSym(pret, bs);

        if (op === 17) {
            // ZLE.
            const n = 4 + bs.read(4);
            dst.len.fill(0, n);
            i += n;
        } else if (op === 18) {
            const n = 20 + bs.read(5);
            dst.len.fill(0, n);
            i += n;
        } else if (op === 19) {
            const n = 4 + bs.read(1);
            const delta = readHuffSym(pret, bs);

            for (let j = 0; j < n; j++) {
                let v = dst.len[i] - delta;
                if (v < 0)
                    v += 17;
                dst.len[i++] = v;
            }
        } else {
            const delta = op;

            let v = dst.len[i] - delta;
            if (v < 0)
                v += 17;
            dst.len[i++] = v;
        }
    }
}

export function decompressLZX(state: LZXState, dst: Uint8Array, dstOffs: number, dstSize: number, src: ArrayBufferSlice): void {
    const view = src.createDataView();
    const bs = new BitStream(view);

    // Read the header if we need to.
    if (!state.header) {
        const intel = bs.read(1);
        // We don't support intel patching.
        assert(intel === 0);
        state.header = true;
    }

    const window = state.window;
    let windowOffs = state.windowOffs;

    let outLength = 0;

    let R0 = state.R0;
    let R1 = state.R1;
    let R2 = state.R2;

    const windowMask = state.window.byteLength - 1;

    // Block decoding loop.
    while (outLength < dstSize) {
        const blockType: BlockType = bs.read(3);

        windowOffs &= windowMask;

        if (blockType === BlockType.Verbatim || blockType === BlockType.Aligned) {
            const blockLength = bs.read(24);

            // Aligned trees have an extra table at the start.

            // TODO(jstpierre): Spec puts this after the verbatim block. Likely a format change to make
            // the decode control flow easier here.
            if (blockType === BlockType.Aligned) {
                for (let i = 0; i < 8; i++)
                    state.alignedHuffTable.len[i] = bs.read(4);
                buildHuffTable(state.alignedHuffTable);
            }

            readHuffLen(state.maintreeHuffTable, state, 0, 256, bs);
            readHuffLen(state.maintreeHuffTable, state, 256, state.maintreeHuffTable.maxSymbols, bs);
            buildHuffTable(state.maintreeHuffTable);

            readHuffLen(state.lengthHuffTable, state, 0, 249, bs);
            buildHuffTable(state.lengthHuffTable);

            for (let i = 0; i < blockLength;) {
                // Aligned.
                const mainElement = readHuffSym(state.maintreeHuffTable, bs);

                if (mainElement < 0x100) {
                    // Literal.
                    window[windowOffs++] = mainElement;
                    i++;
                } else {
                    // Match.

                    // Decode.
                    let len = (mainElement & 0b000111);
                    if (len === 7)
                        len += readHuffSym(state.lengthHuffTable, bs);
                    len += 2;

                    const slot = (mainElement - 0x100) >>> 3;
                    let offs: number;
                    if (slot > 3) {
                        offs = state.positionBaseTable[slot - 3] - 2;

                        const extraBits = state.extraBitsTable[slot - 3];

                        if (extraBits > 0) {
                            if (blockType === BlockType.Aligned && extraBits >= 3) {
                                // Aligned block split the extra bits into a verbatim and aligned part.
                                offs += bs.read(extraBits - 3) << 3;
                                offs += readHuffSym(state.alignedHuffTable, bs);
                            } else {
                                offs += bs.read(extraBits);
                            }
                        } else {
                            offs = 1;
                        }

                        // Shuffle LRU.
                        R2 = R1; R1 = R0; R0 = offs;
                    } else if (slot === 0) {
                        offs = R0;
                    } else if (slot === 1) {
                        offs = R1;
                        // Shuffle LRU.
                        R1 = R0; R0 = offs;
                    } else if (slot === 2) {
                        offs = R2;
                        // Shuffle LRU.
                        R2 = R0; R0 = offs;
                    } else if (slot === 3) {
                        offs = 1;
                        R2 = R1; R1 = R0; R0 = offs;
                    } else {
                        // TypeScript is too dumb to figure out that this never happens...
                        throw "whoops";
                    }

                    // windowOffs should never run off the end...
                    assert(windowOffs + len < window.byteLength);

                    while (len--) {
                        window[windowOffs++] = window[offs++];
                        offs &= windowMask;
                    }
                }
            }
        } else if (blockType === BlockType.Uncompressed) {
            // TODO(jstpierre): Spec doesn't say this is the length, but this is what LzxDecoder.cs does.
            const blockLength = bs.read(24);

            // bitstream has read 16-bit values, so it is aligned.
            const offs = bs.offs;
            assert((offs & 0x01) === 0);

            // New values for R0, R1, R2 come first as 32-bit integers.
            R0 = view.getUint32(offs + 0x00, true);
            R1 = view.getUint32(offs + 0x04, true);
            R2 = view.getUint32(offs + 0x08, true);

            window.set(src.createTypedArray(Uint8Array, offs + 0x0C, blockLength), windowOffs);
            windowOffs += blockLength;
            outLength += blockLength;

            bs.offs += blockLength + 0x0C;
            bs.reset();
        } else {
            throw "whoops";
        }
    }

    assert(outLength === dstSize);

    // Copy the window to the output buffer.
    for (let i = 0; i < dstSize; i++)
        dst[dstOffs + i] = window[windowOffs - dstSize + i];

    // Put back our state.
    state.windowOffs = windowOffs;
    state.R0 = R0;
    state.R1 = R1;
    state.R2 = R2;
}
