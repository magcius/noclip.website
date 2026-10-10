import ArrayBufferSlice from "../../ArrayBufferSlice";
import { parseChunks } from "./chunk";

export interface Actor {
  kind: "Actor";
  actorType: number;
  x: number;
  y: number;
  z: number;
  o3dResourceIndex: number;
  raw: ArrayBufferSlice;
}

export function parseActor(buf: ArrayBufferSlice): Actor {
  const chunks = parseChunks(buf);

  const headerView = chunks[0].payload.createDataView(8);
  const actorType = headerView.getUint8(4);
  const x = headerView.getFloat32(8, true);
  const y = headerView.getFloat32(12, true);
  const z = headerView.getFloat32(16, true);

  const resourceView = chunks[1].payload.createDataView();
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
