import { reverseBytesInPlace, BinaryReader } from "../../helpers/bytes";
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
  const fourCCbytes = data.slice(8, 12);
  reverseBytesInPlace(fourCCbytes);
  const fourCC = new TextDecoder().decode(fourCCbytes);

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
  r: BinaryReader,
  startPos: number,
  index: number,
): Shoc {
  const chunkSize = r.readUint32LE();
  const data = r.readBytes(chunkSize - 8);

  return {
    kind: "SHOC",
    index,
    startAddress: startPos,
    data,
    metadata: parseSubChunk(data, index),
  };
}
