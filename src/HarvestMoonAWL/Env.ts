// The day/night environment, based on seconds in the current day. Source files are:
// mapenv.lam (ambient)
// mapenv.llt (key light + fog color), 
// mapenv.lfg (fog start/end)

import { Color, colorFromRGBA8, colorLerp, colorNewFromRGBA } from "../Color.js";
import { vec3 } from "gl-matrix";
import { saturate } from "../MathHelpers.js";

export const DAY_SEC = 86400.0;
export const CURVE_FRAMES_PER_DAY = 8.0;

export function dayFraction(timeSeconds: number): number {
    const t = timeSeconds % DAY_SEC;
    return (t < 0 ? t + DAY_SEC : t) / DAY_SEC;
}

//#region Curve evaluation

interface ColorKeyframe {
    frame: number;
    rgba: number;
}

export function bracketIndex(keys: readonly { frame: number }[], currentFrame: number): number {
    let idx = 0;
    for (let i = 1; i < keys.length; i++)
        if (keys[i].frame <= currentFrame)
            idx = i;
    return idx;
}

const scratchColorA = colorNewFromRGBA(0, 0, 0, 1);
const scratchColorB = colorNewFromRGBA(0, 0, 0, 1);

export function evalColorCurve(dst: Color, keys: readonly ColorKeyframe[], currentFrame: number): void {
    const idx = bracketIndex(keys, currentFrame);
    const a = keys[idx], b = keys[(idx + 1) % keys.length];
    const span = b.frame - a.frame;
    const t = span > 0 ? (currentFrame - a.frame) / span : 0;
    colorFromRGBA8(scratchColorA, a.rgba);
    colorFromRGBA8(scratchColorB, b.rgba);
    colorLerp(dst, scratchColorA, scratchColorB, t);
}

//#endregion

//#region mapenv curves

// mapenv.lam's single color curve
const AMBIENT_COLOR: readonly ColorKeyframe[] = [
    { frame: 0.0000, rgba: 0x434852FF }, // 00:00
    { frame: 1.3333, rgba: 0x434852FF }, // 04:00
    { frame: 2.0000, rgba: 0x565C5DFF }, // 06:00
    { frame: 3.0000, rgba: 0xAAAAAAFF }, // 09:00
    { frame: 5.0000, rgba: 0xAAAAAAFF }, // 15:00
    { frame: 5.6667, rgba: 0x828282FF }, // 17:00
    { frame: 6.3333, rgba: 0x434852FF }, // 19:00
    { frame: 8.0000, rgba: 0x434852FF }, // 24:00
];

// mapenv.llt light color curve
const KEY_LIGHT_COLOR: readonly ColorKeyframe[] = [
    { frame: 0.0000, rgba: 0x6E7DFFFF }, // 00:00 - moonlight blue
    { frame: 1.3333, rgba: 0x6E7DFFFF }, // 04:00
    { frame: 1.6667, rgba: 0x6E7DFFFF }, // 05:00
    { frame: 1.8333, rgba: 0x000000FF }, // 05:30 - light off
    { frame: 2.0000, rgba: 0xA0A096FF }, // 06:00 - sunrise
    { frame: 3.0000, rgba: 0xFFFFC8FF }, // 09:00 - full day
    { frame: 5.0000, rgba: 0xFFFFC8FF }, // 15:00
    { frame: 5.6667, rgba: 0xFFEF00FF }, // 17:00 - golden hour
    { frame: 6.0000, rgba: 0xFFEF00FF }, // 18:00
    { frame: 6.1667, rgba: 0x000000FF }, // 18:29 - light off
    { frame: 6.4333, rgba: 0x6E7DFFFF }, // 19:18 - moonrise
    { frame: 6.6667, rgba: 0x6E7DFFFF }, // 20:00
    { frame: 8.0000, rgba: 0x6E7DFFFF }, // 24:00
];

// Key light elevation
const LIGHT_ANGLE_DEG: readonly { seconds: number; deg: number }[] = [
    { seconds: 0.0, deg: 90.0 },      // 00:00 - moon overhead
    { seconds: 18000.0, deg: 165.0 }, // 05:00 - moon setting
    { seconds: 21600.0, deg: 15.0 },  // 06:00 - sunrise
    { seconds: 64800.0, deg: 165.0 }, // 18:00 - sunset
    { seconds: 68400.0, deg: 15.0 },  // 19:00 - moonrise
    { seconds: 86400.0, deg: 90.0 },  // 24:00
];

// Projected shadow's day/night weight
const SHADOW_WEIGHT: readonly { seconds: number; value: number }[] = [
    { seconds: 0.0, value: 1.0 },     // 00:00 - moon shadows, full weight
    { seconds: 16200.0, value: 1.0 }, // 04:30
    { seconds: 18000.0, value: 0.0 }, // 05:00 - moonset; shadows gone
    { seconds: 21600.0, value: 0.0 }, // 06:00 - sunrise
    { seconds: 23400.0, value: 1.0 }, // 06:30 - sun shadows, full weight
    { seconds: 63000.0, value: 1.0 }, // 17:30
    { seconds: 64800.0, value: 0.0 }, // 18:00 - sunset; shadows gone
    { seconds: 68400.0, value: 0.0 }, // 19:00 - moonrise
    { seconds: 70200.0, value: 1.0 }, // 19:30 - moon shadows, full weight
    { seconds: 86400.0, value: 1.0 }, // 24:00
];

export function evalShadowWeight(timeSeconds: number, weatherFactor: number = 1.0): number {
    const t = timeSeconds % DAY_SEC;
    const s = t < 0 ? t + DAY_SEC : t;
    let v = SHADOW_WEIGHT[SHADOW_WEIGHT.length - 1].value;
    for (let i = 1; i < SHADOW_WEIGHT.length; i++) {
        const a = SHADOW_WEIGHT[i - 1], b = SHADOW_WEIGHT[i];
        if (s <= b.seconds) {
            const span = b.seconds - a.seconds;
            v = span > 0 ? a.value + (b.value - a.value) * ((s - a.seconds) / span) : a.value;
            break;
        }
    }
    return saturate(v * weatherFactor);
}

//#endregion

//#region Key light

// -60 degree arc tilt Sun.ts's visible disc uses.
export const TILT_RAD = -1.0471976;
// Attenuation is off, so this has to be enough that the light reads as directional over
// the whole map.
export const LIGHT_DISTANCE = 10000.0;

function evalLightAngleDeg(timeSeconds: number): number {
    const t = timeSeconds % DAY_SEC;
    const s = t < 0 ? t + DAY_SEC : t;
    for (let i = 1; i < LIGHT_ANGLE_DEG.length; i++) {
        const a = LIGHT_ANGLE_DEG[i - 1], b = LIGHT_ANGLE_DEG[i];
        if (s <= b.seconds) {
            const span = b.seconds - a.seconds;
            return span > 0 ? a.deg + (b.deg - a.deg) * ((s - a.seconds) / span) : a.deg;
        }
    }
    return 90.0;
}

export function lightWorldDirection(dst: vec3, timeSeconds: number): void {
    const theta = -evalLightAngleDeg(timeSeconds) * Math.PI / 180.0;
    const x1 = Math.sin(theta), z1 = Math.cos(theta);
    const ct = Math.cos(TILT_RAD), st = Math.sin(TILT_RAD);
    vec3.set(dst, x1 * ct, x1 * st, z1);
    vec3.normalize(dst, dst);
}

export class EnvState {
    public ambient = colorNewFromRGBA(1, 1, 1, 1);
    public keyLightColor = colorNewFromRGBA(0, 0, 0, 1);
    // World-space direction towards the light.
    public keyLightDirection = vec3.fromValues(0, 1, 0);
    public shadowWeight = 1.0;
}

// Weather touches only the key light's RGB and the shadow curve
export function evaluateEnv(dst: EnvState, timeSeconds: number, weatherLightFactor: number = 1.0): void {
    const currentFrame = dayFraction(timeSeconds) * CURVE_FRAMES_PER_DAY;
    evalColorCurve(dst.ambient, AMBIENT_COLOR, currentFrame);
    evalColorCurve(dst.keyLightColor, KEY_LIGHT_COLOR, currentFrame);
    dst.keyLightColor.r *= weatherLightFactor;
    dst.keyLightColor.g *= weatherLightFactor;
    dst.keyLightColor.b *= weatherLightFactor;
    lightWorldDirection(dst.keyLightDirection, timeSeconds);
    dst.shadowWeight = evalShadowWeight(timeSeconds, weatherLightFactor);
}

//#endregion

//#region Sky dome cross-fade

export const SKY_FRAME_DAWN = 0;
export const SKY_FRAME_DAY = 1;
export const SKY_FRAME_DUSK = 2;
export const SKY_FRAME_NIGHT = 3;

export interface SkyBlend {
    frameA: number;
    frameB: number;
    t: number;
}

// close to but not the same as the key light's timings.
export function skyBlend(dst: SkyBlend, timeSeconds: number): void {
    const t = timeSeconds % DAY_SEC;
    const s = t < 0 ? t + DAY_SEC : t;
    const set = (a: number, b: number, f: number) => {
        dst.frameA = a; dst.frameB = b; dst.t = f;
    };
    if (s < 18000.0)        // < 05:00
        set(SKY_FRAME_NIGHT, SKY_FRAME_NIGHT, 0.0);
    else if (s < 21600.0)   // 05:00 - 06:00, night -> dawn
        set(SKY_FRAME_NIGHT, SKY_FRAME_DAWN, (s - 18000.0) / 3600.0);
    else if (s < 32400.0)   // 06:00 - 09:00, dawn -> day
        set(SKY_FRAME_DAWN, SKY_FRAME_DAY, (s - 21600.0) / 10800.0);
    else if (s < 54000.0)   // 09:00 - 15:00, full day
        set(SKY_FRAME_DAY, SKY_FRAME_DAY, 0.0);
    else if (s < 64800.0)   // 15:00 - 18:00, day -> dusk
        set(SKY_FRAME_DAY, SKY_FRAME_DUSK, (s - 54000.0) / 10800.0);
    else if (s < 68400.0)   // 18:00 - 19:00, dusk -> night
        set(SKY_FRAME_DUSK, SKY_FRAME_NIGHT, (s - 64800.0) / 3600.0);
    else                    // >= 19:00
        set(SKY_FRAME_NIGHT, SKY_FRAME_NIGHT, 0.0);
}

//#endregion

//#region Clock

// 06:00 - sunrise
export const DEFAULT_TIME_SECONDS = 21600.0;

export const ROM_TIME_SCALE = 60.0;
export const ROM_LOGIC_FPS = 30.0;

// The overworld camera's C_MTXPerspective arguments
export const ROM_CAMERA_FOV_Y_DEG = 30.2;
export const ROM_CAMERA_FOV_Y = ROM_CAMERA_FOV_Y_DEG * Math.PI / 180.0;
export const ROM_CAMERA_NEAR = 0.3;
export const ROM_CAMERA_FAR = 1024.0;

// The NTSC render mode's dimensions
export const REFERENCE_EFB_WIDTH = 640;
export const REFERENCE_EFB_HEIGHT = 480;

// GX point sizes and line widths are in 1/6-pixel units
export const POINT_SIZE_UNITS_PER_PIXEL = 6.0;


export const DEFAULT_TIME_SCALE = ROM_TIME_SCALE;

export function formatClock(timeSeconds: number): string {
    const t = Math.floor(timeSeconds % DAY_SEC);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
    return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}

//#endregion
