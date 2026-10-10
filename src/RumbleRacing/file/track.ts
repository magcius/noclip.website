import ArrayBufferSlice from "../../ArrayBufferSlice";
import { TopLevelChunk, readTopLevelChunk } from "../chunk/chunk";
import { SHDR } from "../chunk/shoc/shdr";
import { decompress } from "../chunk/shoc/decompress";
import { parseRLst, RLst, ResourceEntry } from "../asset/RLst";
import { parseActor, Actor } from "../asset/Cact";
import { parseGenericAsset, GenericAsset } from "../asset/asset";
import { parseObf, Obf } from "../asset/o3d/obf";
import { parseO3D, O3D } from "../asset/o3d/o3d";
import { parseTXF, TXF } from "../asset/txf/TXF";
import { Gmd, parseGmd } from "../asset/gmd";

export type ParsedAsset = Actor | Obf | O3D | TXF | Gmd | GenericAsset;

export interface TrackFile {
  fileName: string;
  fileSize: number;
  topLevelChunks: TopLevelChunk[];
}

export function readTrackChunks(data: ArrayBufferSlice): TopLevelChunk[] {
  const view = data.createDataView();
  const cursor = { pos: 0 };
  const chunks: TopLevelChunk[] = [];
  let chunkIndex = 0;

  while (cursor.pos < data.byteLength) {
    try {
      const chunk = readTopLevelChunk(data, view, cursor, chunkIndex);
      if (chunk === null) break;
      if (chunk.kind === "FILL") continue;
      chunks.push(chunk);
      chunkIndex++;
    } catch (e) {
      if (cursor.pos >= data.byteLength) break;
      console.warn("Unexpected error reading chunk:", e);
      break;
    }
  }

  return chunks;
}

export function parseTrackFile(
  data: ArrayBufferSlice,
  fileName: string = "unknown",
): TrackFile {
  return {
    fileName,
    fileSize: data.byteLength,
    topLevelChunks: readTrackChunks(data),
  };
}

function getHeadersForType(track: TrackFile, assetType: string): SHDR[] {
  const headers: SHDR[] = [];
  for (const chunk of track.topLevelChunks) {
    if (chunk.kind !== "SHOC") continue;
    const meta = chunk.metadata;
    if (meta.kind !== "SHDR") continue;
    if (meta.assetType === assetType) headers.push(meta);
  }
  return headers;
}

function getHeaderForResource(
  track: TrackFile,
  res: ResourceEntry,
): SHDR | null {
  for (const chunk of track.topLevelChunks) {
    if (chunk.kind !== "SHOC") continue;
    const meta = chunk.metadata;
    if (meta.kind !== "SHDR") continue;
    if (
      meta.assetType === res.typeTag &&
      meta.assetIndex === res.resourceIndex
    ) {
      return meta;
    }
  }
  return null;
}

function getDataForHeader(track: TrackFile, header: SHDR): ArrayBufferSlice {
  const assetData = new Uint8Array(header.totalDataSize);
  let written = 0;
  let shocCount = 1;

  while (written < header.totalDataSize) {
    const topLevel = track.topLevelChunks[header.shocIndex + shocCount];
    if (!topLevel) break;
    shocCount++;

    if (topLevel.kind !== "SHOC") continue;

    const meta = topLevel.metadata;

    let chunkData: ArrayBufferSlice;
    if (meta.kind === "SDAT") {
      chunkData = meta.data;
    } else if (meta.kind === "Rdat") {
      chunkData = decompress(meta.data, meta.outBufferSize);
    } else {
      throw new Error("Unhandled SHOC type: " + meta.kind);
    }

    const size = Math.min(chunkData.byteLength, header.totalDataSize - written);
    assetData.set(chunkData.createTypedArray(Uint8Array, 0, size), written);
    written += size;
  }

  return new ArrayBufferSlice(assetData.buffer, 0, written);
}

export function getResourceList(track: TrackFile): RLst {
  const combined: RLst = { fileName: track.fileName, count: 0, entries: [] };
  const headers = getHeadersForType(track, "RLst");

  for (const header of headers) {
    const data = getDataForHeader(track, header);
    const rList = parseRLst(data, track.fileName);
    combined.count += rList.count;
    combined.entries.push(...rList.entries);
  }

  return combined;
}

export function getResource(
  track: TrackFile,
  resource: ResourceEntry,
): ParsedAsset {
  const header = getHeaderForResource(track, resource);
  if (!header)
    throw new Error(`Header not found for resource ${resource.resourceName}`);
  const data = getDataForHeader(track, header);

  switch (resource.typeTag) {
    case "Cact":
      return parseActor(data);
    case "obf ":
      return parseObf(data);
    case "o3d ":
      return parseO3D(false, data, header, resource.resourceName);
    case "o3da":
      return parseO3D(true, data, header, resource.resourceName);
    case "gmd ":
      return parseGmd(data, header, resource.resourceName);
    case "txf ":
    case "txf2": {
      const name = `${resource.resourceIndex}_${resource.resourceName}`;
      return parseTXF(data, header, name);
    }
    default:
      return parseGenericAsset(data, resource.typeTag.trimEnd(), header);
  }
}
