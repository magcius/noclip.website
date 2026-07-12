import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString } from "../../util";
import { readFourCC } from "../helpers/fourCC";

export interface ResourceEntry {
  typeTag: string;
  resourceIndex: number;
  resourceName: string;
}

export interface RLst {
  fileName: string;
  count: number;
  entries: ResourceEntry[];
}

export function parseRLst(data: Uint8Array, fileName: string): RLst {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  const count = view.getUint32(pos, true);
  pos += 4;

  const entries: ResourceEntry[] = [];

  for (let i = 0; i < count; i++) {
    const typeTag = readFourCC(data, pos);
    pos += 4;

    const index = view.getUint32(pos, true);
    pos += 4;

    const nameBytes = data.slice(pos, pos + 24);
    const name = readString(ArrayBufferSlice.fromView(nameBytes), 0, 24, true);
    pos += 24;

    entries.push({ typeTag, resourceIndex: index, resourceName: name });
  }

  return { fileName, count, entries };
}
