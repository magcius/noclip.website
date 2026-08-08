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
  data: Uint8Array;
}

function parseSubChunk(data: Uint8Array, shocIndex: number): ShocMetadata {
  const fourCC = readFourCC(data, 8);

  const inner = data.slice(12);
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
  data: Uint8Array,
  view: DataView,
  cursor: { pos: number },
  startPos: number,
  index: number,
): Shoc {
  const chunkSize = view.getUint32(cursor.pos, true);
  cursor.pos += 4;
  const chunkData = data.slice(cursor.pos, cursor.pos + (chunkSize - 8));
  cursor.pos += chunkSize - 8;

  return {
    kind: "SHOC",
    index,
    startAddress: startPos,
    data: chunkData,
    metadata: parseSubChunk(chunkData, index),
  };
}
