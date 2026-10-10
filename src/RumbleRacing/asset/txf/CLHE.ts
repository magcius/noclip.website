import ArrayBufferSlice from "../../../ArrayBufferSlice";
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

export function parseCLHE(buf: ArrayBufferSlice): CLHE {
  const body = buf.subarray(8);
  const view = body.createDataView();
  const entries: CLHEEntry[] = [];

  for (let i = 0; i + 0xc <= body.byteLength; i += 0xc) {
    entries.push({
      cldaStartOffset: view.getUint32(i, true),
      vramDest: view.getUint16(i + 0x6, true),
      clutImageSizeLookup: view.getUint16(i + 0x8, true),
      pixelFormat: view.getUint16(i + 0xa, true),
    });
  }

  return { entries };
}
