import ArrayBufferSlice from "../../../ArrayBufferSlice";

export interface SDAT {
  kind: "SDAT";
  data: ArrayBufferSlice;
}

export function parseSDAT(data: ArrayBufferSlice): SDAT {
  return { kind: "SDAT", data };
}
