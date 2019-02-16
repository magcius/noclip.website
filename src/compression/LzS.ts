
// A decompressor for Haruhiko Okumura's LZSS, with MATCHLEN 18
// http://read.pudn.com/downloads4/sourcecode/zip/14045/LZSS.C__.htm

import ArrayBufferSlice from "../ArrayBufferSlice";

export function decompress(srcView: DataView) {
    let uncompressedSize = srcView.getUint32(0x08, true);
    const dstBuffer = new Uint8Array(uncompressedSize);

    let srcOffs = 0x10;
    let dstOffs = 0x00;

    const tempBuffer = new Uint8Array(4096);
    let tempBufferWP = 0xFEE;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        for (let i = 0; i < 8; i++) {
            if (commandByte & (1 << i)) {
                // Literal.
                uncompressedSize--;
                tempBuffer[tempBufferWP++] = dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                tempBufferWP %= 4096;
            } else {
                const b0 = srcView.getUint8(srcOffs++);
                const b1 = srcView.getUint8(srcOffs++);

                let tempBufferRP = b0 | ((b1 & 0xF0) << 4);
                let copyLength = (b1 & 0x0F) + 3;

                uncompressedSize -= copyLength;
                while (copyLength--) {
                    tempBuffer[tempBufferWP++] = dstBuffer[dstOffs++] = tempBuffer[tempBufferRP++];
                    tempBufferWP %= 4096;
                    tempBufferRP %= 4096;
                }
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer);
        }
    }
}
