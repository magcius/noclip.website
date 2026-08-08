import { vec3 } from "gl-matrix";
import { SHDR } from "../../chunk/shoc/shdr";
import { readFourCC } from "../../helpers/fourCC";
import { parseChunks } from "../chunk";
import { parseObf, Obf } from "./obf";

const GMD_BOX_CENTER = 0x30;
const GMD_BOX_HALF_EXTENTS = 0x40;
const GMD_SPHERE_CENTER = 0x50;
const GMD_SPHERE_RADIUS = 0x60;

export interface GmdBounds {
  boxCenter: vec3;
  boxHalfExtents: vec3;
  sphereCenter: vec3;
  sphereRadius: number;
}

export interface Gmd {
  rawData: Uint8Array;
  bounds: GmdBounds | null;
}

function readVec3(view: DataView, offset: number): vec3 {
  return vec3.fromValues(
    view.getFloat32(offset + 0x0, true),
    view.getFloat32(offset + 0x4, true),
    view.getFloat32(offset + 0x8, true),
  );
}

function parseGmdBounds(data: Uint8Array): GmdBounds | null {
  if (data.byteLength < GMD_SPHERE_RADIUS + 4) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    boxCenter: readVec3(view, GMD_BOX_CENTER),
    boxHalfExtents: readVec3(view, GMD_BOX_HALF_EXTENTS),
    sphereCenter: readVec3(view, GMD_SPHERE_CENTER),
    sphereRadius: view.getFloat32(GMD_SPHERE_RADIUS, true),
  };
}

export interface O3D {
  kind: "O3D";
  rawData: Uint8Array;
  resourceName: string;
  shocHeader: SHDR;
  isAnimated: boolean;
  gmds: Gmd[];
  obfs: Obf[];
}

export function parseO3D(
  isAnimated: boolean,
  buf: Uint8Array,
  header: SHDR,
  resName: string,
): O3D {
  const o3d: O3D = {
    kind: "O3D",
    rawData: buf,
    resourceName: resName,
    shocHeader: header,
    isAnimated,
    gmds: [],
    obfs: [],
  };

  const chunks = parseChunks(buf);

  for (const chunk of chunks) {
    const magic = readFourCC(chunk.magic, 0);
    switch (magic) {
      case "Gmd ":
        o3d.gmds.push({
          rawData: chunk.payload,
          bounds: parseGmdBounds(chunk.payload),
        });
        break;
      case "Obf ":
        o3d.obfs.push(parseObf(chunk.payload));
        break;
      case "Part":
      case "o3da":
      case "ExpF":
        break;
      default:
        console.warn("UNRECOGNIZED CHUNK MAGIC: " + magic + " " + resName);
        throw new Error("Unhandled o3d Chunk Magic: " + magic);
    }
  }

  return o3d;
}
