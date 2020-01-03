
import { clamp } from "../MathHelpers";

function clampAbs(v: number, min: number, max: number): number {
    return Math.sign(v) * clamp(Math.abs(v), min, max);
}

export function cLib_addCalc(src: number, target: number, speed: number, maxVel: number, minVel: number): number {
    return src + clampAbs(speed * (target - src), minVel, maxVel);
}

export function cLib_addCalc2(src: number, target: number, speed: number, maxVel: number): number {
    return src + clampAbs(speed * (target - src), 0.0, maxVel);
}

export function cM_rndF(max: number): number {
    return Math.random() * max;
}
