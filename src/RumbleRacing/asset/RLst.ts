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

export function parseRLst(data: ArrayBufferSlice, fileName: string): RLst {
  const view = data.createDataView();
  let pos = 0;

  const count = view.getUint32(pos, true);
  pos += 4;

  const entries: ResourceEntry[] = [];

  for (let i = 0; i < count; i++) {
    const typeTag = readFourCC(data, pos);
    pos += 4;

    const index = view.getUint32(pos, true);
    pos += 4;

    const name = readString(data, pos, 24, true);
    pos += 24;

    entries.push({ typeTag, resourceIndex: index, resourceName: name });
  }

  return { fileName, count, entries };
}
