
import ArrayBufferSlice from "ArrayBufferSlice";

// Nintendo DS LZ77 format.

// LZ10:
// Header (4 bytes):
//   Magic: "\x10" (1 byte)
//   Uncompressed size (3 bytes, little endian)
// Data:
//   Flags (1 byte)
//   For each bit in the flags byte, from MSB to LSB:
//     If flag is 1:
//       LZ77 (2 bytes, big endian):
//         Length: bits 0-3
//         Offset: bits 4-15
//         Copy Length+3 bytes from Offset back in the output buffer.
//     If flag is 0:
//       Literal: copy one byte from src to dest.

export function decompressLZ10(srcView: DataView) {
    let uncompressedSize = srcView.getUint32(0x00, true) >> 8;
    const dstBuffer = new Uint8Array(uncompressedSize);

    let srcOffs = 0x04;
    let dstOffs = 0x00;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        let i = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                const tmp = srcView.getUint16(srcOffs, false);
                srcOffs += 2;

                const windowOffset = (tmp & 0x0FFF) + 1;
                let windowLength = (tmp >> 12) + 3;

                let copyOffs = dstOffs - windowOffset;

                uncompressedSize -= windowLength;
                while (windowLength--)
                    dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
            } else {
                // Literal.
                uncompressedSize--;
                dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer);
        }
    }
}

// LZ11:
// Header (4 bytes):
//   Magic: "\x11" (1 byte)
//   Uncompressed size (3 bytes, little endian)
// Data:
//   Flags (1 byte)
//   For each bit in the flags byte, from MSB to LSB:
//     If flag is 1:
//       Fancy LZ77. See below for more details. Flag switches on 4-7 of newly read byte.
//     If flag is 0:
//       Literal: copy one byte from src to dest.

export function decompressLZ11(srcView: DataView) {
    let uncompressedSize = srcView.getUint32(0x00, true) >> 8;
    const dstBuffer = new Uint8Array(uncompressedSize);

    let srcOffs = 0x04;
    let dstOffs = 0x00;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        let i = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                const indicator = srcView.getUint8(srcOffs) >>> 4;

                let windowOffset;
                let windowLength;
                if (indicator > 1) {
                    // Two bytes. AB CD
                    const tmp = srcView.getUint16(srcOffs, false);
                    // Length: A + 1
                    // Offset: BCD + 1
                    windowLength = indicator + 1;
                    windowOffset = (tmp & 0x0FFF) + 1;
                    srcOffs += 2;
                } else if (indicator === 0) {
                    // Three bytes: AB CD EF
                    const tmp = (srcView.getUint16(srcOffs, false) << 8) | srcView.getUint8(srcOffs + 0x02);
                    // Length: BC + 0x11
                    // Offset: DEF + 1
                    windowLength = (tmp >>> 12) + 0x11;
                    windowOffset = (tmp & 0x0FFF) + 1;
                    srcOffs += 3;
                } else if (indicator === 1) {
                    // Four bytes. AB CD EF GH
                    const tmp = srcView.getUint32(srcOffs, false);
                    // Length: BCDE + 0x111
                    // Offset: FGH + 1
                    windowLength = ((tmp >>> 12) & 0xFFFF) + 0x111;
                    windowOffset = (tmp & 0x0FFF) + 1;
                    srcOffs += 4;
                }

                let copyOffs = dstOffs - windowOffset;

                uncompressedSize -= windowLength;
                while (windowLength--)
                    dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
            } else {
                // Literal.
                uncompressedSize--;
                dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer);
        }
    }
}

export function decompress(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = srcBuffer.createDataView();

    const magic = srcView.getUint8(0x00);
    if (magic === 0x10)
        return decompressLZ10(srcView);
    else if (magic === 0x11)
        return decompressLZ11(srcView);
    else
        throw new Error("Not Nintendo LZ77");
}
