
import { clamp } from "../MathHelpers";

function clampAbs(v: number, min: number, max: number): number {
    return Math.sign(v) * clamp(Math.abs(v), min, max);
}

export function cLib_addCalc(src: number, target: number, speed: number, maxVel: number, minVel: number): number {
    const delta = (target - src);
    const vel = clampAbs(speed * delta, minVel, maxVel);
    if (Math.abs(vel) > Math.abs(delta))
        return target;
    else
        return src + vel;
}

export function cLib_addCalc2(src: number, target: number, speed: number, maxVel: number): number {
    return src + clampAbs(speed * (target - src), 0.0, maxVel);
}

export function cM_rndF(max: number): number {
    return Math.random() * max;
}

export function cM_rndFX(max: number): number {
    return 2.0 * (Math.random() * (max - 0.5));
}

export function cM_atan2s(y: number, x: number): number {
    return Math.atan2(y, x) * (0x8000 / Math.PI);
}
