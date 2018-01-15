
// SM64DS's LZ10 wrapper, which is just a "LZ77" prefix for the file.

import { decompress } from '../lz77';
import { assert, readString } from 'util';

export function isLZ77(srcBuffer: ArrayBuffer) {
    const srcView = new DataView(srcBuffer);
    return (readString(srcBuffer, 0x00, 0x05) === 'LZ77\x10');
}

export function maybeDecompress(srcBuffer: ArrayBuffer) {
    if (isLZ77(srcBuffer))
        return decompress(srcBuffer.slice(4));
    else
        return srcBuffer;
}
