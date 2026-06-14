import { SHDR } from "../../chunk/shoc/shdr";
import { readUint32LE } from "../../helpers/bytes";
import { HEAD, parseHEAD } from "./HEAD";
import { ZTHE, parseZTHE } from "./ZTHE";
import { CLHE, parseCLHE } from "./CLHE";
import { TXDA, parseTXDA } from "./TXDA";
import { CLDA, parseCLDA } from "./CLDA";
import { Texture, extractTexturesFromZTHE } from "./texture";

export interface TXF {
  kind: "TXF";
  rawData: Uint8Array;
  resourceName: string;
  shocHeader: SHDR;
  header: HEAD;
  textureHeaders: ZTHE[];
  clutHeader: CLHE;
  textureData: TXDA;
  clutData: CLDA;
}

function splitTaggedChunks(buf: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const tag = buf.slice(offset, offset + 4);
    const size = readUint32LE(buf, offset + 4);
    offset += 8;

    if (offset + size > buf.length) {
      throw new Error(`invalid size ${size} at offset ${offset}`);
    }

    const data = buf.slice(offset, offset + size);
    offset += size;

    const chunk = new Uint8Array(8 + data.length);
    chunk.set(tag, 0);
    chunk.set(buf.slice(offset - size - 4, offset - size), 4);
    chunk.set(data, 8);
    chunks.push(chunk);
  }

  return chunks;
}

export function parseTXF(buf: Uint8Array, hdr: SHDR, resName: string): TXF {
  const chunks = splitTaggedChunks(buf.slice(8));

  let header: HEAD | null = null;
  const textureHeaders: ZTHE[] = [];
  let clutHeader: CLHE | null = null;
  let textureData: TXDA | null = null;
  let clutData: CLDA | null = null;

  for (const chunk of chunks) {
    const tag = new TextDecoder().decode(chunk.slice(0, 4));

    switch (tag) {
      case "HEAD":
        if (header !== null) throw new Error("multiple HEAD in TXF file");
        header = parseHEAD(chunk);
        break;
      case "ZTHE":
        textureHeaders.push(parseZTHE(chunk));
        break;
      case "CLHE":
        if (clutHeader !== null) throw new Error("multiple CLHE in TXF file");
        clutHeader = parseCLHE(chunk);
        break;
      case "TXDA":
        if (textureData !== null) throw new Error("multiple TXDA in TXF file");
        textureData = parseTXDA(chunk);
        break;
      case "CLDA":
        if (clutData !== null) throw new Error("multiple CLDA in TXF file");
        clutData = parseCLDA(chunk);
        break;
      default:
        throw new Error("Unknown TXF chunk tag: " + tag);
    }
  }

  if (!header || !clutHeader || !textureData || !clutData) {
    throw new Error("TXF missing required chunks");
  }

  return {
    kind: "TXF",
    rawData: buf,
    resourceName: resName,
    shocHeader: hdr,
    header,
    textureHeaders,
    clutHeader,
    textureData,
    clutData,
  };
}

export function getTextures(txf: TXF): Texture[] {
  const textures: Texture[] = [];

  for (let i = 0; i < txf.textureHeaders.length; i++) {
    const zthe = txf.textureHeaders[i];
    for (let j = 0; j < zthe.textures.length; j++) {
      const tex = zthe.textures[j];
      const clhe = txf.clutHeader.entries[tex.clutHeaderIndex];
      const extracted = extractTexturesFromZTHE(txf, clhe, tex, i, j, tex.clutHeaderIndex);
      textures.push(...extracted);
    }
  }

  return textures;
}
