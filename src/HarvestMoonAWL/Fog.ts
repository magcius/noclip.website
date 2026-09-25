// Outdoor fog: day/night fog-range (mapenv.lfg) and fog-color (mapenv.llt) keyframe curves.

import { Color, colorLerp, colorFromHex } from "../Color.js";
import * as GX from "../gx/gx_enum.js";
import * as Env from "./Env.js";

//#region Curve evaluation

export const FOG_TYPE = GX.FogType.PERSP_LIN;

interface Keyframe<T> {
    frame: number;
    value: T;
}

function evalCurve(keys: Keyframe<number>[], currentFrame: number): number {
    const idx = Env.bracketIndex(keys, currentFrame);
    const a = keys[idx], b = keys[(idx + 1) % keys.length];
    const span = b.frame - a.frame;
    const t = span > 0 ? (currentFrame - a.frame) / span : 0;
    return a.value + (b.value - a.value) * t;
}

//#endregion

//#region mapenv curves

const FOG_START_Z: Keyframe<number>[] = [
    { frame: 0.00, value: 0 }, { frame: 1.33, value: 0 }, { frame: 2.00, value: 20 }, { frame: 3.00, value: 80 },
    { frame: 5.00, value: 80 }, { frame: 5.67, value: 40 }, { frame: 6.33, value: 0 }, { frame: 8.00, value: 0 },
];

const FOG_END_Z: Keyframe<number>[] = [
    { frame: 0.00, value: 160 }, { frame: 1.33, value: 160 }, { frame: 2.00, value: 200 }, { frame: 3.00, value: 250 },
    { frame: 5.00, value: 250 }, { frame: 5.67, value: 200 }, { frame: 6.33, value: 160 }, { frame: 8.00, value: 160 },
];

const FOG_COLOR: Keyframe<Color>[] = [
    { frame: 0.00, value: hexColor("#192341") }, { frame: 1.33, value: hexColor("#192341") },
    { frame: 2.00, value: hexColor("#3c465a") }, { frame: 3.00, value: hexColor("#5a73b4") },
    { frame: 5.00, value: hexColor("#5a73b4") }, { frame: 5.67, value: hexColor("#38373e") },
    { frame: 6.67, value: hexColor("#192341") }, { frame: 8.00, value: hexColor("#192341") },
];

function hexColor(s: string): Color {
    const c: Color = { r: 0, g: 0, b: 0, a: 1 };
    colorFromHex(c, s);
    return c;
}

//#endregion

//#region Evaluation

export interface FogRange {
    startZ: number;
    endZ: number;
}

export function evaluateFogRange(timeSeconds: number = Env.DEFAULT_TIME_SECONDS): FogRange {
    const currentFrame = Env.dayFraction(timeSeconds) * Env.CURVE_FRAMES_PER_DAY;
    return {
        startZ: evalCurve(FOG_START_Z, currentFrame),
        endZ: evalCurve(FOG_END_Z, currentFrame),
    };
}

export function evaluateFogColor(dst: Color, timeSeconds: number = Env.DEFAULT_TIME_SECONDS): void {
    const currentFrame = Env.dayFraction(timeSeconds) * Env.CURVE_FRAMES_PER_DAY;
    const idx = Env.bracketIndex(FOG_COLOR, currentFrame);
    const a = FOG_COLOR[idx], b = FOG_COLOR[(idx + 1) % FOG_COLOR.length];
    const span = b.frame - a.frame;
    const t = span > 0 ? (currentFrame - a.frame) / span : 0;
    colorLerp(dst, a.value, b.value, t);
}

//#endregion
