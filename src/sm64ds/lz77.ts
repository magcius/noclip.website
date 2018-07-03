
// SM64DS's LZ10 wrapper, which is just a "LZ77" prefix for the file.

import { decompress } from '../compression/cx';
import { readString } from 'util';
import ArrayBufferSlice from 'ArrayBufferSlice';

export function isLZ77(srcBuffer: ArrayBufferSlice): boolean {
    return (readString(srcBuffer, 0x00, 0x05) === 'LZ77\x10');
}

export function maybeDecompress(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    if (isLZ77(srcBuffer))
        return decompress(srcBuffer.slice(4));
    else
        return srcBuffer;
}
