
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { LZXState, decompressLZX } from "../Common/Compression/LZX";

// XNA Binary Format

export function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    // This parses & decompresses a raw XNB asset.
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x03) === 'XNB');
    const platform = view.getUint8(0x03);

    // Make sure this is for Windows.
    assert(String.fromCharCode(platform) === 'w');

    const version = view.getUint8(0x04);
    assert(version === 5);

    const flags = view.getUint8(0x05);
    const compressed = !!(flags & 0x80);

    const size = view.getUint32(0x06, true);

    if (compressed) {
        const decompressedSize = view.getUint32(0x0A, true);
        const dst = new Uint8Array(decompressedSize);

        const state = new LZXState(16);
        let idx = 0x0E;
        let dstOffs = 0;
        while (idx < decompressedSize) {
            const flag = view.getUint8(idx + 0x00);
            let blockSize: number, frameSize: number;
            if (flag === 0xFF) {
                frameSize = view.getUint16(idx + 0x01, false);
                blockSize = view.getUint16(idx + 0x03, false);
                idx += 0x05;
            } else {
                frameSize = 0x8000;
                blockSize = view.getUint16(idx + 0x00, false);
                idx += 0x02;
            }

            if (frameSize === 0 || blockSize === 0)
                break;

            decompressLZX(state, dst, dstOffs, frameSize, buffer.subarray(idx, blockSize));
            dstOffs += frameSize;
        }

        return new ArrayBufferSlice(dst);
    } else {
        return buffer.slice(0x0A);
    }
}
