import ArrayBufferSlice from '../../ArrayBufferSlice.js';
import { rust } from '../../rustlib.js';

export function decompress(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const bufView = rust!.deflate_decompress(srcBuffer.createTypedArray(Uint8Array));
    return ArrayBufferSlice.fromView(bufView);
}

export function decompress_raw(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const bufView = rust!.deflate_raw_decompress(srcBuffer.createTypedArray(Uint8Array));
    return ArrayBufferSlice.fromView(bufView);
}

