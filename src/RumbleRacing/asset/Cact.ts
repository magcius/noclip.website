import { parseChunks } from "./chunk";
import { readFloat32LE, readUint32LE } from "../helpers/bytes";

export interface Actor {
  kind: "Actor";
  actorType: number;
  x: number;
  y: number;
  z: number;
  o3dResourceIndex: number;
  raw: Uint8Array;
}

export function parseActor(buf: Uint8Array): Actor {
  const chunks = parseChunks(buf);

  const header = chunks[0].payload.slice(8);

  const actorType = header[4];
  const x = readFloat32LE(header, 8);
  const y = readFloat32LE(header, 12);
  const z = readFloat32LE(header, 16);

  const resource = chunks[1];
  const o3dResourceIndex = readUint32LE(resource.payload, 0x10);

  return {
    kind: "Actor",
    actorType,
    x,
    y,
    z,
    o3dResourceIndex,
    raw: buf,
  };
}
