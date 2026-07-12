import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString } from "../../util";

export function readFourCC(data: Uint8Array, offset: number): string {
  const reversed = new Uint8Array(4);
  reversed[0] = data[offset + 3];
  reversed[1] = data[offset + 2];
  reversed[2] = data[offset + 1];
  reversed[3] = data[offset];
  return readString(ArrayBufferSlice.fromView(reversed), 0, 4, false);
}
