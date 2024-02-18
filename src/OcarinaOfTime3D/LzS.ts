
import * as LZSS from "../Common/Compression/LZSS.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = buffer.createDataView();
    const uncompressedSize = srcView.getUint32(0x08, true);
    return LZSS.decompress(buffer.createDataView(0x10), uncompressedSize);
}

export function maybeDecompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    if (readString(buffer, 0x00, 0x04) === 'LzS\x01') {
        return decompress(buffer);
    } else {
        return buffer;
    }
}
