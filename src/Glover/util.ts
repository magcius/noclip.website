import { vec3 } from 'gl-matrix';

export function subtractAngles(a: number, b: number): number {
    let diff = a - b;
    if (a <= -Math.PI || Math.PI < diff) {
        if (diff <= Math.PI) {
            return a - b + 2*Math.PI;
        } else {
            return a - b - 2*Math.PI;
        }
    } else {
        return diff;
    }
}

export function angularDistance(a: number, b: number): number {
  let diff = a - b;
  if (Math.abs(diff) > Math.PI) {
    if (b < a) {
      diff = b - a;
    }
    diff += 2*Math.PI;
  } else {
    if (diff <= 0.0) {
      diff = -diff;
    }
  }
  return diff;
}

export function radianModulo(theta: number): number {
    if (theta > 2*Math.PI) {
        theta -=  2*Math.PI;
    }
    if (theta < 0) {
        theta += 2*Math.PI;
    }
    return theta;
}

export function axisRotationToQuaternion(axis: [number, number, number], theta: number): [number, number, number, number] {
  let sinHalfTheta = Math.sin(theta / 2.0);
  return [
    Math.cos(theta / 2.0),
    axis[0] * sinHalfTheta,
    axis[1] * sinHalfTheta,
    axis[2] * sinHalfTheta,
  ];
}

export function radianLerp(dst: vec3, start: vec3, end: vec3, t: number) {
    for (let axis = 0; axis < 3; axis += 1) {
        let a = start[axis];
        let b = end[axis];
        if (b - a > Math.PI) {
            a += 2*Math.PI;
        } else if (a - b > Math.PI) {
            b += 2*Math.PI;
        }
        dst[axis] = a * (1-t) + b * t;
    }
}