export interface SDAT {
  kind: "SDAT";
  data: Uint8Array;
}

export function parseSDAT(data: Uint8Array): SDAT {
  return { kind: "SDAT", data };
}
