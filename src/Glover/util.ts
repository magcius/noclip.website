export function subtractAngles(a: number, b: number): number {
    let diff = a - b;
    if (a <= Math.PI) {
        return diff + 2*Math.PI;
    } else if (diff > Math.PI) {
        return diff - 2*Math.PI;
    } else {
        return diff;
    }
}

export function radianModulo(theta: number): number {
    if (theta > 2*Math.PI) {
        theta -=  2*Math.PI;
    }
    if (theta >= 0) {
        return theta;
    } else {
        return theta + 2*Math.PI;
    }
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
