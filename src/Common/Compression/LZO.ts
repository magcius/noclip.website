/*
 * LZO1X decompressor ported from lzokay:
 * https://github.com/jackoalan/lzokay
 */

import ArrayBufferSlice from '../../ArrayBufferSlice';

const enum Marker {
    M1 = 0x00,
    M2 = 0x40,
    M3 = 0x20,
    M4 = 0x10,
}

export function decompress(srcBuffer: ArrayBufferSlice, maxDstSize: number): ArrayBufferSlice {
    const srcView = srcBuffer.createDataView();

    if (srcView.byteLength < 3)
        throw "Input Overrun";

    let inp = 0;
    let outp = 0;
    let lbcur = 0;
    let lblen = 0;
    let state = 0;
    let nstate = 0;

    const outBuffer = new Uint8Array(maxDstSize);

    function needsIn(count: number): void {
        if (inp + count > srcView.byteLength)
            throw "Input overrun";
    }

    function needsOut(count: number): void {
        if (outp + count > maxDstSize)
            throw "Output overrun";
    }

    function consumeZeroByteLength(): number {
        const old_inp = inp;
        while (srcView.getUint8(inp) === 0) ++inp;
        return inp - old_inp;
    }

    /* First byte encoding */
    if (srcView.getUint8(inp) >= 22) {
        /* 22..255 : copy literal string
         *           length = (byte - 17) = 4..238
         *           state = 4 [ don't copy extra literals ]
         *           skip byte
         */
        const len = srcView.getUint8(inp++) - 17;
        needsIn(len);
        needsOut(len);
        for (let i = 0; i < len; ++i)
            outBuffer[outp++] = srcView.getUint8(inp++);
        state = 4;
    } else if (srcView.getUint8(inp) >= 18) {
        /* 18..21 : copy 0..3 literals
         *          state = (byte - 17) = 0..3  [ copy <state> literals ]
         *          skip byte
         */
        nstate = srcView.getUint8(inp++) - 17;
        state = nstate;
        needsIn(nstate);
        needsOut(nstate);
        for (let i = 0; i < nstate; ++i)
            outBuffer[outp++] = srcView.getUint8(inp++);
    }
    /* 0..17 : follow regular instruction encoding, see below. It is worth
     *         noting that codes 16 and 17 will represent a block copy from
     *         the dictionary which is empty, and that they will always be
     *         invalid at this place.
     */

    while (true) {
        needsIn(1);
        const inst = srcView.getUint8(inp++);
        if (!!(inst & 0xC0)) {
            /* [M2]
             * 1 L L D D D S S  (128..255)
             *   Copy 5-8 bytes from block within 2kB distance
             *   state = S (copy S literals after this block)
             *   length = 5 + L
             * Always followed by exactly one byte : H H H H H H H H
             *   distance = (H << 3) + D + 1
             *
             * 0 1 L D D D S S  (64..127)
             *   Copy 3-4 bytes from block within 2kB distance
             *   state = S (copy S literals after this block)
             *   length = 3 + L
             * Always followed by exactly one byte : H H H H H H H H
             *   distance = (H << 3) + D + 1
             */
            needsIn(1);
            lbcur = outp - ((srcView.getUint8(inp++) << 3) + ((inst >>> 2) & 0x07) + 1);
            lblen = (inst >>> 5) + 1;
            nstate = inst & 0x03;
        } else if (!!(inst & Marker.M3)) {
            /* [M3]
             * 0 0 1 L L L L L  (32..63)
             *   Copy of small block within 16kB distance (preferably less than 34B)
             *   length = 2 + (L ?: 31 + (zero_bytes * 255) + non_zero_byte)
             * Always followed by exactly one LE16 :  D D D D D D D D : D D D D D D S S
             *   distance = D + 1
             *   state = S (copy S literals after this block)
             */
            lblen = (inst & 0x1f) + 2;
            if (lblen === 2) {
                const offset = consumeZeroByteLength();
                needsIn(1);
                lblen += offset * 255 + 31 + srcView.getUint8(inp++);
            }
            needsIn(2);
            nstate = srcView.getUint16(inp, true);
            inp += 2;
            lbcur = outp - ((nstate >>> 2) + 1);
            nstate &= 0x3;
        } else if (!!(inst & Marker.M4)) {
            /* [M4]
             * 0 0 0 1 H L L L  (16..31)
             *   Copy of a block within 16..48kB distance (preferably less than 10B)
             *   length = 2 + (L ?: 7 + (zero_bytes * 255) + non_zero_byte)
             * Always followed by exactly one LE16 :  D D D D D D D D : D D D D D D S S
             *   distance = 16384 + (H << 14) + D
             *   state = S (copy S literals after this block)
             *   End of stream is reached if distance == 16384
             */
            lblen = (inst & 0x7) + 2;
            if (lblen === 2) {
                const offset = consumeZeroByteLength();
                needsIn(1);
                lblen += offset * 255 + 7 + srcView.getUint8(inp++);
            }
            needsIn(2);
            nstate = srcView.getUint16(inp, true);
            inp += 2;
            lbcur = outp - (((inst & 0x8) << 11) + (nstate >>> 2));
            nstate &= 0x3;
            if (lbcur === outp)
                break; /* Stream finished */
            lbcur -= 16384;
        } else {
            /* [M1] Depends on the number of literals copied by the last instruction. */
            if (state === 0) {
                /* If last instruction did not copy any literal (state == 0), this
                 * encoding will be a copy of 4 or more literal, and must be interpreted
                 * like this :
                 *
                 *    0 0 0 0 L L L L  (0..15)  : copy long literal string
                 *    length = 3 + (L ?: 15 + (zero_bytes * 255) + non_zero_byte)
                 *    state = 4  (no extra literals are copied)
                 */
                let len = inst + 3;
                if (len === 3) {
                    const offset = consumeZeroByteLength();
                    needsIn(1);
                    len += offset * 255 + 15 + srcView.getUint8(inp++);
                }
                /* copy_literal_run */
                needsIn(len);
                needsOut(len);
                for (let i = 0; i < len; ++i)
                    outBuffer[outp++] = srcView.getUint8(inp++);
                state = 4;
                continue;
            } else if (state !== 4) {
                /* If last instruction used to copy between 1 to 3 literals (encoded in
                 * the instruction's opcode or distance), the instruction is a copy of a
                 * 2-byte block from the dictionary within a 1kB distance. It is worth
                 * noting that this instruction provides little savings since it uses 2
                 * bytes to encode a copy of 2 other bytes but it encodes the number of
                 * following literals for free. It must be interpreted like this :
                 *
                 *    0 0 0 0 D D S S  (0..15)  : copy 2 bytes from <= 1kB distance
                 *    length = 2
                 *    state = S (copy S literals after this block)
                 *  Always followed by exactly one byte : H H H H H H H H
                 *    distance = (H << 2) + D + 1
                 */
                needsIn(1);
                nstate = inst & 0x3;
                lbcur = outp - ((inst >>> 2) + (srcView.getUint8(inp++) << 2) + 1);
                lblen = 2;
            } else {
                /* If last instruction used to copy 4 or more literals (as detected by
                 * state == 4), the instruction becomes a copy of a 3-byte block from the
                 * dictionary from a 2..3kB distance, and must be interpreted like this :
                 *
                 *    0 0 0 0 D D S S  (0..15)  : copy 3 bytes from 2..3 kB distance
                 *    length = 3
                 *    state = S (copy S literals after this block)
                 *  Always followed by exactly one byte : H H H H H H H H
                 *    distance = (H << 2) + D + 2049
                 */
                needsIn(1);
                nstate = inst & 0x3;
                lbcur = outp - ((inst >>> 2) + (srcView.getUint8(inp++) << 2) + 2049);
                lblen = 3;
            }
        }
        if (lbcur < 0)
            throw "Lookbehind overrun";
        needsIn(nstate);
        needsOut(lblen + nstate);
        /* Copy lookbehind */
        for (let i = 0; i < lblen; ++i)
            outBuffer[outp++] = outBuffer[lbcur++];
        state = nstate;
        /* Copy literal */
        for (let i = 0; i < nstate; ++i)
            outBuffer[outp++] = srcView.getUint8(inp++);
    }

    if (lblen !== 3) /* Ensure terminating M4 was encountered */
        throw "LZO terminator not reached";

    return new ArrayBufferSlice(outBuffer.buffer as ArrayBuffer, 0, outp);
}
