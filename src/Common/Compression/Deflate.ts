import ArrayBufferSlice from '../../ArrayBufferSlice';
import { rust } from '../../rustlib';

export function decompress(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const bufView = rust!.deflate_decompress(srcBuffer.createTypedArray(Uint8Array));
    return ArrayBufferSlice.fromView(bufView);
}

export function decompress_raw(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const bufView = rust!.deflate_raw_decompress(srcBuffer.createTypedArray(Uint8Array));
    return ArrayBufferSlice.fromView(bufView);
}

