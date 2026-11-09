import ArrayBufferSlice from "../../../ArrayBufferSlice";

export interface TXDA {
  rawData: ArrayBufferSlice;
}

export function parseTXDA(buf: ArrayBufferSlice): TXDA {
  return { rawData: buf.subarray(8) };
}
