import ArrayBufferSlice from "../../../ArrayBufferSlice";
import { readChunkData } from "../../helpers/chunkData";
import { readFourCC } from "../../helpers/fourCC";
import { SHDR, parseSHDR } from "./shdr";
import { SDAT, parseSDAT } from "./sdat";
import { Rdat, parseRdat } from "./rdat";

export type ShocMetadata = SHDR | SDAT | Rdat;

export interface Shoc {
  kind: "SHOC";
  index: number;
  startAddress: number;
  metadata: ShocMetadata;
  data: ArrayBufferSlice;
}

function parseSubChunk(
  data: ArrayBufferSlice,
  shocIndex: number,
): ShocMetadata {
  const fourCC = readFourCC(data, 8);

  const inner = data.subarray(12);
  switch (fourCC) {
    case "SHDR":
      return parseSHDR(inner, shocIndex);
    case "SDAT":
      return parseSDAT(inner);
    case "Rdat":
      return parseRdat(inner);
    default:
      throw new Error("Unhandled SHOC sub-chunk: " + fourCC);
  }
}

export function readSHOCChunk(
  data: ArrayBufferSlice,
  view: DataView,
  cursor: { pos: number },
  startPos: number,
  index: number,
): Shoc {
  const chunkData = readChunkData(data, view, cursor);

  return {
    kind: "SHOC",
    index,
    startAddress: startPos,
    data: chunkData,
    metadata: parseSubChunk(chunkData, index),
  };
}
