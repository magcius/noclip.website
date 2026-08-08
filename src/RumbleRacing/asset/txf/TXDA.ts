export interface TXDA {
  rawData: Uint8Array;
}

export function parseTXDA(buf: Uint8Array): TXDA {
  return { rawData: buf.slice(8) };
}
