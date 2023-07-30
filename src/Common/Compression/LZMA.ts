// Based on js-lzma by Juan Mellado https://github.com/jcmellado/js-lzma/blob/master/src/lzma.js
// Ported to TypeScript by Jasper.

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { rust } from '../../rustlib.js';

/*
Copyright (c) 2011 Juan Mellado
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/*
References:
- "LZMA SDK" by Igor Pavlov
http://www.7-zip.org/sdk.html
- "The .lzma File Format" from xz documentation
https://github.com/joachimmetz/xz/blob/master/doc/lzma-file-format.txt
*/

interface LZMAProperties {
    lc: number;
    lp: number;
    pb: number;
    dictionarySize: number;
}

export function decodeLZMAProperties(buffer: ArrayBufferSlice): LZMAProperties {
    const view = buffer.createDataView();

    let properties = view.getUint8(0);
    const lc = properties % 9;
    properties = ~~(properties / 9);
    const lp = properties % 5;
    const pb = ~~(properties / 5);

    const dictionarySize = view.getUint32(0x01, true);

    return {
        // The number of high bits of the previous
        // byte to use as a context for literal encoding.
        lc,
        // The number of low bits of the dictionary
        // position to include in literal_pos_state.
        lp,
        // The number of low bits of the dictionary
        // position to include in pos_state.
        pb,
        // Dictionary Size is stored as an unsigned 32-bit
        // little endian integer. Any 32-bit value is possible,
        // but for maximum portability, only sizes of 2^n and
        // 2^n + 2^(n-1) should be used.
        dictionarySize,
    };
}

export function decompress(srcBuffer: ArrayBufferSlice, properties: LZMAProperties, maxSize: number): ArrayBufferSlice {
    const bufView = rust.lzma_decompress(srcBuffer.createTypedArray(Uint8Array), properties.lc, properties.lp, properties.pb, properties.dictionarySize, BigInt(maxSize))
    return ArrayBufferSlice.fromView(bufView);
}

