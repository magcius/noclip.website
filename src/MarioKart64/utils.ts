import { Collision } from './collision.js';
import { vec3, mat4, ReadonlyVec3 } from 'gl-matrix';
import { hashCodeNumberFinish, hashCodeNumberUpdate } from '../HashMap.js';
import { computeModelMatrixSRT, MathConstants, Vec3Zero } from '../MathHelpers.js';
import { DELTA_TIME } from './courses.js';
import { interpS16 } from '../StarFoxAdventures/util.js';
import { Mk64ActorSpawnData, Mk64Point } from './course_data.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';

export const RadToBinAngle = 0x8000 / Math.PI;
export const BinAngleToRad = Math.PI / 0x8000;

export function readPathData(segmentBuffers: ArrayBufferSlice[], pathSegAddr: number): Mk64Point[] {
    const path: Mk64Point[] = [];
    const buffer = segmentBuffers[(pathSegAddr >>> 24)];
    const view = buffer.createDataView();
    let offs = pathSegAddr & 0xFFFFFF;
    while (true) {
        const posX = view.getInt16(offs + 0x00);
        const posY = view.getInt16(offs + 0x02);
        const posZ = view.getInt16(offs + 0x04);
        const trackSectionId = view.getInt16(offs + 0x06);
        if (posX === -0x8000)
            break;
        path.push({ pos: vec3.fromValues(posX, posY, posZ), param: trackSectionId });
        offs += 8;
    }
    return path;
}

export function readActorSpawnData(slice: ArrayBufferSlice, actorTableOffset: number, isDkJungleSpawn = false): Mk64ActorSpawnData[] {
    let spawnData: Mk64ActorSpawnData[] = [];
    let offs = actorTableOffset & 0xFFFFFF;
    const view = slice.createDataView();

    while (true) {
        const posX = view.getInt16(offs + 0x00);
        const posY = view.getInt16(offs + 0x02);
        const posZ = view.getInt16(offs + 0x04);
        const params = view.getInt16(offs + 0x06);

        if (posX === -0x8000)
            break;

        let originalPosY = posY;
        if (isDkJungleSpawn) {
            originalPosY = view.getInt16(offs + 0x08);
            offs += 0x0A;
        }
        else {
            offs += 0x08;
        }

        spawnData.push({ pos: vec3.fromValues(posX, posY, posZ), params, posY: originalPosY });
    }

    return spawnData;
}

export function crossedTime(oldTime: number, newTime: number, thresh: number = 0.5): boolean {
    return oldTime <= thresh && newTime > thresh;
}

export function calcModelMatrix(dst: mat4, pos: ReadonlyVec3, rot: ReadonlyVec3 = Vec3Zero, scale: number = 1.0): mat4 {
    computeModelMatrixSRT(dst, scale, scale, scale,
        rot[0] * BinAngleToRad,
        rot[1] * BinAngleToRad,
        rot[2] * BinAngleToRad,
        pos[0], pos[1], pos[2]);

    return dst;
}

const defaultLightZ = 120 / 0x7F;
export function rotateVectorXY(dst: vec3, rot: vec3): void {
    const sinX = Math.sin(rot[0] * BinAngleToRad);
    const cosX = Math.cos(rot[0] * BinAngleToRad);
    const sinY = Math.sin(rot[1] * BinAngleToRad);
    const cosY = Math.cos(rot[1] * BinAngleToRad);

    dst[0] = -defaultLightZ * sinY;
    dst[1] = defaultLightZ * sinX * cosY;
    dst[2] = defaultLightZ * cosX * cosY;
}

export function IsTargetInRangeXZ(targetPos: vec3, cameraPos: vec3, distance: number): boolean {
    const dx = targetPos[0] - cameraPos[0];
    const dz = targetPos[2] - cameraPos[2];

    return (dx * dx + dz * dz) <= (distance * distance);
}

export function IsTargetInRangeXYZ(targetPos: vec3, cameraPos: vec3, distance: number): boolean {
    return vec3.squaredDistance(targetPos, cameraPos) <= distance ** 2;
}


export function hashFromValues(a: number[]): number {
    let hash = 0;
    for (const value of a) {
        hash = hashCodeNumberUpdate(hash, value);
    }
    return hashCodeNumberFinish(hash);
}

export function normalizeAngle(x: number): number {
    x = x % MathConstants.TAU;
    if (x > Math.PI)
        x -= MathConstants.TAU;
    else if (x < -Math.PI)
        x += MathConstants.TAU;
    return x;
}

//func_800417B4
export function stepTowardsAngle(current: number, target: number): number {
    current &= 0xFFFF;
    target &= 0xFFFF;

    if ((current >> 8) === (target >> 8)) {
        return target;
    }

    let step;
    let diff = (target - current) & 0xFFFF;

    if (diff < 0x0400) step = 0x0080;
    else if (diff < 0x0800) step = 0x0200;
    else if (diff < 0x4000) step = 0x0400;
    else if (diff < 0x8000) step = 0x0700;
    else if (diff < 0xC000) step = -0x0700;
    else if (diff < 0xF800) step = -0x0400;
    else if (diff < 0xFC00) step = -0x0200;
    else step = -0x0080;

    return (current + (step * DELTA_TIME)) & 0xFFFF;
}

//adjust_angle
export function lerpBinAngle(rot: vec3, index: number, targetAngle: number, step: number): boolean {
    let delta = interpS16((targetAngle - rot[index]));
    const stepDelta = step * DELTA_TIME;

    if (Math.abs(delta) <= stepDelta) {
        rot[index] = targetAngle;
        return false;
    }

    rot[index] = (rot[index] + Math.sign(delta) * stepDelta);
    return true;
}

/**get_angle_between_xy*/
export function calcTargetAngleY(p0: vec3, p1: vec3): number {
    const dx = p1[0] - p0[0];
    const dz = p1[2] - p0[2];
    return (Math.atan2(dx, dz) * RadToBinAngle);
}

/**func_80041658*/
export function calcPitch(y: number, z: number): number {
    return (-Math.atan2(y, z) & 0xFFFF) * RadToBinAngle;
}

export function kmToSpeed(km: number): number {
    return (km * 18) / 216;
}

export function func_800416D8(x: number, z: number, binAngle: number): number {
    const angle = (binAngle) * BinAngleToRad;

    const cosAngle = Math.cos(angle);
    return (cosAngle * x) - (Math.sin(angle) * z);
}

export function func_80041724(x: number, z: number, binAngle: number): number {
    const angle = (binAngle) * BinAngleToRad;

    return (Math.cos(angle) * z) + (Math.sin(angle) * x);
}

/**
 * Rotates a position around a pivot point in the XZ plane by a given yaw angle.
 * 
 *func_80041658
 *
 * @param position The point to be rotated.
 * @param pivot The center point of rotation.
 * @param yaw The yaw angle.
 * @param isMirrored Mirror mode flag.
 */
export function rotatePositionAroundPivot(position: vec3, pivot: vec3, yaw: number, isMirrorMode: boolean): void {
    if (isMirrorMode) {
        yaw = -yaw;
    }

    const radY = yaw * BinAngleToRad;

    const dx = position[0] - pivot[0];
    const dz = position[2] - pivot[2];

    const sin = Math.sin(radY);
    const cos = Math.cos(radY);

    const rotatedX = ((dx * cos) + (dz * sin));
    const rotatedZ = ((dz * cos) - (dx * sin));

    position[0] = pivot[0] + rotatedX;
    position[2] = pivot[2] + rotatedZ;
}

export function setShadowSurfaceAngle(dst: vec3, col: Collision): void {
    if (!col.hasCollisionY) {
        vec3.set(dst, 0x4000, 0, 0);
        return;
    }

    dst[0] = 0x4000 + (Math.atan2(col.normalY[2], col.normalY[1]) * RadToBinAngle);
    dst[2] = (-Math.atan2(col.normalY[0], col.normalY[1])) * RadToBinAngle;
}

//func_80041924
export function isSurfaceUnderneath(col: Collision, pos: vec3): boolean {
    col.checkBoundingCollision(10, pos);

    if (col.hasCollisionY) {
        return true;
    }

    return false;
}

export function product2D(pX1: number, pY1: number, pX2: number, pY2: number, pX3: number, pY3: number): number {
    return (pX2 - pX1) * (pY3 - pY1) - (pY2 - pY1) * (pX3 - pX1);
}

export function random_int(max: number): number {
    return Math.floor(max * (random_u16() / 0xFFFF)) & 0xFFFF;
}

let gRandomSeed16 = 0;
export function random_u16(): number {
    let temp1: number;
    let temp2: number;

    if (gRandomSeed16 === 22026) {
        gRandomSeed16 = 0;
    }

    temp1 = ((gRandomSeed16 & 0x00FF) << 8) >>> 0;
    temp1 = (temp1 ^ gRandomSeed16) >>> 0;

    gRandomSeed16 = (((temp1 & 0x00FF) << 8) + ((temp1 & 0xFF00) >> 8)) >>> 0;

    temp1 = (((temp1 & 0x00FF) << 1) ^ gRandomSeed16) >>> 0;
    temp2 = ((temp1 >> 1) ^ 0xFF80) >>> 0;

    if ((temp1 & 1) === 0) {
        if (temp2 === 43605) {
            gRandomSeed16 = 0;
        } else {
            gRandomSeed16 = (temp2 ^ 0x1FF4) >>> 0;
        }
    } else {
        gRandomSeed16 = (temp2 ^ 0x8180) >>> 0;
    }

    return gRandomSeed16 & 0xFFFF;
}