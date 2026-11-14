// The sun's arc, lens flare, ray burst and screen flash.

import { mat4, vec3, vec4, ReadonlyVec3 } from "gl-matrix";
import { ViewerRenderInput } from "../viewer.js";
import * as Env from "./Env.js";
import { Rng } from "./Rng.js";
import { stepFade } from "./Util.js";

//#region Daily Arc

export const ARC_RADIUS = 450.0;
export const SUNRISE_SEC = 21600.0;    // 06:00, angle=0
export const HALF_SIZE = 30.0;
export const SUN_IMAGE_INDEX = 0;

export const FLARE_TABLE: [number, number][] = [-111, 84, 93, 100, 136, 168, 216, 239, 245, 252, 283, 341, 392]
    .map((raw, i): [number, number] => [i + 1, (raw - 0xA8) / 168.0]);

const scratchVec3 = vec3.create();

export function sunLocalPosition(out: vec3, timeSeconds: number, phaseOffsetRad: number = 0): void {
    let angle = 2 * Math.PI * (timeSeconds - SUNRISE_SEC) / Env.DAY_SEC;
    if (angle >= Math.PI)
        angle -= 2 * Math.PI;

    const theta = -(angle + phaseOffsetRad);
    const x1 = ARC_RADIUS * Math.sin(theta);
    const z1 = ARC_RADIUS * Math.cos(theta);

    const ct = Math.cos(Env.TILT_RAD), st = Math.sin(Env.TILT_RAD);
    out[0] = x1 * ct;
    out[1] = x1 * st;
    out[2] = z1;
}

export function arcCenterPosition(out: vec3, viewerInput: ViewerRenderInput): void {
    mat4.getTranslation(out, viewerInput.camera.worldMatrix);
    out[1] = 0;
}

export function arcWorldPosition(out: vec3, viewerInput: ViewerRenderInput, timeSeconds: number, phaseOffsetRad: number = 0): void {
    sunLocalPosition(scratchVec3, timeSeconds, phaseOffsetRad);
    arcCenterPosition(out, viewerInput);
    vec3.add(out, out, scratchVec3);
}

export function sunWorldPosition(out: vec3, viewerInput: ViewerRenderInput, timeSeconds: number): void {
    arcWorldPosition(out, viewerInput, timeSeconds, 0);
}

const scratchVec4 = vec4.create();

export function projectToNdc(ndc: [number, number], worldPos: ReadonlyVec3, viewerInput: ViewerRenderInput): boolean {
    vec4.set(scratchVec4, worldPos[0], worldPos[1], worldPos[2], 1.0);
    vec4.transformMat4(scratchVec4, scratchVec4, viewerInput.camera.clipFromWorldMatrix);
    if (scratchVec4[3] <= 0.001)
        return false;
    ndc[0] = scratchVec4[0] / scratchVec4[3];
    ndc[1] = scratchVec4[1] / scratchVec4[3];
    return true;
}

//#endregion


//#region Flare Visibility

export const FLARE_FALLOFF_RADIUS = 240.0;

export const FLARE_FADE_FRAMES = 30;

export const FLARE_FADE_SECONDS = FLARE_FADE_FRAMES / Env.ROM_LOGIC_FPS;

export function flareCentreFalloff(ndc: readonly [number, number], sunWorldY: number, viewerInput: ViewerRenderInput): number {
    // zeroes effect below the horizon.
    if (sunWorldY <= 0.0)
        return 0.0;
    const k = ndcPerFramebufferPixel(viewerInput);
    const dx = ndc[0] * viewerInput.camera.aspect / k;
    const dy = ndc[1] / k;
    const dist = Math.hypot(dx, dy);
    if (dist >= FLARE_FALLOFF_RADIUS)
        return 0.0;
    return (FLARE_FALLOFF_RADIUS - dist) / FLARE_FALLOFF_RADIUS;
}

export function stepFlareFade(fade: number, rising: boolean, deltaSeconds: number): number {
    return stepFade(fade, rising, deltaSeconds, FLARE_FADE_SECONDS);
}

export function flareIntensity(curveA: number, curveC: number, fade: number, falloff: number): number {
    return curveC * (curveA * fade) * falloff;
}

//#endregion

//#region Ray Burst + Screen Flash

export const REGISTER_START_SEC = 21600.0;
export const REGISTER_END_SEC = 64800.0;

export function isRegistered(timeSeconds: number): boolean {
    return timeSeconds >= REGISTER_START_SEC && timeSeconds < REGISTER_END_SEC;
}

export const RAY_COUNT = 20;

export const RAY_RIM_RADIUS_PIXELS = 2.0;

export const RAY_BASE_LENGTH_PIXELS = 60.0;

export const RAY_PHASE_FRAMES = 40;

export const RAY_ANGLE_STEP_TURNS = 0.3141592741012573;

export const RAY_ANGLE_JITTER_MILLITURNS = 157;

export const RAY_LENGTH_SEASON_SCALE: number[] = [0.7, 1.0, 0.6, 0.3];

export interface RaySpoke {
    angleTurns: number;
    lengthWeight: number;
    phaseTurns: number;
}

export function makeRaySpokes(rng: Rng): RaySpoke[] {
    const spokes: RaySpoke[] = [];
    for (let i = 0; i < RAY_COUNT; i++) {
        const jitter = rng.range(-RAY_ANGLE_JITTER_MILLITURNS, RAY_ANGLE_JITTER_MILLITURNS) / 1000.0;
        spokes.push({
            angleTurns: RAY_ANGLE_STEP_TURNS * i + jitter,
            lengthWeight: (rng.range(0, 500) + 500) / 1000.0,
            phaseTurns: rng.range(0, 1000) / 1000.0,
        });
    }
    return spokes;
}

export function stepRayPhase(phaseFrames: number, deltaSeconds: number): number {
    const advanced = phaseFrames + deltaSeconds * Env.ROM_LOGIC_FPS;
    return advanced - Math.floor(advanced / RAY_PHASE_FRAMES) * RAY_PHASE_FRAMES;
}

export function rayLengthPixels(spoke: RaySpoke, phaseFrames: number, seasonScale: number): number {
    const s = Math.sin(2 * Math.PI * (spoke.phaseTurns + phaseFrames / RAY_PHASE_FRAMES));
    const w = spoke.lengthWeight * seasonScale;
    return RAY_BASE_LENGTH_PIXELS * (1.0 + w * (0.75 + 0.25 * s));
}

export function rayIntensity(curveA: number, curveC: number, fade: number): number {
    return curveC * (curveA * fade);
}

export const FLASH_MAX_INTENSITY = 0.5;

export function flashIntensity(flare: number): number {
    return Math.min(FLASH_MAX_INTENSITY, flare);
}

const ROM_TAN_HALF_FOV = Math.tan(Env.ROM_CAMERA_FOV_Y / 2);

export function ndcPerFramebufferPixel(viewerInput: ViewerRenderInput): number {
    return ROM_TAN_HALF_FOV / ((Env.REFERENCE_EFB_HEIGHT / 2) * Math.tan(viewerInput.camera.fovY / 2));
}

export function halfExtentNdcX(pixels: number, viewerInput: ViewerRenderInput): number {
    return pixels * ndcPerFramebufferPixel(viewerInput) / viewerInput.camera.aspect;
}

export function halfExtentNdcY(pixels: number, viewerInput: ViewerRenderInput): number {
    return pixels * ndcPerFramebufferPixel(viewerInput);
}

export function fillRayMatrix(dst: mat4, sunNdc: readonly [number, number], spoke: RaySpoke, lengthPixels: number, viewerInput: ViewerRenderInput): void {
    const theta = 2 * Math.PI * spoke.angleTurns;
    const c = Math.cos(theta), s = Math.sin(theta);
    const k = ndcPerFramebufferPixel(viewerInput);
    const sx = k / viewerInput.camera.aspect, sy = -k;
    mat4.identity(dst);
    dst[0] = lengthPixels * c * sx;
    dst[1] = lengthPixels * s * sy;
    dst[4] = -s * sx;
    dst[5] = c * sy;
    dst[12] = sunNdc[0];
    dst[13] = sunNdc[1];
}

//#endregion
