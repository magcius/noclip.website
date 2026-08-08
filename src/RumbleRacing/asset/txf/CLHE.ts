import { GSCLUTPixelStorageFormat } from "../../../Common/PS2/GS";

export interface CLHEEntry {
  cldaStartOffset: number;
  vramDest: number;
  clutImageSizeLookup: number;
  pixelFormat: GSCLUTPixelStorageFormat;
}

export interface CLHE {
  entries: CLHEEntry[];
}

export function parseCLHE(buf: Uint8Array): CLHE {
  buf = buf.slice(8);
  const entries: CLHEEntry[] = [];

  for (let i = 0; i + 0xc <= buf.length; i += 0xc) {
    const data = buf.slice(i, i + 0xc);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    entries.push({
      cldaStartOffset: view.getUint32(0, true),
      vramDest: view.getUint16(0x6, true),
      clutImageSizeLookup: view.getUint16(0x8, true),
      pixelFormat: view.getUint16(0xa, true),
    });
  }

  return { entries };
}
