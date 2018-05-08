// Nintendo Yaz0 format.

// Header (8 bytes):
//   Magic: "Yaz0" (4 bytes)
//   Uncompressed size (4 bytes, big endian)
// Data:
//   Flags (1 byte)
//   For each bit in the flags byte, from MSB to LSB:
//     If flag is 1:
//       Literal: copy one byte from src to dest.
//     If flag is 0:
//       LZ77 (2 bytes, big endian):
//         Length: bits 0-4
//           If Length = 0, then read additional byte, add 16, and add it to Length.
//         Offset: bits 5-15
//         Copy Length+2 bytes from Offset back in the output buffer.

import { assert, readString, align } from './util';
import { yaz0Instance, yaz0Exports } from './wat_modules';
import ArrayBufferSlice from 'ArrayBufferSlice';
import WasmMemoryManager from './WasmMemoryManager';

declare module "./wat_modules" {
    interface yaz0Exports {
        decompress(pDst: number, pSrc: number, dstSize: number): void;
    }
}

// XXX(jstpierre): Firefox has GC pressure when constructing new WebAssembly.Memory instances
// on 64-bit machines. Construct a global WebAssembly.Memory and use it. Remove this when the
// bug is fixed. https://bugzilla.mozilla.org/show_bug.cgi?id=1459761#c5
const wasmInstance = yaz0Instance();

function decompressWasm(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = srcBuffer.createDataView();
    assert(readString(srcBuffer, 0x00, 0x04) === 'Yaz0');

    const dstSize = srcView.getUint32(0x04, false);
    const srcSize = srcBuffer.byteLength;

    const pDstOffs = 0;
    const pSrcOffs = align(dstSize, 0x10);

    const heapSize = pSrcOffs + align(srcSize, 0x10);

    const heapBase = wasmInstance.__heap_base;

    const wasmMemory = new WasmMemoryManager(wasmInstance.memory);
    wasmMemory.resize(heapBase + heapSize);
    const mem = wasmMemory.mem;
    const heap = wasmMemory.heap;

    const pDst = heapBase + pDstOffs;
    const pSrc = heapBase + pSrcOffs;

    // Copy src buffer.
    heap.set(srcBuffer.createTypedArray(Uint8Array, 0x10), pSrc);

    wasmInstance.decompress(pDst, pSrc, dstSize);

    // Copy the result buffer to a new buffer for memory usage purposes.
    const result = new ArrayBufferSlice(heap.buffer).copySlice(pDst, dstSize);

    return result;
}

function decompressJs(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = srcBuffer.createDataView();
    assert(readString(srcBuffer, 0x00, 0x04) === 'Yaz0');

    let uncompressedSize = srcView.getUint32(0x04, false);
    const dstBuffer = new Uint8Array(uncompressedSize);

    let srcOffs = 0x10;
    let dstOffs = 0x00;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        let i = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                // Literal.
                uncompressedSize--;
                dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
            } else {
                const tmp = srcView.getUint16(srcOffs, false);
                srcOffs += 2;

                const windowOffset = (tmp & 0x0FFF) + 1;
                let windowLength = (tmp >> 12) + 2;
                if (windowLength === 2) {
                    windowLength += srcView.getUint8(srcOffs++) + 0x10;
                }

                assert(windowLength >= 3 && windowLength <= 0x111);

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

export const decompress = decompressWasm;
