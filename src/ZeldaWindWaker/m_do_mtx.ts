
import { ReadonlyMat4, ReadonlyVec3, mat4, quat, vec3 } from "gl-matrix";
import { computeModelMatrixR, transformVec3Mat4w1 } from "../MathHelpers.js";
import { cM_s2rad } from "./SComponent.js";

export function mDoMtx_XrotS(dst: mat4, n: number): void {
    computeModelMatrixR(dst, cM_s2rad(n), 0, 0);
}

export function mDoMtx_XrotM(dst: mat4, n: number): void {
    mat4.rotateX(dst, dst, cM_s2rad(n));
}

export function mDoMtx_YrotS(dst: mat4, n: number): void {
    computeModelMatrixR(dst, 0, cM_s2rad(n), 0);
}

export function mDoMtx_YrotM(dst: mat4, n: number): void {
    mat4.rotateY(dst, dst, cM_s2rad(n));
}

export function mDoMtx_ZrotS(dst: mat4, n: number): void {
    computeModelMatrixR(dst, 0, 0, cM_s2rad(n));
}

export function mDoMtx_ZrotM(dst: mat4, n: number): void {
    mat4.rotateZ(dst, dst, cM_s2rad(n));
}

export function mDoMtx_ZXYrotM(dst: mat4, v: vec3): void {
    mat4.rotateY(dst, dst, cM_s2rad(v[1]));
    mat4.rotateX(dst, dst, cM_s2rad(v[0]));
    mat4.rotateZ(dst, dst, cM_s2rad(v[2]));
}

export function mDoMtx_XYZrotM(dst: mat4, v: vec3): void {
    mat4.rotateZ(dst, dst, cM_s2rad(v[2]));
    mat4.rotateY(dst, dst, cM_s2rad(v[1]));
    mat4.rotateX(dst, dst, cM_s2rad(v[0]));
}

export const calc_mtx = mat4.create();

export function MtxTrans(pos: ReadonlyVec3, concat: boolean, m: mat4 = calc_mtx): void {
    if (concat) {
        mat4.translate(m, m, pos);
    } else {
        mat4.fromTranslation(m, pos);
    }
}

export function MtxPosition(dst: vec3, src: ReadonlyVec3 = dst, m: mat4 = calc_mtx): void {
    transformVec3Mat4w1(dst, m, src);
}

const scratchMat4a = mat4.create();
export function quatM(q: quat, dst = calc_mtx, scratch = scratchMat4a): void {
    mat4.fromQuat(scratch, q);
    mat4.mul(dst, dst, scratch);
}
