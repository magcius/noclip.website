import { readUint32LE } from "../../helpers/bytes";

export interface Rdat {
  kind: "Rdat";
  outBufferSize: number;
  data: Uint8Array;
}

export function parseRdat(data: Uint8Array): Rdat {
  const size = readUint32LE(data, 0);
  return { kind: "Rdat", outBufferSize: size, data: data.slice(4) };
}
