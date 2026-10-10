import ArrayBufferSlice from "../../../ArrayBufferSlice";

export interface CLDA {
  rawData: ArrayBufferSlice;
}

export function parseCLDA(buf: ArrayBufferSlice): CLDA {
  return { rawData: buf.subarray(8) };
}
