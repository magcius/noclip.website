import ArrayBufferSlice from "../../../ArrayBufferSlice";
import { readFourCC } from "../../helpers/fourCC";

export interface SHDR {
  kind: "SHDR";
  shocIndex: number;
  assetType: string;
  assetIndex: number;
  totalDataSize: number;
  data: ArrayBufferSlice;
}

export function parseSHDR(data: ArrayBufferSlice, shocIndex: number): SHDR {
  const assetType = readFourCC(data, 4);

  const view = data.createDataView();
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
