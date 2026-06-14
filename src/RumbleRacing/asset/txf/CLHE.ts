import { readUint32LE, readUint16LE } from "../../helpers/bytes";

export interface CLHEEntry {
  cldaStartOffset: number;
  unk2: number;
  vramDest: number;
  clutImageSizeLookup: number;
  pixelFormat: number;
}

export interface CLHE {
  entries: CLHEEntry[];
}

export function parseCLHE(buf: Uint8Array): CLHE {
  buf = buf.slice(8);
  const entries: CLHEEntry[] = [];

  for (let i = 0; i + 0xc <= buf.length; i += 0xc) {
    const data = buf.slice(i, i + 0xc);
    entries.push({
      cldaStartOffset: readUint32LE(data, 0),
      unk2: readUint16LE(data, 0x4),
      vramDest: readUint16LE(data, 0x6),
      clutImageSizeLookup: readUint16LE(data, 0x8),
      pixelFormat: readUint16LE(data, 0xa),
    });
  }

  return { entries };
}
