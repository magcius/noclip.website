import ArrayBufferSlice from "../../../ArrayBufferSlice";

export interface Rdat {
  kind: "Rdat";
  outBufferSize: number;
  data: ArrayBufferSlice;
}

export function parseRdat(data: ArrayBufferSlice): Rdat {
  const view = data.createDataView();
  const size = view.getUint32(0, true);
  return { kind: "Rdat", outBufferSize: size, data: data.subarray(4) };
}
