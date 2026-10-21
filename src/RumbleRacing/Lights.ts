import { vec3 } from "gl-matrix";
import { GlowDef, GlowShape, glowColorFromRGBA32 } from "./Glow";
import { GlowLight } from "./asset/gmd";

const CORE_SCALE = 0.5;
const STAR_OUTER_SCALE = 1.5;
const HALO_SCALE = 0.4;
const HALO_HALF_WIDTH = 0.015625;
const RING_SHAPE = GlowShape.Ring32;

export function buildGlowDefs(light: GlowLight): GlowDef[] {
  const colorA = glowColorFromRGBA32(light.colorA);
  const colorB = glowColorFromRGBA32(light.colorB);
  const defs: GlowDef[] = [];

  if (light.core)
    defs.push({
      center: light.position,
      colorA,
      colorB,
      radiusA: 0.0,
      radiusB: CORE_SCALE * light.radius * light.core,
      angle: 0.0,
      shape: RING_SHAPE,
    });

  if (light.star)
    defs.push({
      center: light.position,
      colorA,
      colorB,
      radiusA: light.radius,
      radiusB: STAR_OUTER_SCALE * light.radius,
      angle: 0.0,
      shape: GlowShape.Star1 + (light.star - 1),
    });

  if (light.halo) {
    const ring = HALO_SCALE * light.radius * light.halo;
    const width = HALO_HALF_WIDTH;
    for (const outer of [ring + width, ring - width])
      defs.push({
        center: light.position,
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
