import ArrayBufferSlice from "../ArrayBufferSlice";
import * as LZSS from "../Common/Compression/LZSS";

export function decompressLZ(compressedBuf: ArrayBufferSlice): ArrayBufferSlice {
    const view = compressedBuf.createDataView();
    const compressedView = compressedBuf.subarray(0x8).createDataView();
    const uncompressedSize = view.getUint32(0x4, true);
    const uncompressedBuffer = LZSS.decompress(compressedView, uncompressedSize);
    return uncompressedBuffer;
}
