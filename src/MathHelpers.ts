
import { mat4, vec3, vec4 } from "gl-matrix";

// Misc bits of 3D math.

export const enum MathConstants {
    DEG_TO_RAD = 0.01745, // Math.PI / 180,
    TAU = 6.283, // Math.PI * 2
    EPSILON = 0.000001,
}

/**
 * Computes a model matrix {@param dst} from given SRT parameters. Rotation is assumed
 * to be in radians.
 * 
 * This is roughly equivalent to {@link mat4.fromTranslationRotationScale}, but the
 * math is done by hand to be a bit faster, and more trustworthy.
 *
 * Note that this does *not* compute a Maya model matrix, as sometimes used by Nintendo
 * middleware.
 */
export function computeModelMatrixSRT(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
    const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

/**
 * Computes a model matrix {@param dst} from given rotation parameters. Rotation is assumed
 * to be in radians.
 * 
 * This is equivalent to {@link computeModelMatrixSRT} with the scale parameters set to
 * 1 and the translation set to 0, but it's slightly faster.
 */
export function computeModelMatrixR(dst: mat4, rotationX: number, rotationY: number, rotationZ: number): void {
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
    const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

    dst[0] =  (cosY * cosZ);
    dst[1] =  (sinZ * cosY);
    dst[2] =  (-sinY);
    dst[3] =  0.0;

    dst[4] =  (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = 0.0;
    dst[13] = 0.0;
    dst[14] = 0.0;
    dst[15] = 1.0;
}

/**
 * Computes a normal matrix into {@param dst} from model-view matrix {@param m}.
 * 
 * If the model matrix is uniformly scaled, or you do not care about artifacts
 * resulting from incorrect normal vectors, then pass true to {@param isUniformScale}.
 * This skips a potentially expensive computation with inverting and transposing
 * the resulting matrix.
 *
 * To determine whether the model matrix is uniformly scaled, the helper function
 * {@function matrixHasUniformScale} is provided.
 */
export function computeNormalMatrix(dst: mat4, m: mat4, isUniformScale?: boolean): void {
    if (isUniformScale === undefined)
        isUniformScale = matrixHasUniformScale(m);

    if (dst !== m)
        mat4.copy(dst, m);
    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;

    if (!isUniformScale) {
        mat4.invert(dst, dst);
        mat4.transpose(dst, dst);
    }
}

const scratchVec3 = vec3.create();

/**
 * Returns whether matrix {@param m} has a uniform scale.
 */
export function matrixHasUniformScale(m: mat4, v: vec3 = scratchVec3): boolean {
    mat4.getScaling(v, m);

    // Within reason.
    return (Math.abs(v[0] - v[1]) <= MathConstants.EPSILON*Math.max(1, Math.abs(v[0]), Math.abs(v[1])) &&
            Math.abs(v[0] - v[2]) <= MathConstants.EPSILON*Math.max(1, Math.abs(v[0]), Math.abs(v[2])));
}

// For reference. Please inline where used.
function compareEpsilon(a: number, b: number) {
    return Math.abs(a-b) <= MathConstants.EPSILON*Math.max(1, Math.abs(a), Math.abs(b));
}

export function texProjPerspMtx(dst: mat4, fov: number, aspect: number, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const cot = 1 / Math.tan(fov / 2);

    dst[0] = (cot / aspect) * scaleS;
    dst[4] = 0.0;
    dst[8] = -transS;
    dst[12] = 0.0;

    dst[1] = 0.0;
    dst[5] = cot * scaleT;
    dst[9] = -transT;
    dst[13] = 0.0;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = -1.0;
    dst[14] = 0.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function texEnvMtx(dst: mat4, scaleS: number, scaleT: number, transS: number, transT: number) {
    dst[0] = scaleS;
    dst[4] = 0.0;
    dst[8] = 0.0;
    dst[12] = transS;

    dst[1] = 0.0;
    dst[5] = -scaleT;
    dst[9] = 0.0;
    dst[13] = transT;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = 0.0;
    dst[14] = 1.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function computeMatrixWithoutTranslation(dst: mat4, m: mat4): void {
    mat4.copy(dst, m);
    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;
}

export function computeMatrixWithoutRotation(dst: mat4, m: mat4, v: vec3 = scratchVec3): void {
    const tx = m[12], ty = m[13], tz = m[14];
    mat4.getScaling(v, dst);
    mat4.fromScaling(dst, v);
    dst[12] = tx;
    dst[13] = ty;
    dst[14] = tz;
}

export function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

export function clampRange(v: number, lim: number): number {
    return clamp(v, -lim, lim);
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// https://gist.github.com/shaunlebron/8832585
export function lerpAngle(v0: number, v1: number, t: number): number {
    const da = (v1 - v0) % 1.0;
    const dist = (2*da) % 1.0 - da;
    return v0 + dist * t;
}
