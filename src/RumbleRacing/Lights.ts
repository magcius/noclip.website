import { vec3 } from "gl-matrix";
import { GlowDef, GlowShape, glowColorFromRGBA32 } from "./Glow";
import { GlowLight } from "./asset/gmd";

const CORE_SCALE = 0.5;
const STAR_OUTER_SCALE = 1.5;
const HALO_SCALE = 0.4;
const HALO_HALF_WIDTH = 0.015625;
const RING_SHAPE = GlowShape.Ring32;

export function buildGlowDefs(light: GlowLight, scale: number): GlowDef[] {
  const center = vec3.scale(vec3.create(), light.position, scale);
  const radius = light.radius * scale;

  const colorA = glowColorFromRGBA32(light.colorA);
  const colorB = glowColorFromRGBA32(light.colorB);
  const defs: GlowDef[] = [];

  if (light.core)
    defs.push({
      center,
      colorA,
      colorB,
      radiusA: 0.0,
      radiusB: CORE_SCALE * radius * light.core,
      angle: 0.0,
      shape: RING_SHAPE,
    });

  if (light.star)
    defs.push({
      center,
      colorA,
      colorB,
      radiusA: radius,
      radiusB: STAR_OUTER_SCALE * radius,
      angle: 0.0,
      shape: GlowShape.Star1 + (light.star - 1),
    });

  if (light.halo) {
    const ring = HALO_SCALE * radius * light.halo;
    const width = HALO_HALF_WIDTH * scale;
    for (const outer of [ring + width, ring - width])
      defs.push({
        center,
        colorA,
        colorB,
        radiusA: ring,
        radiusB: outer,
        angle: 0.0,
        shape: RING_SHAPE,
      });
  }

  return defs;
}
