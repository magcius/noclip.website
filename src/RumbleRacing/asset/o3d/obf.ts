import {
  ObfChunk,
  parseObfChunks,
  ELHE_Header,
  ELTL_TextureList,
  ELDA_Data,
  eldaParseVif,
} from "./chunk";
import { getGeometry, Geometry, TextureMeta } from "./geometry";
import { readUint32LE } from "../../helpers/bytes";

export interface NodeMetadata {
  x: number;
  y: number;
  z: number;
  w: number;
  rawZDebug: string;
  rawZAddress: number;
  dataLen: number;
  headerOffset: number;
  textureMetadata: TextureMeta;
}

export interface ObfNode {
  rawChunk: ObfChunk;
  metadata: NodeMetadata;
  geometry: Geometry;
  parent: ObfNode | null;
  lastChild: ObfNode | null;
  prevSibling: ObfNode | null;
  child: ObfNode | null;
}

export interface Obf {
  kind: "Obf";
  rawBytes: Uint8Array;
  rawObfChunks: ObfChunk[];
  rootNode: ObfNode;
}

function buildTextureMetadata(
  elhe: ELHE_Header,
  eltl: ELTL_TextureList,
  elda: ELDA_Data,
): TextureMeta {
  const meta: TextureMeta = {
    numTextures: elhe.maybeNumTextures,
    textureEntries: [],
  };

  if (elhe.maybeNumTextures <= 0) return meta;

  const eltlData = eltl.raw.payload.slice(8);
  const eldaData = elda.raw.payload.slice(8);

  for (let i = 0; i < elhe.maybeNumTextures; i++) {
    let offset = readUint32LE(eltlData, i * 4);
    offset *= 4;
    const textureId = readUint32LE(eldaData, offset);
    meta.textureEntries.push({ eldaOffset: offset, textureId });
  }

  return meta;
}

function buildTree(
  node: ObfNode,
  currDataIndex: number,
  data: ObfChunk[],
): number {
  const raw = data[currDataIndex];
  node.rawChunk = raw;

  node.metadata.x = raw.elhe.x;
  node.metadata.y = raw.elhe.y;
  node.metadata.z = raw.elhe.z;
  node.metadata.w = raw.elhe.w;
  node.metadata.dataLen = raw.elda.raw.payload.length;
  node.metadata.headerOffset = raw.elhe.raw.offset;
  node.metadata.rawZDebug = raw.elhe.rawZDebug.toString(16).padStart(8, "0");
  node.metadata.rawZAddress = raw.elhe.rawZAddress;
  node.metadata.textureMetadata = buildTextureMetadata(
    raw.elhe,
    raw.eltl,
    raw.elda,
  );

  const vifCommands = eldaParseVif(raw.elda);
  node.geometry = getGeometry(vifCommands, node.metadata.textureMetadata);

  let nodeCount = 1;

  if (raw.elhe.childCount !== 0) {
    let lastChild: ObfNode | null = null;
    let nextDataIndex = currDataIndex + 1;

    for (let i = 0; i < raw.elhe.childCount; i++) {
      const childNode: ObfNode = {
        rawChunk: data[nextDataIndex],
        metadata: {
          x: 0,
          y: 0,
          z: 0,
          w: 0,
          rawZDebug: "",
          rawZAddress: 0,
          dataLen: 0,
          headerOffset: 0,
          textureMetadata: { numTextures: 0, textureEntries: [] },
        },
        geometry: { buffers: [] },
        parent: node,
        lastChild: null,
        prevSibling: i === 0 ? null : lastChild,
        child: null,
      };

      lastChild = childNode;
      node.lastChild = childNode;

      const childNodeCount = buildTree(childNode, nextDataIndex, data);
      nextDataIndex += childNodeCount;
      nodeCount += childNodeCount;
    }
  }

  return nodeCount;
}

export function parseObf(buf: Uint8Array): Obf {
  const obfBytes = buf.slice(0x18);
  const chunks = parseObfChunks(obfBytes);

  const rootNode: ObfNode = {
    rawChunk: chunks[0],
    metadata: {
      x: 0,
      y: 0,
      z: 0,
      w: 0,
      rawZDebug: "",
      rawZAddress: 0,
      dataLen: 0,
      headerOffset: 0,
      textureMetadata: { numTextures: 0, textureEntries: [] },
    },
    geometry: { buffers: [] },
    parent: null,
    lastChild: null,
    prevSibling: null,
    child: null,
  };

  buildTree(rootNode, 0, chunks);

  return { kind: "Obf", rawBytes: buf, rawObfChunks: chunks, rootNode };
}
