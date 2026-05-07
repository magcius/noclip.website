/*
 * Cuts up the collision geometry from the blv file into a SegmentGroup 
 * based on a provided CollisionVisMode.
 *
 * petton-svn, 2026.
 */

import { Polygon } from "../lib/blv.js";
import { colorFromHSL, colorNewFromRGBA, Color } from "../../Color.js";
import { componentCollisionPropertyName } from "./signalgraph/SignalGraph.js";
import { sigColHue } from "./signalgraph/SignalGraphRenderer.js";
import { Segment } from "./util.js";

export const enum CollisionVisMode {
  Friction,
  SurfaceType,
  Unk4,
  Unk5,
  Unk6,
  Signals,
}

export interface SegmentGroup {
  segments: Segment[];
  color: Color;
}

const Green         = colorNewFromRGBA(0.2, 0.8, 0.2, 1);
const LightBlue     = colorNewFromRGBA(0.2, 0.6, 1, 1);
const Yellow        = colorNewFromRGBA(1, 1, 0, 1);
const Orange        = colorNewFromRGBA(1, 0.4, 0, 1);
const LightOrange   = colorNewFromRGBA(1, 0.7, 0.3, 1);
const HalfOrange    = colorNewFromRGBA(1, 0.5, 0, 1);
const LightPurple   = colorNewFromRGBA(0.5, 0.5, 1, 1);
const Pink          = colorNewFromRGBA(1, 0.5, 1, 1);
const Red           = colorNewFromRGBA(1, 0, 0, 1);
const White         = colorNewFromRGBA(1, 1, 1, 1);

const SurfaceColors: { [key: number]: Color } = {
  0: Green,
  1: HalfOrange,
  2: LightPurple,
  3: Pink,
  10: Red,
};

function getColorForValue(
  value: number,
  index: number,
  total: number,
  mode: CollisionVisMode,
): Color {
  switch (mode) {
    case CollisionVisMode.Friction:
      if (value < -1000) return Green;
      if (value < 0) return LightBlue;
      if (value === 0) return Yellow;
      if (value > 0.3) return Orange;
      return LightOrange;
    case CollisionVisMode.SurfaceType:
      return SurfaceColors[value] || White;
    case CollisionVisMode.Signals: {
      if (value < 0) return White;
      const dst = colorNewFromRGBA(0, 0, 0, 1);
      colorFromHSL(dst, sigColHue(componentCollisionPropertyName(value))/360, 0.8, 0.5);
      return dst;
    }
    default:
      // For other modes, use HSL-based rainbow coloring
      if (total === 1) return Green;
      const hue = index / total;
      const dst = colorNewFromRGBA(0, 0, 0, 1);
      colorFromHSL(dst, hue, 0.8, 0.5);
      return dst;
  }
}


/**
 * Generate collision segment groups from a polygon, colored by visualization mode.
 * Returns one group per unique value of the chosen attribute (friction, surfaceType, etc.).
 */
export function generateCollisionSegmentGroups(
  polygon: Polygon,
  mode: CollisionVisMode,
): SegmentGroup[] {
  const groupedSegments = new Map<number, Segment[]>();

  polygon.components.forEach((component, componentIndex) => {
    let value: number;
    switch (mode) {
      case CollisionVisMode.Friction:
        value = component.friction;
        break;
      case CollisionVisMode.SurfaceType:
        value = component.surfaceType;
        break;
      case CollisionVisMode.Unk4:
        value = component.unk4;
        break;
      case CollisionVisMode.Unk5:
        value = component.unk5;
        break;
      case CollisionVisMode.Unk6:
        value = component.unk6;
        break;
      case CollisionVisMode.Signals:
        value = component.onCollisionSignals ? componentIndex : -1;
        break;
      default:
        value = 0;
    }

    let segments: Segment[]|undefined = groupedSegments.get(value);
    if (segments === undefined) {
      segments = [];
      groupedSegments.set(value, segments);
    }

    for (const pair of component.indices) {
      const p1 = polygon.points[pair.value1];
      const p2 = polygon.points[pair.value2];
      segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
  });

  const uniqueValues = Array.from(groupedSegments.keys()).sort((a, b) => a - b);
  const result: SegmentGroup[] = [];

  for (let i = 0; i < uniqueValues.length; i++) {
    const value = uniqueValues[i];
    const segments = groupedSegments.get(value)!;
    const color = getColorForValue(value, i, uniqueValues.length, mode);
    result.push({ segments, color });
  }

  return result;
}