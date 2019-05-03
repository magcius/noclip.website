
import { mat4 } from "gl-matrix";

// Misc bits of 3D math.

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
