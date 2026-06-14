import { BinaryReader } from "../helpers/bytes";
import { TopLevelChunk, readTopLevelChunk } from "../chunk/chunk";
import { SHDR } from "../chunk/shoc/shdr";
import { decompress } from "../chunk/shoc/decompress";
import { parseRLst, RLst, ResourceEntry } from "../asset/RLst";
import { parseActor, Actor } from "../asset/Cact";
import { parseTxtR, TxtR } from "../asset/TxtR";
import { parseGenericAsset, GenericAsset } from "../asset/asset";
import { parseObf, Obf } from "../asset/o3d/obf";
import { parseO3D, O3D } from "../asset/o3d/o3d";
import { parseTXF, TXF } from "../asset/txf/TXF";

export type ParsedAsset = Actor | Obf | O3D | TXF | TxtR | GenericAsset;

export interface TrackFile {
  fileName: string;
  fileSize: number;
  topLevelChunks: TopLevelChunk[];
}

export function readTrackChunks(data: Uint8Array): TopLevelChunk[] {
  const r = new BinaryReader(data);
  const chunks: TopLevelChunk[] = [];
  let chunkIndex = 0;

  while (!r.eof()) {
    if (r.tell() >= data.length) break;
    try {
      const chunk = readTopLevelChunk(r, chunkIndex);
      if (chunk === null) break;
      if (chunk.kind === "FILL") continue;
      chunks.push(chunk);
      chunkIndex++;
    } catch (e) {
      if (r.eof()) break;
      console.warn("Unexpected error reading chunk:", e);
      break;
    }
  }

  return chunks;
}

export function parseTrackFile(
  data: Uint8Array,
  fileName: string = "unknown",
): TrackFile {
  return {
    fileName,
    fileSize: data.length,
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

function getDataForHeader(track: TrackFile, header: SHDR): Uint8Array {
  let assetData: number[] = [];
  let shocCount = 1;

  while (true) {
    const topLevel = track.topLevelChunks[header.shocIndex + shocCount];
    if (!topLevel) break;

    if (topLevel.kind !== "SHOC") {
      shocCount++;
      continue;
    }

    const meta = topLevel.metadata;

    if (meta.kind === "SDAT") {
      for (const b of meta.data) assetData.push(b);
    } else if (meta.kind === "Rdat") {
      const decompressed = decompress(meta.data, meta.outBufferSize);
      for (const b of decompressed) assetData.push(b);
    } else {
      throw new Error("Unhandled SHOC type: " + meta.kind);
    }

    shocCount++;
    if (assetData.length >= header.totalDataSize) break;
  }

  return new Uint8Array(assetData);
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
    case "TxtR":
      return parseTxtR(data, header);
    case "Cact":
      return parseActor(data);
    case "obf ":
      return parseObf(data);
    case "o3d ":
      return parseO3D(false, data, header, resource.resourceName);
    case "o3da":
      return parseO3D(true, data, header, resource.resourceName);
    case "txf ":
    case "txf2": {
      const name = `${resource.resourceIndex}_${resource.resourceName}`;
      return parseTXF(data, header, name);
    }
    default:
      return parseGenericAsset(data, resource.typeTag.trimEnd(), header);
  }
}
