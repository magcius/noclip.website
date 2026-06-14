export interface CLDA {
  rawData: Uint8Array;
}

export function parseCLDA(buf: Uint8Array): CLDA {
  return { rawData: buf.slice(8) };
}
