
export function getPointCubic(cf0: number, cf1: number, cf2: number, cf3: number, t: number): number {
    return (((cf0 * t + cf1) * t + cf2) * t + cf3);
}

export function getPointHermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
    const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
    const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
    const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
    return getPointCubic(cf0, cf1, cf2, cf3, t);
}

export function getPointBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const cf0 = (p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1);
    const cf1 = (p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0);
    const cf2 = (p0 * -3) + (p1 *  3) + (p2 *  0) +  (p3 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (p2 *  0) +  (p3 *  0);
    return getPointCubic(cf0, cf1, cf2, cf3, t);
}

export function getPointBasis(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const cf0 = (p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1);
    const cf1 = (p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0);
    const cf2 = (p0 * -3) + (p1 *  0) + (p2 *  3) +  (p3 *  0);
    const cf3 = (p0 *  1) + (p1 *  4) + (p2 *  1) +  (p3 *  0);
    return getPointCubic(cf0, cf1, cf2, cf3, t)/6;
}

export function getDerivativeCubic(cf0: number, cf1: number, cf2: number, cf3: number, t: number): number {
    return (3 * cf0 * t + 2 * cf1) * t + cf2;
}

export function getDerivativeHermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
    const cf0 = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
    const cf1 = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
    const cf2 = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
    return getDerivativeCubic(cf0, cf1, cf2, cf3, t);
}

export function getDerivativeBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const cf0 = (p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1);
    const cf1 = (p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0);
    const cf2 = (p0 * -3) + (p1 *  3) + (p2 *  0) +  (p3 *  0);
    const cf3 = (p0 *  1) + (p1 *  0) + (p2 *  0) +  (p3 *  0);
    return getDerivativeCubic(cf0, cf1, cf2, cf3, t);
}

export function getDerivativeBasis(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const cf0 = (p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1);
    const cf1 = (p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0);
    const cf2 = (p0 * -3) + (p1 *  0) + (p2 *  3) +  (p3 *  0);
    const cf3 = (p0 *  1) + (p1 *  4) + (p2 *  1) +  (p3 *  0);
    return getDerivativeCubic(cf0, cf1, cf2, cf3, t)/6;
}