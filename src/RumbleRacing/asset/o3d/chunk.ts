import ArrayBufferSlice from "../../../ArrayBufferSlice";
import { readString } from "../../../util";
import { AssetChunk } from "../chunk";
import { parseVif, VifCommand } from "./vif";

export interface ELHE_Header {
  raw: AssetChunk;
  childCount: number;
  maybeNumTextures: number;
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ELTL_TextureList {
  raw: AssetChunk;
}

export interface ELDA_Data {
  raw: AssetChunk;
}

export interface ObfChunk {
  elhe: ELHE_Header;
  eltl: ELTL_TextureList;
  elda: ELDA_Data;
}

export function parseELHE(chunk: AssetChunk): ELHE_Header {
  const base = 0x8;
  const p = chunk.payload;
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    raw: chunk,
    childCount: view.getUint16(base, true),
    maybeNumTextures: view.getInt16(base + 0x2, true),
    x: view.getFloat32(base + 0x48, true),
    y: view.getFloat32(base + 0x4c, true),
    z: view.getFloat32(base + 0x50, true),
    w: view.getFloat32(base + 0x54, true),
  };
}

export function parseELTL(chunk: AssetChunk): ELTL_TextureList {
  return { raw: chunk };
}

export function parseELDA(chunk: AssetChunk): ELDA_Data {
  return { raw: chunk };
}

export function eldaParseVif(elda: ELDA_Data): VifCommand[] {
  return parseVif(elda.raw.payload);
}

export function parseObfChunks(data: Uint8Array): ObfChunk[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: ObfChunk[] = [];
  let offset = 0;

  let currentElhe: ELHE_Header | null = null;
  let currentEltl: ELTL_TextureList | null = null;
  let currentElda: ELDA_Data | null = null;
  let chunkIndex = 0;

  while (offset < data.length) {
    if (offset + 8 > data.length) {
      throw new Error(`incomplete chunk header at offset ${offset}`);
    }

    // OBF fourcc bytes are not reversed like all of the other ones..
    const magicBytes = data.slice(offset, offset + 4);
    const magic = readString(
      ArrayBufferSlice.fromView(magicBytes),
      0,
      4,
      false,
    );
    const size = view.getUint32(offset + 4, true);
    const chunkEnd = offset + size + 8;
    if (chunkEnd > data.length) {
      throw new Error(
        `chunk size ${size} exceeds remaining data at offset ${offset}`,
      );
    }
    const payload = data.slice(offset, chunkEnd);

    const assetChunk: AssetChunk = {
      offset,
      magic: magicBytes,
      size,
      payload,
    };

    if (magic === "HEAD") {
      offset = chunkEnd;
      continue;
    }

    const typeCheck = chunkIndex % 3;
    switch (typeCheck) {
      case 0:
        if (magic !== "ELHE") throw new Error("NOT AN ELHE! Got: " + magic);
        currentElhe = parseELHE(assetChunk);
        break;
      case 1:
        if (magic !== "ELTL") throw new Error("NOT AN ELTL! Got: " + magic);
        currentEltl = parseELTL(assetChunk);
        break;
      case 2:
        if (magic !== "ELDA") throw new Error("NOT AN ELDA! Got: " + magic);
        currentElda = parseELDA(assetChunk);
        break;
    }

    offset = chunkEnd;
    chunkIndex++;

    if (currentElhe && currentEltl && currentElda) {
      chunks.push({ elhe: currentElhe, eltl: currentEltl, elda: currentElda });
      currentElhe = null;
      currentEltl = null;
      currentElda = null;
    }
  }

  return chunks;
}
