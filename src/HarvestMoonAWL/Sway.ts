// Wind sway in tree canopies, bush, grass tufts and flowers

import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { transformVec3Mat4w0 } from "../MathHelpers.js";
import * as Cloud from "./Cloud.js";
import * as Env from "./Env.js";

//#region Per-block table

export const enum SwayMode {
    Static = 0,
    Sway = 1,
    BillboardSway = 2,
}

export const SWAY_MODE_BY_BLOCK: ReadonlyMap<number, SwayMode> = new Map<number, SwayMode>([
    [60, SwayMode.Sway],
    [61, SwayMode.Sway],
    [62, SwayMode.Sway],
    [63, SwayMode.Sway],
    [64, SwayMode.Sway],
    [65, SwayMode.Sway],
    [66, SwayMode.Sway],
    [67, SwayMode.Sway],
    [68, SwayMode.Sway],
    [69, SwayMode.Sway],
    [92, SwayMode.Sway],
    [95, SwayMode.Sway],
    [96, SwayMode.BillboardSway],
    [97, SwayMode.Sway],
    [99, SwayMode.Sway],
    [101, SwayMode.BillboardSway],
    [102, SwayMode.Sway],
    [104, SwayMode.Sway],
    [106, SwayMode.BillboardSway],
    [107, SwayMode.Sway],
    [109, SwayMode.Sway],
    [111, SwayMode.BillboardSway],
    [205, SwayMode.Sway],
    [206, SwayMode.Sway],
    [261, SwayMode.BillboardSway],
    [262, SwayMode.BillboardSway],
    [263, SwayMode.BillboardSway],
    [264, SwayMode.BillboardSway],
    [194, SwayMode.Sway],
    [196, SwayMode.Sway],
    [197, SwayMode.Static],
    [202, SwayMode.Static],
    [203, SwayMode.Static],
    [204, SwayMode.Static],
]);

export function swayModeForBlock(blockIndex: number): SwayMode {
    return SWAY_MODE_BY_BLOCK.get(blockIndex) ?? SwayMode.Static;
}

//#endregion

//#region Field

export const SWAY_PERIOD_FRAMES = 120;

export const SWAY_AMPLITUDE = 0.06;

export const SWAY_TILT_RAD = 1.04719758;

export const WIND_SPEED_DIVISOR = Cloud.WIND_SPEED_DIVISOR;

export function swayAmount(phaseFrames: number, windSpeed: number): number {
    const amp = SWAY_AMPLITUDE * (windSpeed / WIND_SPEED_DIVISOR);
    return amp * (1.0 + Math.sin(2 * Math.PI * (phaseFrames / SWAY_PERIOD_FRAMES))) * 0.5;
}

export function fillWindVector(dst: vec3, octant: number): void {
    const a = Cloud.windAngleRad(octant);
    vec3.set(dst, -Math.sin(a), 0, -Math.cos(a));
}

export function fillSwayBasis(dstDir: vec3, dstAxis: vec3, windOctant: number): void {
    fillWindVector(dstDir, windOctant);
    const c = Math.cos(SWAY_TILT_RAD), s = Math.sin(SWAY_TILT_RAD);
    vec3.set(dstAxis, dstDir[0] * c, -s, dstDir[2] * c);
}

export class SwayField {
    public phaseFrames = 0;

    constructor(public periodFrames: number = SWAY_PERIOD_FRAMES) {
    }

    public update(deltaSeconds: number): void {
        this.phaseFrames = (this.phaseFrames + deltaSeconds * Env.ROM_LOGIC_FPS) % this.periodFrames;
    }
}

//#endregion

//#region Pasture Grass

export const GRASS_SWAY_PERIOD_FRAMES = 60;

export const GRASS_SWAY_AMPLITUDE = 0.3;

export const GRASS_SWAY_MEASURE_AXIS: ReadonlyVec3 = vec3.fromValues(0, 1, 0);

const GRASS_ENVELOPE_BASE = 0.25;
const GRASS_ENVELOPE_SCALE = 0.75;

const GRASS_WAVE_SPACE_SCALE = 0.25;

const GRASS_WAVE_CROSS_DIVISOR = 0.7;

function frac(v: number): number {
    return v - Math.floor(v);
}

function grassWave(t: number, windDir: ReadonlyVec3, pos: ReadonlyVec3): number {
    const u = windDir[0] * pos[0] + windDir[1] * pos[1] + windDir[2] * pos[2];
    const s = (windDir[0] * pos[2] + windDir[1] * pos[1] + windDir[2] * pos[0]) / GRASS_WAVE_CROSS_DIVISOR;
    const base = t - GRASS_WAVE_SPACE_SCALE * u;
    const phase = base + GRASS_WAVE_SPACE_SCALE * Math.sin(2 * Math.PI * frac(s));
    return (1.0 + Math.sin(2 * Math.PI * frac(phase))) * 0.5;
}

export function grassSwayAmount(phaseFrames: number, windSpeed: number, windDirFrom: ReadonlyVec3, windDirTo: ReadonlyVec3, blend: number, pos: ReadonlyVec3): number {
    const amp = GRASS_SWAY_AMPLITUDE * (windSpeed / WIND_SPEED_DIVISOR);
    if (amp <= 0)
        return 0;
    const t = phaseFrames / GRASS_SWAY_PERIOD_FRAMES;
    let wave = grassWave(t, windDirFrom, pos);
    if (blend !== 0.0)
        wave += blend * (grassWave(t, windDirTo, pos) - wave);
    return (GRASS_ENVELOPE_BASE + GRASS_ENVELOPE_SCALE * wave) * amp;
}

//#endregion

//#region Applying Sway

export function applySwayViewSpace(dst: mat4, amount: number, dirView: ReadonlyVec3, axisView: ReadonlyVec3): void {
    for (let i = 0; i < 3; i++) {
        const o = i * 4;
        const d = amount * (dirView[0] * dst[o + 0] + dirView[1] * dst[o + 1] + dirView[2] * dst[o + 2]);
        dst[o + 0] += d * axisView[0];
        dst[o + 1] += d * axisView[1];
        dst[o + 2] += d * axisView[2];
    }
}

export function toViewSpace(dst: vec3, v: ReadonlyVec3, viewMatrix: ReadonlyMat4): void {
    transformVec3Mat4w0(dst, viewMatrix, v);
}

//#endregion

//#region Billboard Sway

const BILLBOARD_PROBE: ReadonlyVec3 = vec3.fromValues(0, 0, -1);
const scratchProbe = vec3.create();

export function fillBillboardYaw(dst: mat4, viewMatrix: ReadonlyMat4): void {
    transformVec3Mat4w0(scratchProbe, viewMatrix, BILLBOARD_PROBE);
    if (scratchProbe[0] === 0 && scratchProbe[2] === 0) {
        mat4.identity(dst);
    } else {
        mat4.fromYRotation(dst, -Math.atan2(-scratchProbe[0], -scratchProbe[2]));
    }
}

export function fillBillboardWorldMatrix(dst: mat4, yaw: ReadonlyMat4, placement: ReadonlyMat4): void {
    for (let i = 0; i < 3; i++) {
        const o = i * 4;
        const s = Math.hypot(placement[o + 0], placement[o + 1], placement[o + 2]);
        dst[o + 0] = yaw[o + 0] * s;
        dst[o + 1] = yaw[o + 1] * s;
        dst[o + 2] = yaw[o + 2] * s;
        dst[o + 3] = 0;
    }
    dst[12] = placement[12];
    dst[13] = placement[13];
    dst[14] = placement[14];
    dst[15] = 1;
}

//#endregion
