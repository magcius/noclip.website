import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readChunkData } from "../helpers/chunkData";
import { readFourCC } from "../helpers/fourCC";
import { Shoc, readSHOCChunk } from "./shoc/shoc";

export interface Ctrl {
  kind: "CTRL";
  index: number;
  startAddress: number;
  data: ArrayBufferSlice;
}

export interface Fill {
  kind: "FILL";
  index: number;
  startAddress: number;
  data: ArrayBufferSlice;
}

export interface Generic {
  kind: "GENERIC";
  fourCC: string;
  index: number;
  startAddress: number;
  data: ArrayBufferSlice;
}

export type TopLevelChunk = Ctrl | Fill | Generic | Shoc;

export function readCTRLChunk(
  data: ArrayBufferSlice,
  view: DataView,
  cursor: { pos: number },
  startPos: number,
  index: number,
): Ctrl {
  const chunkData = readChunkData(data, view, cursor);
  return { kind: "CTRL", index, startAddress: startPos, data: chunkData };
}

export function readFILLChunk(
  data: ArrayBufferSlice,
  view: DataView,
  cursor: { pos: number },
  startPos: number,
  pos: number,
  index: number,
): Fill {
  if (pos % 0x6000 === 0) {
    return {
      kind: "FILL",
      index,
      startAddress: startPos,
      data: data.subarray(pos, 0),
    };
  }
  const chunkData = readChunkData(data, view, cursor);
  return { kind: "FILL", index, startAddress: startPos, data: chunkData };
}

export function readGenericChunk(
  data: ArrayBufferSlice,
  view: DataView,
  cursor: { pos: number },
  fourCC: string,
  startPos: number,
  index: number,
): Generic {
  const chunkData = readChunkData(data, view, cursor);
  return {
    kind: "GENERIC",
    fourCC,
    index,
    startAddress: startPos,
    data: chunkData,
  };
}

export function readTopLevelChunk(
  data: ArrayBufferSlice,
  view: DataView,
  cursor: { pos: number },
  chunkIndex: number,
): TopLevelChunk | null {
  if (cursor.pos >= data.byteLength) return null;

  const startPos = cursor.pos;
  if (startPos + 4 > data.byteLength) return null;

  const fourCC = readFourCC(data, startPos);
  cursor.pos += 4;
  const pos = cursor.pos;

  switch (fourCC) {
    case "CTRL":
      return readCTRLChunk(data, view, cursor, startPos, chunkIndex);
    case "SHOC":
      return readSHOCChunk(data, view, cursor, startPos, chunkIndex);
    case "FILL":
      return readFILLChunk(data, view, cursor, startPos, pos, chunkIndex);
    default:
      return readGenericChunk(data, view, cursor, fourCC, startPos, chunkIndex);
  }
}
