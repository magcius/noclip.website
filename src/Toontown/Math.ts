import {
  type mat4,
  quat,
  type ReadonlyVec3,
  type ReadonlyVec4,
  type vec3,
} from "gl-matrix";
import { MathConstants } from "../MathHelpers";

/**
 * Convert HPR (heading, pitch, roll) in degrees to quaternion.
 * Panda3D convention (Z-up):
 *   H = rotation around up (Z)
 *   P = rotation around right (X)
 *   R = rotation around forward (Y)
 * Quaternion order: R * P * H (apply H first, then P, then R)
 */
export function hprToQuat(out: quat, hpr: ReadonlyVec3, newHpr = true): quat {
  if (newHpr) {
    // gl-matrix shortcut if we don't have to match the older Panda3D convention
    quat.fromEuler(out, hpr[1], hpr[2], hpr[0]);
    return out;
  }

  const hRad = hpr[0] * (Math.PI / 360);
  const pRad = hpr[1] * (Math.PI / 360);
  const rRad = hpr[2] * (Math.PI / 360);

  // Heading: rotation around Z
  const qH = quat.fromValues(0, 0, Math.sin(hRad), Math.cos(hRad));

  // Pitch: rotation around X
  const qP = quat.fromValues(Math.sin(pRad), 0, 0, Math.cos(pRad));

  // Roll: rotation around Y
  const qR = quat.fromValues(0, Math.sin(rRad), 0, Math.cos(rRad));

  if (newHpr) {
    // New HPR: R * P * H (apply heading first, then pitch, then roll)
    quat.multiply(out, qH, qP);
    quat.multiply(out, out, qR);
  } else {
    // Old HPR: H * P * R (apply roll first)
    quat.multiply(out, qR, qP);
    quat.multiply(out, out, qH);
  }
  return out;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Convert gl-matrix quat [x, y, z, w] -> HPR (ZXY) in degrees
 * Convention: R = Rz(H) * Rx(P) * Ry(R)
 * Returns [H, P, R] in degrees.
 */
export function quatToHpr(out: vec3, q: quat): vec3 {
  const x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];

  // Rotation matrix (row-major elements) from quaternion
  const m00 = 1 - 2 * (y * y + z * z);
  const m01 = 2 * (x * y - w * z);
  const m02 = 2 * (x * z + w * y);
  const m11 = 1 - 2 * (x * x + z * z);
  const m20 = 2 * (x * z - w * y);
  const m21 = 2 * (y * z + w * x);
  const m22 = 1 - 2 * (x * x + y * y);

  // H = atan2(-m01, m11)
  // P = asin(m21)
  // R = atan2(-m20, m22)
  const sinP = clamp(m21, -1, 1);
  const P = Math.asin(sinP);

  let H: number, R: number;

  // Gimbal lock when cos(P) ~ 0
  if (Math.abs(sinP) < 0.999999) {
    H = Math.atan2(-m01, m11);
    R = Math.atan2(-m20, m22);
  } else {
    // When P is +/- 90°, H and R are coupled; choose R = 0
    R = 0;
    // For P= +90°: H = atan2(m02, m00)
    // For P= -90°: H = -atan2(m02, m00)
    H = sinP > 0 ? Math.atan2(m02, m00) : -Math.atan2(m02, m00);
  }

  out[0] = H * MathConstants.RAD_TO_DEG;
  out[1] = P * MathConstants.RAD_TO_DEG;
  out[2] = R * MathConstants.RAD_TO_DEG;
  return out;
}

/**
 * Convert Panda3D quat [w, x, y, z] to gl-matrix [x, y, z, w]
 */
export function fromPandaQuat(out: quat, pandaQuat: ReadonlyVec4): quat {
  out[0] = pandaQuat[1];
  out[1] = pandaQuat[2];
  out[2] = pandaQuat[3];
  out[3] = pandaQuat[0];
  return out;
}

/**
 * Apply shear to an existing matrix.
 */
export function applyShear(
  mat: mat4,
  shearXY: number,
  shearXZ: number,
  shearYZ: number,
): void {
  // Shear matrix for Z-up:
  // [ 1, shearXY, shearXZ, 0 ]
  // [ 0,       1, shearYZ, 0 ]
  // [ 0,       0,       1, 0 ]
  // [ 0,       0,       0, 1 ]
  //
  // When pre-multiplied to an existing matrix, this adds:
  // - shearXY * column1 to column0
  // - shearXZ * column2 to column0
  // - shearYZ * column2 to column1

  // Column 0 += shearXY * Column 1 + shearXZ * Column 2
  mat[0] += shearXY * mat[4] + shearXZ * mat[8];
  mat[1] += shearXY * mat[5] + shearXZ * mat[9];
  mat[2] += shearXY * mat[6] + shearXZ * mat[10];

  // Column 1 += shearYZ * Column 2
  mat[4] += shearYZ * mat[8];
  mat[5] += shearYZ * mat[9];
  mat[6] += shearYZ * mat[10];
}
