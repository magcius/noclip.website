import { BinaryReader } from "../helpers/bytes";
import { Shoc, readSHOCChunk } from "./shoc/shoc";

export interface Ctrl {
  kind: "CTRL";
  index: number;
  startAddress: number;
  data: Uint8Array;
}

export interface Fill {
  kind: "FILL";
  index: number;
  startAddress: number;
  data: Uint8Array;
}

export interface Generic {
  kind: "GENERIC";
  fourCC: string;
  index: number;
  startAddress: number;
  data: Uint8Array;
}

export type TopLevelChunk = Ctrl | Fill | Generic | Shoc;

export function readCTRLChunk(
  r: BinaryReader,
  startPos: number,
  index: number,
): Ctrl {
  const chunkSize = r.readUint32LE();
  const data = r.readBytes(chunkSize - 8);
  return { kind: "CTRL", index, startAddress: startPos, data };
}

export function readFILLChunk(
  r: BinaryReader,
  startPos: number,
  pos: number,
  index: number,
): Fill {
  if (pos % 0x6000 === 0) {
    return {
      kind: "FILL",
      index,
      startAddress: startPos,
      data: new Uint8Array(0),
    };
  }
  const chunkSize = r.readUint32LE();
  const data = r.readBytes(chunkSize - 8);
  return { kind: "FILL", index, startAddress: startPos, data };
}

export function readGenericChunk(
  r: BinaryReader,
  fourCC: string,
  startPos: number,
  index: number,
): Generic {
  const chunkSize = r.readUint32LE();
  const data = r.readBytes(chunkSize - 8);
  return { kind: "GENERIC", fourCC, index, startAddress: startPos, data };
}

export function readTopLevelChunk(
  r: BinaryReader,
  chunkIndex: number,
): TopLevelChunk | null {
  if (r.eof()) return null;

  const startPos = r.tell();
  const tagBytes = r.readBytes(4);
  if (tagBytes.length < 4) return null;

  const reversed = tagBytes.slice();
  for (let i = 0; i < 2; i++) {
    const tmp = reversed[i];
    reversed[i] = reversed[3 - i];
    reversed[3 - i] = tmp;
  }
  const fourCC = new TextDecoder().decode(reversed);
  const pos = r.tell();

  switch (fourCC) {
    case "CTRL":
      return readCTRLChunk(r, startPos, chunkIndex);
    case "SHOC":
      return readSHOCChunk(r, startPos, chunkIndex);
    case "FILL":
      return readFILLChunk(r, startPos, pos, chunkIndex);
    default:
      return readGenericChunk(r, fourCC, startPos, chunkIndex);
  }
}
