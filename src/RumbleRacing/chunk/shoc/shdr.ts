import { reverseBytesInPlace, readUint32LE } from "../../helpers/bytes";

export interface SHDR {
  kind: "SHDR";
  shocIndex: number;
  assetType: string;
  assetIndex: number;
  totalDataSize: number;
  data: Uint8Array;
}

export function parseSHDR(data: Uint8Array, shocIndex: number): SHDR {
  const fourCCbytes = data.slice(4, 8);
  reverseBytesInPlace(fourCCbytes);
  const assetType = new TextDecoder().decode(fourCCbytes);

  const index = readUint32LE(data, 8);
  const size = readUint32LE(data, 12);

  return {
    kind: "SHDR",
    shocIndex,
    assetType,
    assetIndex: index,
    totalDataSize: size,
    data,
  };
}
