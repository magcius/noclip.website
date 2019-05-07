
import { mat4 } from "gl-matrix";

// Misc bits of 3D math.

export const enum MathConstants {
    RAD_TO_DEG = 0.01745, // Math.PI / 180,
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
export function computeNormalMatrix(dst: mat4, m: mat4, isUniformScale: boolean = false): void {
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

/**
 * Returns whether matrix {@param m} has a uniform scale.
 */
export function matrixHasUniformScale(m: mat4): boolean {
    return m[0] === m[5] && m[0] === m[10];
}
