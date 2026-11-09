import ArrayBufferSlice from "../../ArrayBufferSlice";

export function readChunkData(
  data: ArrayBufferSlice,
  view: DataView,
  cursor: { pos: number },
): ArrayBufferSlice {
  const chunkSize = view.getUint32(cursor.pos, true);
  cursor.pos += 4;
  const available = data.byteLength - cursor.pos;
  const size = Math.min(Math.max(chunkSize - 8, 0), available);
  const chunkData = data.subarray(cursor.pos, size);
  cursor.pos += chunkSize - 8;
  return chunkData;
}
