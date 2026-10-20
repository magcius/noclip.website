// The moon rides the sun's arc with an offset

import { vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../viewer.js";
import * as Sun from "./Sun.js";
import { stepFade, wrapMod } from "./Util.js";
import * as Env from "./Env.js";

//#region Constants

// Added to the sun's daily angle
export const ARC_PHASE_RAD = Math.PI;

export const HALF_SIZE = 15.0;

// moon.tpl: 0 through 9 are the phases, 10 is the glare sprite
export const PHASE_COUNT = 10;
export const GLARE_IMAGE_INDEX = 10;

export const GLARE_HALF_SIZE_PIXELS = 60.0;

export const GLARE_INTENSITY_SCALE = 0.1;

export const GLARE_FADE_FRAMES = 10;
export const GLARE_FADE_SECONDS = GLARE_FADE_FRAMES / Env.ROM_LOGIC_FPS;

export const NIGHT_START_SEC = 64800.0;
export const NIGHT_END_SEC = 21600.0;

//#endregion

//#region Disc and Glare

export function isNight(timeSeconds: number): boolean {
    return timeSeconds < NIGHT_END_SEC || timeSeconds >= NIGHT_START_SEC;
}

export function moonWorldPosition(out: vec3, viewerInput: ViewerRenderInput, timeSeconds: number): void {
    Sun.arcWorldPosition(out, viewerInput, timeSeconds, ARC_PHASE_RAD);
}

// Moon phase advances once per day at noon
export function phaseImageIndex(dayIndex: number, timeSeconds: number): number {
    const day = wrapMod(dayIndex, PHASE_COUNT);
    const hour = Math.floor(timeSeconds / 3600) % 24;
    return (day + Math.floor(hour / 12) + PHASE_COUNT) % PHASE_COUNT;
}

export function stepGlareFade(fade: number, rising: boolean, deltaSeconds: number): number {
    return stepFade(fade, rising, deltaSeconds, GLARE_FADE_SECONDS);
}

export function glareIntensity(curveC: number, fade: number): number {
    return GLARE_INTENSITY_SCALE * fade * curveC;
}

//#endregion
