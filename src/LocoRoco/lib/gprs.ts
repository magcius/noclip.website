/*
 * LocoRoco GameCompress (?). A simple compression format. I don't know if this is a well known algorithm -
 * please let me know if you know what this actually is!
 *
 * petton-svn, 2026.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";

/**
 * Decompress data from an ArrayBufferSlice.
 *
 * @param buffer The compressed data as an ArrayBufferSlice
 * @param decompressedSize The expected size of the decompressed output
 * @returns A new ArrayBuffer containing the decompressed data
 */
function decompressGprsStream(
  buffer: ArrayBufferSlice,
  decompressedSize: number,
): ArrayBufferLike {
  const input = buffer.createTypedArray(Uint8Array);

  // Pre-allocate output buffer with known size
  const output = new Uint8Array(decompressedSize);
  let outPos = 0;

  // Inline bit reader state for performance
  let inPos = 0;
  let currentByte = input[inPos++];
  let currentBit = 0x80;

  // Inline readBit function
  const readBit = (): number => {
    if (currentBit === 0) {
      currentByte = input[inPos++];
      currentBit = 0x80;
    }
    const bit = (currentByte & currentBit) !== 0 ? 1 : 0;
    currentBit >>= 1;
    return bit;
  };

  // Inline readByte function
  const readByte = (): number => {
    return input[inPos++];
  };

  while (true) {
    // If we read a 0 bit, directly copy a byte
    // If we read a 1 bit, we are doing a back reference
    if (readBit() === 0) {
      output[outPos++] = readByte();
      continue;
    }

    // Back reference - two kinds: near and far
    let backrefOffset: number;

    if (readBit() === 1) {
      // Far back ref: 12-bit offset
      backrefOffset = -(256 - readByte());

      // Read additional 4 bits
      backrefOffset = (backrefOffset << 1) | readBit();
      backrefOffset = (backrefOffset << 1) | readBit();
      backrefOffset = (backrefOffset << 1) | readBit();
      backrefOffset = (backrefOffset << 1) | readBit();

      backrefOffset -= 255;
    } else {
      // Near back ref
      backrefOffset = readByte();

      // 0 ends decompression
      if (backrefOffset === 0) {
        break;
      }

      backrefOffset = -(256 - backrefOffset);
    }

    // Construct the size of the back ref
    let backrefSize = 1;
    while (readBit() !== 0) {
      backrefSize = (backrefSize << 1) | readBit();
    }
    backrefSize += 1;

    // Copy back reference directly into output buffer
    const srcStart = outPos + backrefOffset;
    for (let i = 0; i < backrefSize; i++) {
      output[outPos++] = output[srcStart + i];
    }
  }

  return output.buffer;
}

/**
 * Decompress a GPRS file from an ArrayBufferSlice.
 *
 * @param buffer The compressed GPRS file data as an ArrayBufferSlice
 * @returns A new ArrayBuffer containing the decompressed data
 * @throws Error if the magic number is invalid or decompressed size doesn't match
 */
export function decompressGprsFile(buffer: ArrayBufferSlice): ArrayBufferLike {
  const view = buffer.createDataView();

  // Check magic number "GPRS"
  if (view.getUint32(0, false) !== 0x47505253) {
    throw new Error("Magic not found. Input must start with GPRS.");
  }

  // Read decompressed size (big-endian 32-bit integer)
  const decompressedSize = view.getUint32(4, false);

  // Create a slice without the header for decompression
  const compressedData = buffer.slice(8);

  // Decompress the data with pre-allocated buffer
  const decompressed = decompressGprsStream(compressedData, decompressedSize);

  // Validate decompressed size
  if (decompressed.byteLength !== decompressedSize) {
    throw new Error(
      `Decompressed size not correct. Expected ${decompressedSize}, got ${decompressed.byteLength}`,
    );
  }

  return decompressed;
}
