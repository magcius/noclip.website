// Night-Sky Starfield

import { Color, colorFromRGBA } from "../Color.js";
import { OqtInstance, oqtTypeId } from "./Oqt.js";
import { TplTexture } from "./Tpl.js";
import { saturate } from "../MathHelpers.js";
import * as Env from "./Env.js";

//#region Constants

// Season indexed - 0 -> Spring
export const LAYER_A_FILES = ["star0-1", "star0-2", "star0-3", "star0-4"];
export const LAYER_B_FILES = ["star1", "star2", "star3", "star4"];

export const POINT_SIZE_PER_TEXEL = 2.0;

export function pointSizePixels(tex: TplTexture): number {
    const raw = Math.min(255, Math.max(0, Math.trunc(Env.POINT_SIZE_UNITS_PER_PIXEL * (POINT_SIZE_PER_TEXEL * tex.height))));
    return raw / Env.POINT_SIZE_UNITS_PER_PIXEL;
}

export const TWINKLE_SLOT_COUNT = 8;
export const TWINKLE_PERIOD_FRAMES = 120;
export const TWINKLE_BASE = 0.75;
export const TWINKLE_AMPLITUDE = 0.25;

export function twinkleAlpha(slot: number, twinkleTicks: number, nightFactorValue: number): number {
    const cycle = (twinkleTicks % TWINKLE_PERIOD_FRAMES) / TWINKLE_PERIOD_FRAMES;
    const phase = 2 * Math.PI * (cycle + slot / TWINKLE_SLOT_COUNT);
    const a = (TWINKLE_BASE + TWINKLE_AMPLITUDE * Math.sin(phase)) * nightFactorValue;
    return saturate(a);
}

export function fillTwinkleColor(dst: Color, slot: number, twinkleTicks: number, nightFactorValue: number): void {
    colorFromRGBA(dst, 1, 1, 1, twinkleAlpha(slot, twinkleTicks, nightFactorValue));
}

export const NIGHT_RAMP_RAD = Math.PI / 12; // one hour, in arc radians

export function nightFactor(timeSeconds: number): number {
    let angle = 2 * Math.PI * (timeSeconds - 21600.0) / Env.DAY_SEC;
    if (angle >= Math.PI)
        angle -= 2 * Math.PI;
    const a = Math.PI + angle;
    if (a >= Math.PI)
        return 0.0;
    const f = Math.PI / 2 - Math.abs(a - Math.PI / 2);
    return f >= NIGHT_RAMP_RAD ? 1.0 : f / NIGHT_RAMP_RAD;
}

//#endregion


//#region Point sprites as quads

const REFERENCE_FOV_Y = Env.ROM_CAMERA_FOV_Y;
const TAN_HALF_FOV = Math.tan(REFERENCE_FOV_Y / 2);

export function starHalfSize(radius: number, pointSizePx: number): number {
    return radius * TAN_HALF_FOV * (pointSizePx / Env.REFERENCE_EFB_HEIGHT);
}

const UP: readonly [number, number, number] = [0, 1, 0];

export function starQuadCorners(pos: readonly [number, number, number], pointSizePx: number): [number, number, number][] {
    const radius = Math.hypot(pos[0], pos[1], pos[2]) || 1;
    const fx = pos[0] / radius, fy = pos[1] / radius, fz = pos[2] / radius;

    let rx = UP[1] * fz - UP[2] * fy;
    let ry = UP[2] * fx - UP[0] * fz;
    let rz = UP[0] * fy - UP[1] * fx;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-5) {
        rx = 1; ry = 0; rz = 0; rl = 1;
    }
    rx /= rl; ry /= rl; rz /= rl;

    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;

    const h = starHalfSize(radius, pointSizePx);
    const corner = (sx: number, sy: number): [number, number, number] => [
        pos[0] + (rx * sx + ux * sy) * h,
        pos[1] + (ry * sx + uy * sy) * h,
        pos[2] + (rz * sx + uz * sy) * h,
    ];
    return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

export interface StarBatch {
    imageIndex: number;
    twinkleSlot: number;
    instances: OqtInstance[];
}

export function batchStars(instances: readonly OqtInstance[], imageIndexOf: (inst: OqtInstance) => number): StarBatch[] {
    const byKey = new Map<number, StarBatch>();
    for (let i = 0; i < instances.length; i++) {
        const imageIndex = imageIndexOf(instances[i]);
        const twinkleSlot = i % TWINKLE_SLOT_COUNT;
        const key = imageIndex * TWINKLE_SLOT_COUNT + twinkleSlot;
        let batch = byKey.get(key);
        if (batch === undefined) {
            batch = { imageIndex, twinkleSlot, instances: [] };
            byKey.set(key, batch);
        }
        batch.instances.push(instances[i]);
    }
    return [...byKey.values()];
}

export function layerBImageIndex(inst: OqtInstance): number {
    return oqtTypeId(inst);
}

//#endregion
