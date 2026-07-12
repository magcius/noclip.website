import { parseChunks } from "./chunk";

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
  const headerView = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );

  const actorType = header[4];
  const x = headerView.getFloat32(8, true);
  const y = headerView.getFloat32(12, true);
  const z = headerView.getFloat32(16, true);

  const resource = chunks[1];
  const resourceView = new DataView(
    resource.payload.buffer,
    resource.payload.byteOffset,
    resource.payload.byteLength,
  );
  const o3dResourceIndex = resourceView.getUint32(0x10, true);

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
