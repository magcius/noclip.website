import {
  readUint32LE,
  readUint16LE,
  readInt16LE,
  readFloat32LE,
} from "../../helpers/bytes";
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
  rawZDebug: number;
  rawZAddress: number;
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
  return {
    raw: chunk,
    childCount: readUint16LE(p, base),
    maybeNumTextures: readInt16LE(p, base + 0x2),
    x: readFloat32LE(p, base + 0x48),
    y: readFloat32LE(p, base + 0x4c),
    z: readFloat32LE(p, base + 0x50),
    w: readFloat32LE(p, base + 0x54),
    rawZDebug: readUint32LE(p, base + 0x50),
    rawZAddress: chunk.offset + base + 0x50,
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

    const magic = new TextDecoder().decode(data.slice(offset, offset + 4));
    const size = readUint32LE(data, offset + 4);
    const chunkEnd = offset + size + 8;
    if (chunkEnd > data.length) {
      throw new Error(
        `chunk size ${size} exceeds remaining data at offset ${offset}`,
      );
    }
    const payload = data.slice(offset, chunkEnd);

    const assetChunk: AssetChunk = {
      offset,
      magic: new TextEncoder().encode(magic),
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
