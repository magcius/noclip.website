
import { ReadonlyVec3, vec3 } from "gl-matrix";
import { clamp, MathConstants, normToLength } from "../MathHelpers.js";

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

export function cLib_addCalc0(src: number, speed: number, maxVel: number): number {
    return cLib_addCalc2(src, 0.0, speed, maxVel);
}

export function cLib_addCalcAngleRad(src: number, target: number, speed: number, maxVel: number, minVel: number): number {
    if (speed === 0.0)
        return src;

    const da = (target - src) % MathConstants.TAU;
    const delta = (2*da) % MathConstants.TAU - da;
    const vel = clampAbs(delta / speed, minVel, maxVel);
    if (Math.abs(vel) > Math.abs(delta))
        return target;
    else
        return src + vel;
}

export function cLib_addCalcAngleRad2(src: number, target: number, speed: number, maxVel: number): number {
    if (speed === 0.0)
        return src;

    const da = (target - src) % MathConstants.TAU;
    const delta = (2*da) % MathConstants.TAU - da;
    const vel = clampAbs(delta / speed, 0.0, maxVel);
    if (Math.abs(vel) > Math.abs(delta))
        return target;
    else
        return src + vel;
}

export function cLib_addCalcAngleS(src: number, target: number, speed: number, maxVel: number, minVel: number): number {
    if (speed === 0.0)
        return src;

    // this is not accurate
    const da = (target - src) % 0xFFFF;
    const delta = (2*da) % 0xFFFF - da;
    const vel = clampAbs(delta / speed, 0.0, maxVel);
    if (Math.abs(vel) > Math.abs(delta))
        return target;
    else
        return src + vel;
}

export function cLib_addCalcAngleS_(src: number, target: number, scale: number, maxVel: number, minVel: number): number {
    let diff = (target - src) % 0xFFFF;
    if (src !== target) {
        let step = (diff / scale) % 0xFFFF;
        if (step > minVel || step < -minVel) {
            if (step > maxVel)
                step = maxVel;

            if (step < -maxVel)
                step = -maxVel;

            src += step;
        }
    } else {
        if (0 <= diff) {
            src += minVel;
            diff = target - src;

            if (0 >= diff)
                src = target;
        } else {
            src -= minVel;
            diff = target - src;

            if (0 <= diff)
                src = target;
        }
    }

    return src;
}

export function cLib_addCalcAngleS2(src: number, target: number, speedRatio: number, maxVel: number): number {
    if (speedRatio === 0.0)
        return src;

    // this is not accurate
    const da = (target - src) % 0xFFFF;
    const delta = (2*da) % 0xFFFF - da;
    const vel = clampAbs(delta / speedRatio, 0.0, maxVel);
    if (Math.abs(vel) > Math.abs(delta))
        return target;
    else
        return src + vel;
}

export function cM_rndF(max: number): number {
    return Math.random() * max;
}

export function cM_rndFX(max: number): number {
    return 2.0 * (max * (Math.random() - 0.5));
}

export function cM_atan2s(y: number, x: number): number {
    return cM_rad2s(Math.atan2(y, x));
}

export function cM_rad2s(v: number): number {
    return v * (0x8000 / Math.PI);
}

export function cM_deg2s(v: number): number {
    return cM_rad2s(v * MathConstants.DEG_TO_RAD);
}

export function cM_s2rad(v: number): number {
    return v * (Math.PI / 0x8000);
}

export function cM_sht2d(v: number): number {
    return cM_s2rad(v) * MathConstants.RAD_TO_DEG;
}

export function cLib_targetAngleX(p0: ReadonlyVec3, p1: ReadonlyVec3): number {
    const dy = p1[1] - p0[1];
    const dist = cLib_distanceXZ(p0, p1);
    return cM_atan2s(dy, dist);
}

export function cLib_targetAngleY(p0: ReadonlyVec3, p1: ReadonlyVec3): number {
    const dx = p1[0] - p0[0];
    const dz = p1[2] - p0[2];
    return cM_atan2s(dx, dz);
}

const scratchVec3a = vec3.create();
export function cLib_addCalcPosXZ2(dst: vec3, target: ReadonlyVec3, speed: number, maxVel: number): void {
    if (dst[0] === target[0] && dst[2] === target[2])
        return;

    vec3.sub(scratchVec3a, dst, target);
    scratchVec3a[1] = 0.0;
    vec3.scale(scratchVec3a, scratchVec3a, speed);

    if (vec3.squaredLength(scratchVec3a) >= maxVel ** 2.0)
        normToLength(scratchVec3a, maxVel);

    vec3.sub(dst, dst, scratchVec3a);
}

export function cLib_chasePosXZ(dst: vec3, target: ReadonlyVec3, maxVel: number): void {
    vec3.sub(scratchVec3a, target, dst);
    scratchVec3a[1] = 0.0;

    if (vec3.squaredLength(scratchVec3a) < maxVel) {
        vec3.copy(dst, target);
    } else {
        normToLength(scratchVec3a, maxVel);
        vec3.add(dst, dst, scratchVec3a);
    }
}

// Move `value` closer to `target` by the amount specified in `step`. 
// If `value` would cross `target`, it is set to `target`. Returns 1 if value has reached the target, 0 otherwise.
export function cLib_chaseF(dst: number, target: number, step: number): number {
    if (step !== 0) {
        if (dst > target) {
            step = -step;
        }

        dst += step;

        if (step * (dst - target) >= 0) {
            dst = target;
        }
    } else if (dst === target) {
        return dst;
    }

    return dst;
}

export function cLib_distanceSqXZ(p0: ReadonlyVec3, p1: ReadonlyVec3): number {
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
    return dx*dx + dz*dz;
}

export function cLib_distanceXZ(p0: ReadonlyVec3, p1: ReadonlyVec3): number {
    return Math.sqrt(cLib_distanceSqXZ(p0, p1));
}
