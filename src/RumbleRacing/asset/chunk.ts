import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFourCC } from "../helpers/fourCC";

export interface AssetChunk {
  offset: number;
  magic: ArrayBufferSlice;
  size: number;
  payload: ArrayBufferSlice;
}

export function parseChunks(data: ArrayBufferSlice): AssetChunk[] {
  const view = data.createDataView();
  const chunks: AssetChunk[] = [];
  let offset = 0;

  while (offset < data.byteLength) {
    if (offset + 8 > data.byteLength) {
      throw new Error(`incomplete chunk header at offset ${offset}`);
    }
    const magic = data.subarray(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (size < 8) {
      const tag = readFourCC(magic, 0);
      throw new Error(`invalid chunk size ${size} for "${tag}"`);
    }
    const chunkEnd = offset + size;
    if (chunkEnd > data.byteLength) {
      throw new Error(`chunk size ${size} exceeds remaining data`);
    }
    const payload = data.subarray(offset, size);

    chunks.push({ offset, magic, size, payload });
    offset = chunkEnd;
  }

  return chunks;
}
