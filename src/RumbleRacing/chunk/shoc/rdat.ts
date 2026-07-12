export interface Rdat {
  kind: "Rdat";
  outBufferSize: number;
  data: Uint8Array;
}

export function parseRdat(data: Uint8Array): Rdat {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = view.getUint32(0, true);
  return { kind: "Rdat", outBufferSize: size, data: data.slice(4) };
}
