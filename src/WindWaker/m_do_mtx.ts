import { vec3, mat4, quat, ReadonlyVec3, vec2, vec4 } from "gl-matrix";
import { saturate, Vec3UnitY, Vec3Zero, computeModelMatrixS, computeMatrixWithoutTranslation, clamp, transformVec3Mat4w0, Vec3One, Vec3UnitZ, computeModelMatrixR, transformVec3Mat4w1, scaleMatrix, lerp } from "../MathHelpers.js";

export const kUshortTo2PI = Math.PI / 0x7FFF;

// The game uses unsigned shorts to index into cos/sin tables.
// The max short value (2^16-1 = 65535) corresponds to 2PI
export function uShortTo2PI(x: number) {
    return x * kUshortTo2PI;
}

export function mDoMtx_XrotS(dst: mat4, n: number): void {
    computeModelMatrixR(dst, n * kUshortTo2PI, 0, 0);
}

export function mDoMtx_XrotM(dst: mat4, n: number): void {
    mat4.rotateX(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_YrotS(dst: mat4, n: number): void {
    computeModelMatrixR(dst, 0, n * kUshortTo2PI, 0);
}

export function mDoMtx_YrotM(dst: mat4, n: number): void {
    mat4.rotateY(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_ZrotS(dst: mat4, n: number): void {
    computeModelMatrixR(dst, 0, 0, n * kUshortTo2PI);
}

export function mDoMtx_ZrotM(dst: mat4, n: number): void {
    mat4.rotateZ(dst, dst, n * kUshortTo2PI);
}

export function mDoMtx_ZXYrotM(dst: mat4, v: vec3): void {
    mat4.rotateY(dst, dst, v[1] * kUshortTo2PI);
    mat4.rotateX(dst, dst, v[0] * kUshortTo2PI);
    mat4.rotateZ(dst, dst, v[2] * kUshortTo2PI);
}

export function mDoMtx_XYZrotM(dst: mat4, v: vec3): void {
    mat4.rotateZ(dst, dst, v[2] * kUshortTo2PI);
    mat4.rotateY(dst, dst, v[1] * kUshortTo2PI);
    mat4.rotateX(dst, dst, v[0] * kUshortTo2PI);
}

export const calc_mtx = mat4.create();

export function MtxTrans(pos: vec3, concat: boolean, m: mat4 = calc_mtx): void {
    if (concat) {
        mat4.translate(m, m, pos);
    } else {
        mat4.fromTranslation(m, pos);
    }
}

export function MtxPosition(dst: vec3, src: ReadonlyVec3 = dst, m: mat4 = calc_mtx): void {
    transformVec3Mat4w1(dst, m, src);
}

export function quatM(q: quat, dst = calc_mtx, scratch = scratchMat4a): void {
    mat4.fromQuat(scratch, q);
    mat4.mul(dst, dst, scratch);
}

export const scratchMat4a = mat4.create();
export const scratchVec3a = vec3.create();
export const scratchVec3b = vec3.create();
export const scratchVec3c = vec3.create();