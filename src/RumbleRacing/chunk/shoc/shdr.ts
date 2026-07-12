import { readFourCC } from "../../helpers/fourCC";

export interface SHDR {
  kind: "SHDR";
  shocIndex: number;
  assetType: string;
  assetIndex: number;
  totalDataSize: number;
  data: Uint8Array;
}

export function parseSHDR(data: Uint8Array, shocIndex: number): SHDR {
  const assetType = readFourCC(data, 4);

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const index = view.getUint32(8, true);
  const size = view.getUint32(12, true);

  return {
    kind: "SHDR",
    shocIndex,
    assetType,
    assetIndex: index,
    totalDataSize: size,
    data,
  };
}
