import { reverseBytesInPlace, readUint32LE } from "../helpers/bytes";

export interface AssetChunk {
  offset: number;
  magic: Uint8Array;
  size: number;
  payload: Uint8Array;
}

export function magicString(chunk: AssetChunk): string {
  return new TextDecoder().decode(chunk.magic);
}

export function parseChunks(data: Uint8Array): AssetChunk[] {
  const chunks: AssetChunk[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (offset + 8 > data.length) {
      throw new Error(`incomplete chunk header at offset ${offset}`);
    }
    const magic = data.slice(offset, offset + 4);
    const size = readUint32LE(data, offset + 4);
    if (size < 8) {
      throw new Error(
        `invalid chunk size ${size} for "${new TextDecoder().decode(magic)}"`,
      );
    }
    const chunkEnd = offset + size;
    if (chunkEnd > data.length) {
      throw new Error(`chunk size ${size} exceeds remaining data`);
    }
    const payload = data.slice(offset, chunkEnd);

    const magicCopy = magic.slice();
    reverseBytesInPlace(magicCopy);

    chunks.push({ offset, magic: magicCopy, size, payload });
    offset = chunkEnd;
  }

  return chunks;
}
