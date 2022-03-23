
// Nintendo MIO0 format.
//
// Similar to Yay0 (an earlier version, likely), except it has a few tweaks to the compressed data.
//
// Header (16 bytes):
//   Magic: "MIO0" (4 bytes)
//   Uncompressed size (4 bytes, big endian)
//   Offset to Lengths substream (4 bytes, big endian)
//   Offset to Data substream (4 bytes, big endian)
//
// Flags substream starts at 0x10 (directly after Header)
//
// Data:
//   Read Flags from Flags substream (1 byte)
//   For each bit in the Flags byte, from MSB to LSB:
//     If flag is 1:
//       Literal: copy one byte from Data substream to dest.
//     If flag is 0:
//       Read LZ77 from Lengths substream (2 bytes, big endian):
//         Length: bits 0-4
//         Offset: bits 5-15
//         Copy Length+3 bytes from Offset back in the output buffer.

import { assert, readString } from '../../util';
import ArrayBufferSlice from '../../ArrayBufferSlice';

export function decompress(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = srcBuffer.createDataView();
    assert(readString(srcBuffer, 0x00, 0x04) === 'MIO0');

    let uncompressedSize = srcView.getUint32(0x04, false);

    let lengthsOffs = srcView.getUint32(0x08, false);
    let dataOffs = srcView.getUint32(0x0C, false);
    let flagsOffs = 0x10;

    const dstBuffer = new Uint8Array(uncompressedSize);

    let dstOffs = 0x00;

    while (true) {
        const commandByte = srcView.getUint8(flagsOffs++);
        let i = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                // Literal.
                uncompressedSize--;
                dstBuffer[dstOffs++] = srcView.getUint8(dataOffs++);
            } else {
                const tmp = srcView.getUint16(lengthsOffs, false);
                lengthsOffs += 2;

                const windowOffset = (tmp & 0x0FFF) + 1;
                let windowLength = (tmp >> 12) + 3;

                let copyOffs = dstOffs - windowOffset;

                uncompressedSize -= windowLength;
                while (windowLength--)
                    dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer);
        }
    }
}
