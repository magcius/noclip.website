
import { ReadonlyVec4, vec4 } from "gl-matrix";

/**
 * 1D cubic spline evaluation.
 */

const scratchVec4 = vec4.create();

/**
 * Evaluate a general 1D cubic spline at time {@param t}, given the coefficients provided in {@param cf}.
 *
 * All cubic splines (B-spline, Bezier, Hermite, Catmull-Rom, etc.) are cubic polynomials generated from
 * different basis functions; as such, if given the coefficients, they can generate the final point.
 *
 * This is for a 1D spline; for more traditional N-dimensional vectors, you can evaluate each dimension
 * independently, as 2D or 3D splines are just stacked 1D splines; cubic splines do not have any
 * interdependence between the different axes.
 *
 * @param cf The cubic polynomial coefficients: [cubic, square, linear, constant].
 * @param t The time t to evaluate the polynomial at.
 * @returns The evaluation of the polynomial at time t.
 */
export function getPointCubic(cf: ReadonlyVec4, t: number): number {
    return (((cf[0] * t + cf[1]) * t + cf[2]) * t + cf[3]);
}

/**
 * Evaluate the closed-form derivative of the cubic polynomial, given coefficients provided in {@param cf}.
 * 
 * @see getPointCubic
 *
 * @param cf The cubic polynomial coefficients: [cubic, square, linear, constant].
 * @param t The time t to calculate the derivative at.
 * @returns The derivative of the polynomial at time t.
 */
export function getDerivativeCubic(cf: ReadonlyVec4, t: number): number {
    return (3 * cf[0] * t + 2 * cf[1]) * t + cf[2];
}

/**
 * Calculate the coefficients for the given Cubic Hermite spline with standard parameterization.
 *
 * @param dst The output cubic coefficients
 * @param p0 Point 0
 * @param p1 Point 1
 * @param s0 Tangent 0
 * @param s1 Tangent 1
 */
export function getCoeffHermite(dst: vec4, p0: number, p1: number, s0: number, s1: number): void {
    dst[0] = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1); // Cubic
    dst[1] = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1); // Square
    dst[2] = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0); // Linear
    dst[3] = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0); // Constant
}

/**
 * Evaluate the given Cubic Hermite spline at time {@param t}.
 *
 * This is a shorthand for {@see getCoeffHermite} and {@see getPointCubic}; see
 * the documentation of those functions for more details.
 *
 * @param p0 Point 0
 * @param p1 Point 1
 * @param s0 Tangent 0
 * @param s1 Tangent 1
 * @param t The time t to evaluate the Cubic Hermite spline at.
 * @returns The evaluation of the given Cubic Hermite spline at time {@param t}.
 */
export function getPointHermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
    getCoeffHermite(scratchVec4, p0, p1, s0, s1);
    return getPointCubic(scratchVec4, t);
}

/**
 * Calcuate the derivative for the given Cubic Hermite spline at time {@param t}.
 *
 * This is a shorthand for {@see getCoeffHermite} and {@see getDerivativeCubic}; see
 * the documentation of those functions for more details.
 *
 * @param p0 Point 0
 * @param p1 Point 1
 * @param s0 Tangent 0
 * @param s1 Tangent 1
 * @param t The time t to evaluate the Cubic Hermite spline at.
 * @returns The evaluation of the given Cubic Hermite spline at time {@param t}.
 */
export function getDerivativeHermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
    getCoeffHermite(scratchVec4, p0, p1, s0, s1);
    return getDerivativeCubic(scratchVec4, t);
}

/**
 * Calculate the coefficients for the given Cubic Bezier spline with standard parameterization.
 *
 * @param dst The output cubic coefficients
 * @param p0 Point 0 (On-Curve Point)
 * @param p1 Point 1 (Off-Curve Point)
 * @param p2 Point 2 (Off-Curve Point)
 * @param p3 Point 3 (On-Curve Point)
 */
function getCoeffBezier(dst: vec4, p0: number, p1: number, p2: number, p3: number): void {
    dst[0] = (p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1);
    dst[1] = (p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0);
    dst[2] = (p0 * -3) + (p1 *  3) + (p2 *  0) +  (p3 *  0);
    dst[3] = (p0 *  1) + (p1 *  0) + (p2 *  0) +  (p3 *  0);
}

/**
 * Evaluate the given Cubic Bezier spline at time {@param t}.
 *
 * This is a shorthand for {@see getCoeffBezier} and {@see getPointCubic}; see
 * the documentation of those functions for more details.
 *
 * @param p0 Point 0 (On-Curve Point)
 * @param p1 Point 1 (Off-Curve Point)
 * @param p2 Point 2 (Off-Curve Point)
 * @param p3 Point 3 (On-Curve Point)
 * @param t The time t to evaluate the Cubic Bezier spline at.
 * @returns The evaluation of the given Cubic Bezier spline at time {@param t}.
 */
export function getPointBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBezier(scratchVec4, p0, p1, p2, p3);
    return getPointCubic(scratchVec4, t);
}

/**
 * Calcuate the derivative for the given Cubic Bezier spline at time {@param t}.
 *
 * This is a shorthand for {@see getCoeffBezier} and {@see getDerivativeCubic}; see
 * the documentation of those functions for more details.
 *
 * @param p0 Point 0
 * @param p1 Point 1
 * @param s0 Tangent 0
 * @param s1 Tangent 1
 * @param t The time t to evaluate the Cubic Hermite spline at.
 * @returns The evaluation of the given Cubic Hermite spline at time {@param t}.
 */
export function getDerivativeBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBezier(scratchVec4, p0, p1, p2, p3);
    return getDerivativeCubic(scratchVec4, t);
}

function getCoeffBspline(dst: vec4, p0: number, p1: number, p2: number, p3: number): void {
    dst[0] = ((p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1)) / 6;
    dst[1] = ((p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0)) / 6;
    dst[2] = ((p0 * -3) + (p1 *  0) + (p2 *  3) +  (p3 *  0)) / 6;
    dst[3] = ((p0 *  1) + (p1 *  4) + (p2 *  1) +  (p3 *  0)) / 6;
}

export function getPointBspline(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBspline(scratchVec4, p0, p1, p2, p3);
    return getPointCubic(scratchVec4, t);
}

export function getDerivativeBspline(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBspline(scratchVec4, p0, p1, p2, p3);
    return getDerivativeCubic(scratchVec4, t);
}

function getCoeffCatmullRom(dst: vec4, p0: number, p1: number, s0: number, s1: number, s: number = 1/2): void {
    dst[0] = (p0 * -1*s) + (p1 * (2-s)) + (s0 * (s-2))   +  (s1 *  s);
    dst[1] = (p0 *  2*s) + (p1 * (s-3)) + (s0 * (3-2*s)) +  (s1 * -s);
    dst[2] = (p0 *  -s)  + (p1 * 0)     + (s0 * s)       +  (s1 *  0);
    dst[3] = (p0 *   0)  + (p1 * 1)     + (s0 * 0)       +  (s1 *  0);
}

export function getPointCatmullRom(p0: number, p1: number, s0: number, s1: number, t: number, s: number = 1/2): number {
    getCoeffCatmullRom(scratchVec4, p0, p1, s0, s1, s);
    return getPointCubic(scratchVec4, t);
}
