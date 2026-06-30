import { BinaryReader } from "../helpers/bytes";

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
  const r = new BinaryReader(data);
  const count = r.readUint32LE();
  const entries: ResourceEntry[] = [];

  for (let i = 0; i < count; i++) {
    const tagBytes = r.readBytes(4);
    for (let j = 0; j < 2; j++) {
      const tmp = tagBytes[j];
      tagBytes[j] = tagBytes[3 - j];
      tagBytes[3 - j] = tmp;
    }
    const typeTag = new TextDecoder().decode(tagBytes);

    const index = r.readUint32LE();
    const nameBytes = r.readBytes(24);

    const nullIdx = nameBytes.indexOf(0);
    const name = new TextDecoder().decode(
      nullIdx === -1 ? nameBytes : nameBytes.slice(0, nullIdx),
    );

    entries.push({ typeTag, resourceIndex: index, resourceName: name });
  }

  return { fileName, count, entries };
}
