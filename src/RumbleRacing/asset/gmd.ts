import { vec3 } from "gl-matrix";
import { Color, colorNewFromRGBA } from "../../Color";
import { readFourCC } from "../helpers/fourCC";
import { SHDR } from "../chunk/shoc/shdr";
import { parseChunks } from "./chunk";

// Gmd files are their own thing.
// they are not related to the 'Gmd' chunks found in O3Ds other than by sharing the same name.
export interface Gmd {
  kind: "Gmd";
  lights: TrackLightData | null;
}

export function parseGmd(buf: Uint8Array, header: SHDR, resName: string): Gmd {
  const gmd: Gmd = {
    kind: "Gmd",
    lights: null,
  };

  const chunks = parseChunks(buf);

  for (const chunk of chunks) {
    const magic = readFourCC(chunk.magic, 0);
    switch (magic) {
      case "Ligh":
        gmd.lights = parseTrackLights(chunk.payload);
        break;
      default:
        // console.warn("Unhandled Trck MAGIC: " + magic + " " + resName);
        break;
    }
  }

  return gmd;
}

const LIGHT_STRIDE = 0x20;
const LIGH_GLOW_COUNT = 0x08;
const LIGH_POINT_COUNT = 0x0c;

export interface GlowLight {
  position: vec3;
  radius: number;
  colorA: number;
  colorB: number;
  core: number;
  star: number;
  halo: number;
}

export interface PointLight {
  position: vec3;
  radius: number;
  color: Color;
  next: number;
}

export interface TrackLightData {
  glows: GlowLight[];
  points: PointLight[];
}

function parseTrackLights(data: Uint8Array): TrackLightData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const glowCount = view.getUint32(LIGH_GLOW_COUNT, true);
  const pointCount = view.getUint32(LIGH_POINT_COUNT, true);
  const dataStartOffset = 0x10;

  const position = (at: number): vec3 =>
    vec3.fromValues(
      view.getFloat32(at + 0x0, true),
      view.getFloat32(at + 0x4, true),
      view.getFloat32(at + 0x8, true),
    );

  const glows: GlowLight[] = [];
  for (let i = 0; i < glowCount; i++) {
    const at = dataStartOffset + i * LIGHT_STRIDE;
    const shape = view.getUint8(at + 0x18);
    glows.push({
      position: position(at),
      radius: view.getFloat32(at + 0xc, true),
      colorA: view.getUint32(at + 0x10, false),
      colorB: view.getUint32(at + 0x14, false),
      core: shape & 0x3,
      star: (shape >>> 2) & 0x7,
      halo: (shape >>> 5) & 0x3,
    });
  }

  const points: PointLight[] = [];
  const pointBase = glowCount * LIGHT_STRIDE;
  for (let i = 0; i < pointCount; i++) {
    const at = pointBase + i * LIGHT_STRIDE;
    points.push({
      position: position(at),
      radius: view.getFloat32(at + 0xc, true),
      color: colorNewFromRGBA(
        view.getFloat32(at + 0x10, true),
        view.getFloat32(at + 0x14, true),
        view.getFloat32(at + 0x18, true),
      ),
      next: view.getInt32(at + 0x1c, true),
    });
  }

  return { glows, points };
}
