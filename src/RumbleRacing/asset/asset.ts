import ArrayBufferSlice from "../../ArrayBufferSlice";
import { SHDR } from "../chunk/shoc/shdr";

export interface Asset {
  getType(): string;
  rawData(): ArrayBufferSlice;
}

export interface GenericAsset extends Asset {
  kind: "GenericAsset";
  tag: string;
  header: SHDR;
}

export function parseGenericAsset(
  buf: ArrayBufferSlice,
  tag: string,
  header: SHDR,
): GenericAsset {
  return {
    kind: "GenericAsset",
    tag,
    header,
    getType: () => tag,
    rawData: () => buf,
  };
}
