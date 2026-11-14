// Small helpers shared by several modules

import { ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { getMatrixAxisZ, getMatrixTranslation, saturate } from "../MathHelpers.js";

export function wrapMod(v: number, n: number): number {
    return ((v % n) + n) % n;
}

export function stepFade(fade: number, rising: boolean, deltaSeconds: number, fadeSeconds: number): number {
    const step = deltaSeconds / fadeSeconds;
    return saturate(fade + (rising ? step : -step));
}

export function cameraRay(dstEye: vec3, dstForward: vec3, cameraWorldMatrix: ReadonlyMat4): void {
    getMatrixTranslation(dstEye, cameraWorldMatrix);
    getMatrixAxisZ(dstForward, cameraWorldMatrix);
    vec3.negate(dstForward, dstForward);
    vec3.normalize(dstForward, dstForward);
}

export function rayBoxDistance(eye: ReadonlyVec3, dir: ReadonlyVec3, boundsMin: ReadonlyVec3, boundsMax: ReadonlyVec3): number {
    let tNear = 0, tFar = Infinity;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(dir[i]) < 1e-9) {
            if (eye[i] < boundsMin[i] || eye[i] > boundsMax[i])
                return -1;
            continue;
        }
        const inv = 1 / dir[i];
        let t0 = (boundsMin[i] - eye[i]) * inv;
        let t1 = (boundsMax[i] - eye[i]) * inv;
        if (t0 > t1)
            [t0, t1] = [t1, t0];
        tNear = Math.max(tNear, t0);
        tFar = Math.min(tFar, t1);
        if (tFar < tNear)
            return -1;
    }
    return tNear;
}
