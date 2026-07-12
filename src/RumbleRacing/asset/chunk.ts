import { readFourCC } from "../helpers/fourCC";

export interface AssetChunk {
  offset: number;
  magic: Uint8Array;
  size: number;
  payload: Uint8Array;
}

export function parseChunks(data: Uint8Array): AssetChunk[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: AssetChunk[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (offset + 8 > data.length) {
      throw new Error(`incomplete chunk header at offset ${offset}`);
    }
    const magic = data.slice(offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (size < 8) {
      const tag = readFourCC(magic, 0);
      throw new Error(`invalid chunk size ${size} for "${tag}"`);
    }
    const chunkEnd = offset + size;
    if (chunkEnd > data.length) {
      throw new Error(`chunk size ${size} exceeds remaining data`);
    }
    const payload = data.slice(offset, chunkEnd);

    chunks.push({ offset, magic, size, payload });
    offset = chunkEnd;
  }

  return chunks;
}
