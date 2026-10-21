import { f, sinf, cosf, sqrtf } from "./f32.js";
import { G } from "./globals.js";
import { Mtx4, Vec2f, Vec3f } from "./types.js";

const POWF_TERMS = 30;
const MTX_INVERT_EPSILON = f(1.0e-15);
const PI_F = f(3.14159265);
const HALF_PI_F = f(1.57079633);
const QUARTER_PI_F = f(0.78539816);
const EIGHTH_PI_F = f(0.39269908);
const ATAN2_STEPS = 16;
const ATAN2_TOLERANCE = f(0.005);
const RNG_MULTIPLIER = 16807;
const RNG_MASK = 0x07ffffff;

export function Powf(base: number, exponent: number): number {
    let result = 1.0;
    while (exponent >= 1.0) {
        exponent = f(exponent - 1.0);
        result = f(result * base);
    }
    if (exponent === 0.0) {
        return result;
    }
    base = f(base - 1.0);
    let term = f(exponent * base);
    let sum = f(1.0 + term);
    for (let n = 1.0; n < POWF_TERMS; ) {
        term = f(term * f(f(exponent - n) * base));
        n = f(n + 1.0);
        term = f(term / n);
        sum = f(sum + term);
    }
    return f(result * sum);
}

export function Vec3fCross(out: Vec3f, a: Vec3f, b: Vec3f): void {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;
    out.z = f(f(ax * by) - f(bx * ay));
    out.y = f(f(az * bx) - f(bz * ax));
    out.x = f(f(ay * bz) - f(by * az));
}

export function Vec3fDot(a: Vec3f, b: Vec3f): number {
    return f(f(b.z * a.z) + f(f(a.x * b.x) + f(a.y * b.y)));
}

export function Vec3fNegate(out: Vec3f, v: Vec3f): void {
    out.x = -v.x;
    out.y = -v.y;
    out.z = -v.z;
}

export function NegateVectorInPlace(v: Vec3f): void {
    v.x = -v.x;
    v.y = -v.y;
    v.z = -v.z;
}

export function Vec2fMul(out: Vec2f, a: Vec2f, b: Vec2f): void {
    out.x = f(b.x * a.x);
    out.y = f(b.y * a.y);
}

export function Vec2fScale(out: Vec2f, v: Vec2f, scale: number): void {
    out.x = f(v.x * scale);
    out.y = f(v.y * scale);
}

export function Vec3fComponentProduct(out: Vec3f, a: Vec3f, b: Vec3f): void {
    out.x = f(b.x * a.x);
    out.y = f(b.y * a.y);
    out.z = f(b.z * a.z);
}

export function Vec3fScale(out: Vec3f, v: Vec3f, scale: number): void {
    out.x = f(v.x * scale);
    out.y = f(v.y * scale);
    out.z = f(v.z * scale);
}

export function Vec3fScaleInPlace(v: Vec3f, scale: number): void {
    v.x = f(v.x * scale);
    v.y = f(v.y * scale);
    v.z = f(v.z * scale);
}

export function Vec3fScaleByInverse(out: Vec3f, v: Vec3f, divisor: number): void {
    divisor = f(1.0 / divisor);
    out.x = f(v.x * divisor);
    out.y = f(v.y * divisor);
    out.z = f(v.z * divisor);
}

export function Vec3fDivideInPlace(v: Vec3f, divisor: number): void {
    divisor = f(1.0 / divisor);
    v.x = f(v.x * divisor);
    v.y = f(v.y * divisor);
    v.z = f(v.z * divisor);
}

export function Vec3fCopy(out: Vec3f, v: Vec3f): void {
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
}

export function Vec3fDirection(out: Vec3f, from: Vec3f, to: Vec3f): void {
    const dx = f(to.x - from.x);
    const dy = f(to.y - from.y);
    const dz = f(to.z - from.z);
    let length = sqrtf(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)));
    if (length !== 0.0) {
        length = f(1.0 / length);
        out.x = f(dx * length);
        out.y = f(dy * length);
        out.z = f(dz * length);
    } else {
        out.x = 0.0;
        out.y = 0.0;
        out.z = 1.0;
    }
}

export function Vec3fNormalizeSafe(out: Vec3f, v: Vec3f): void {
    let length = sqrtf(f(f(v.z * v.z) + f(f(v.x * v.x) + f(v.y * v.y))));
    if (length !== 0.0) {
        length = f(1.0 / length);
        out.x = f(v.x * length);
        out.y = f(v.y * length);
        out.z = f(v.z * length);
    } else {
        out.x = 0.0;
        out.y = 0.0;
        out.z = 1.0;
    }
}

export function Vec3fNormalize(v: Vec3f): void {
    let length = sqrtf(f(f(v.z * v.z) + f(f(v.x * v.x) + f(v.y * v.y))));
    if (length !== 0.0) {
        length = f(1.0 / length);
        v.x = f(v.x * length);
        v.y = f(v.y * length);
        v.z = f(v.z * length);
    } else {
        v.x = 0.0;
        v.y = 0.0;
        v.z = 1.0;
    }
}

export function Vec3fSubtract(out: Vec3f, a: Vec3f, b: Vec3f): void {
    out.x = f(a.x - b.x);
    out.y = f(a.y - b.y);
    out.z = f(a.z - b.z);
}

export function Vec3fSubtractInPlace(v: Vec3f, b: Vec3f): void {
    v.x = f(v.x - b.x);
    v.y = f(v.y - b.y);
    v.z = f(v.z - b.z);
}

export function Vec2fAdd(out: Vec2f, a: Vec2f, b: Vec2f): void {
    out.x = f(b.x + a.x);
    out.y = f(b.y + a.y);
}

export function Vec3fAdd(out: Vec3f, a: Vec3f, b: Vec3f): void {
    out.x = f(b.x + a.x);
    out.y = f(b.y + a.y);
    out.z = f(b.z + a.z);
}

export function Vec3fAddInPlace(v: Vec3f, b: Vec3f): void {
    v.x = f(v.x + b.x);
    v.y = f(v.y + b.y);
    v.z = f(v.z + b.z);
}

export function Vec3fLerp(out: Vec3f, a: Vec3f, b: Vec3f, t: number): void {
    out.x = f(b.x + f(f(a.x - b.x) * t));
    out.y = f(b.y + f(f(a.y - b.y) * t));
    out.z = f(b.z + f(f(a.z - b.z) * t));
}

export function Vec3fMulAdd(out: Vec3f, a: Vec3f, b: Vec3f, scale: number): void {
    out.x = f(f(b.x * scale) + a.x);
    out.y = f(f(b.y * scale) + a.y);
    out.z = f(f(b.z * scale) + a.z);
}

export function Vec3fMulAddInPlace(v: Vec3f, b: Vec3f, scale: number): void {
    v.x = f(v.x + f(b.x * scale));
    v.y = f(v.y + f(b.y * scale));
    v.z = f(v.z + f(b.z * scale));
}

export function Vec3fMidpoint(out: Vec3f, a: Vec3f, b: Vec3f): void {
    out.x = f(f(b.x + a.x) * 0.5);
    out.y = f(f(b.y + a.y) * 0.5);
    out.z = f(f(b.z + a.z) * 0.5);
}

export function Vec3fClear(v: Vec3f): void {
    v.z = 0.0;
    v.y = 0.0;
    v.x = 0.0;
}

export function Vec2fDistance(a: Vec2f, b: Vec2f): number {
    const dx = f(a.x - b.x);
    const dy = f(a.y - b.y);
    return sqrtf(f(f(dx * dx) + f(dy * dy)));
}

export function Vec3fDistance(a: Vec3f, b: Vec3f): number {
    const dx = f(a.x - b.x);
    const dy = f(a.y - b.y);
    const dz = f(a.z - b.z);
    return sqrtf(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)));
}

export function Vec3fDistanceSquared(a: Vec3f, b: Vec3f): number {
    const dx = f(a.x - b.x);
    const dy = f(a.y - b.y);
    const dz = f(a.z - b.z);
    return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
}

export function Vec3fLength(v: Vec3f): number {
    return sqrtf(f(f(v.z * v.z) + f(f(v.x * v.x) + f(v.y * v.y))));
}

export function Vec2fLength(v: Vec2f): number {
    return sqrtf(f(f(v.y * v.y) + f(v.x * v.x)));
}

export function Vec3fRotateAroundAxis(v: Vec3f, angle: number, axis: Vec3f): void {
    const s = sinf(angle);
    const c = cosf(angle);
    const t = f(1.0 - c);
    const vx = v.x, vy = v.y, vz = v.z;
    const x = axis.x, y = axis.y, z = axis.z;
    const tx = f(t * x);
    const txy = f(tx * y);
    const sz = f(s * z);
    const txz = f(tx * z);
    const sy = f(s * y);
    const ty = f(t * y);
    const tyz = f(ty * z);
    const sx = f(s * x);
    v.x = f(f(f(f(f(tx * x) + c) * vx) + f(f(txy + sz) * vy)) + f(f(txz - sy) * vz));
    v.y = f(f(f(f(txy - sz) * vx) + f(f(f(f(t * y) * y) + c) * vy)) + f(f(tyz + sx) * vz));
    v.z = f(f(f(f(sy + txz) * vx) + f(f(tyz - sx) * vy)) + f(f(f(f(t * z) * z) + c) * vz));
}

function rowSum(x: number, y: number, z: number, m: Mtx4, c: number): number {
    return f(f(f(x * m[0][c]) + f(y * m[1][c])) + f(z * m[2][c]));
}

export function Mtx4x4ProjectPoint(out: Vec3f, input: Vec3f, m: Mtx4): void {
    const x = input.x, y = input.y, z = input.z;
    const inverseW = f(1.0 / f(rowSum(x, y, z, m, 3) + m[3][3]));
    out.x = f(f(rowSum(x, y, z, m, 0) + m[3][0]) * inverseW);
    out.y = f(f(rowSum(x, y, z, m, 1) + m[3][1]) * inverseW);
    out.z = f(f(rowSum(x, y, z, m, 2) + m[3][2]) * inverseW);
}

export function Vec3fTransformByMatrix(out: number[], input: Vec3f, m: Mtx4): void {
    const x = input.x, y = input.y, z = input.z;
    for (let i = 0; i < 4; i++) {
        out[i] = f(rowSum(x, y, z, m, i) + m[3][i]);
    }
}

export function Vec3sTransformToVec4f(out: number[], input: number[], m: Mtx4): void {
    const x = input[0], y = input[1], z = input[2];
    for (let i = 0; i < 4; i++) {
        out[i] = f(rowSum(x, y, z, m, i) + m[3][i]);
    }
}

export function ProjectVec3fToScreen(out: Vec2f, input: Vec3f, m: Mtx4): void {
    const x = input.x, y = input.y, z = input.z;
    const inverseW = f(1.0 / f(rowSum(x, y, z, m, 3) + m[3][3]));
    out.x = f(f(rowSum(x, y, z, m, 0) + m[3][0]) * inverseW);
    out.y = f(f(rowSum(x, y, z, m, 1) + m[3][1]) * inverseW);
}

export function Mtx4x4TransformNoTranslation(out: Vec3f, input: Vec3f, m: Mtx4): void {
    const x = input.x, y = input.y, z = input.z;
    const inverseW = f(1.0 / f(rowSum(x, y, z, m, 3) + m[3][3]));
    out.x = f(rowSum(x, y, z, m, 0) * inverseW);
    out.y = f(rowSum(x, y, z, m, 1) * inverseW);
    out.z = f(rowSum(x, y, z, m, 2) * inverseW);
}

export function Mtx3x3TransformVec(out: Vec3f, input: Vec3f, m: Mtx4): void {
    const x = input.x, y = input.y, z = input.z;
    out.x = rowSum(x, y, z, m, 0);
    out.y = rowSum(x, y, z, m, 1);
    out.z = rowSum(x, y, z, m, 2);
}

export function Mtx4x4Multiply(out: Mtx4, a: Mtx4, b: Mtx4): void {
    const product: number[][] = [[], [], [], []];
    for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
            let sum = 0.0;
            for (let i = 0; i < 4; i++) {
                sum = f(sum + f(a[row][i] * b[i][column]));
            }
            product[row][column] = sum;
        }
    }
    for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
            out[row][column] = product[row][column];
        }
    }
}

export function Mtx4fTranspose(out: Mtx4, input: Mtx4): void {
    for (const [row, column] of [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
    ]) {
        const temp = input[row][column];
        out[row][column] = input[column][row];
        out[column][row] = temp;
    }
}

export function CopyMatrix4x4(out: Mtx4, input: Mtx4): void {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            out[r][c] = input[r][c];
        }
    }
}

export function MtxInvert4x4(out: Mtx4, input: Mtx4): number {
    let negative = 0.0;
    let positive = 0.0;
    const add = (term: number): void => {
        if (term >= 0.0) {
            positive = f(positive + term);
        } else {
            negative = f(negative + term);
        }
    };
    add(f(f(input[0][0] * input[1][1]) * input[2][2]));
    add(f(f(input[0][1] * input[1][2]) * input[2][0]));
    add(f(f(input[0][2] * input[1][0]) * input[2][1]));
    add(f(f(-input[0][2] * input[1][1]) * input[2][0]));
    add(f(f(-input[0][1] * input[1][0]) * input[2][2]));
    add(f(f(-input[0][0] * input[1][2]) * input[2][1]));
    let determinant = f(positive + negative);
    let precision = f(determinant / f(positive - negative));
    if (precision < 0.0) {
        precision = -precision;
    }
    if (determinant === 0.0 || precision < MTX_INVERT_EPSILON) {
        return 0;
    }
    determinant = f(1.0 / determinant);
    const minor = (a: number, b: number, c: number, d: number): number => f(f(a * b) - f(c * d));
    const m = input;
    out[0][0] = f(minor(m[1][1], m[2][2], m[1][2], m[2][1]) * determinant);
    out[1][0] = f(-minor(m[1][0], m[2][2], m[1][2], m[2][0]) * determinant);
    out[2][0] = f(minor(m[1][0], m[2][1], m[1][1], m[2][0]) * determinant);
    out[0][1] = f(-minor(m[0][1], m[2][2], m[0][2], m[2][1]) * determinant);
    out[1][1] = f(minor(m[0][0], m[2][2], m[0][2], m[2][0]) * determinant);
    out[2][1] = f(-minor(m[0][0], m[2][1], m[0][1], m[2][0]) * determinant);
    out[0][2] = f(minor(m[0][1], m[1][2], m[0][2], m[1][1]) * determinant);
    out[1][2] = f(-minor(m[0][0], m[1][2], m[0][2], m[1][0]) * determinant);
    out[2][2] = f(minor(m[0][0], m[1][1], m[0][1], m[1][0]) * determinant);
    for (let c = 0; c < 3; c++) {
        out[3][c] = -f(f(f(m[3][0] * out[0][c]) + f(m[3][1] * out[1][c])) + f(m[3][2] * out[2][c]));
    }
    out[0][3] = 0.0;
    out[1][3] = 0.0;
    out[2][3] = 0.0;
    out[3][3] = 1.0;
    return 1;
}

export function Atan2f(x: number, y: number): number {
    let base = 0.0;
    let direct = true;
    let swap: number;
    if (y < 0.0) {
        x = -x;
        y = -y;
        base = f(base + PI_F);
    }
    if (x < 0.0) {
        swap = x;
        x = y;
        y = -swap;
        base = f(base + HALF_PI_F);
    }
    if (x < y) {
        swap = x;
        x = y;
        y = swap;
        direct = false;
        base = f(base + QUARTER_PI_F);
    }
    const length = sqrtf(f(f(y * y) + f(x * x)));
    if (length === 0.0) {
        return 0.0;
    }
    y = f(y / length);
    let angle = EIGHTH_PI_F;
    let step = f(angle * 0.5);
    for (let i = 0; i < ATAN2_STEPS; ) {
        const s = sinf(angle);
        i++;
        if (s < y) {
            if (f(y - s) < ATAN2_TOLERANCE) {
                break;
            }
            angle = f(angle + step);
        } else if (y < s) {
            if (f(s - y) < ATAN2_TOLERANCE) {
                break;
            }
            angle = f(angle - step);
        } else {
            break;
        }
        step = f(step * 0.5);
    }
    if (direct) {
        base = f(base + angle);
    } else {
        base = f(base + f(QUARTER_PI_F - angle));
    }
    return base;
}

function triangleSides(point: Vec3f, v0: Vec3f, v1: Vec3f, v2: Vec3f, normal: Vec3f, tolerance: number): boolean {
    const edge01 = { x: 0, y: 0, z: 0 };
    const toV1 = { x: 0, y: 0, z: 0 };
    const edge12 = { x: 0, y: 0, z: 0 };
    const edge20 = { x: 0, y: 0, z: 0 };
    const toV0 = { x: 0, y: 0, z: 0 };
    const cross = { x: 0, y: 0, z: 0 };
    Vec3fSubtract(edge01, v1, v0);
    Vec3fSubtract(toV1, point, v1);
    Vec3fCross(cross, edge01, toV1);
    if (Vec3fDot(cross, normal) < tolerance) {
        return false;
    }
    Vec3fSubtract(edge12, v2, v1);
    Vec3fCross(cross, edge12, toV1);
    if (Vec3fDot(cross, normal) < tolerance) {
        return false;
    }
    Vec3fSubtract(edge20, v0, v2);
    Vec3fSubtract(toV0, point, v0);
    Vec3fCross(cross, edge20, toV0);
    return !(Vec3fDot(cross, normal) < tolerance);
}

export function PointInTriangle3D(point: Vec3f, v0: Vec3f, v1: Vec3f, v2: Vec3f, normal: Vec3f): number {
    return triangleSides(point, v0, v1, v2, normal, 0.0) ? 1 : 0;
}

export function IsPointInsideTriangle(point: Vec3f, v0: Vec3f, v1: Vec3f, v2: Vec3f, normal: Vec3f, tolerance: number): number {
    return triangleSides(point, v0, v1, v2, normal, tolerance) ? 1 : 0;
}

function side(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
    return f(f(f(px - ax) * f(by - ay)) - f(f(bx - ax) * f(py - ay)));
}

export function TestLineSegmentIntersection(p1: Vec2f, p2: Vec2f, q1: Vec2f, q2: Vec2f): number {
    if ((p2.x < p1.x ? p1.x : p2.x) < (q1.x < q2.x ? q1.x : q2.x)) {
        return 0;
    }
    if ((q2.x < q1.x ? q1.x : q2.x) < (p1.x < p2.x ? p1.x : p2.x)) {
        return 0;
    }
    if ((p2.y < p1.y ? p1.y : p2.y) < (q1.y < q2.y ? q1.y : q2.y)) {
        return 0;
    }
    if ((q2.y < q1.y ? q1.y : q2.y) < (p1.y < p2.y ? p1.y : p2.y)) {
        return 0;
    }
    const side1 = side(p1.x, p1.y, p2.x, p2.y, q1.x, q1.y);
    const side2 = side(p1.x, p1.y, p2.x, p2.y, q2.x, q2.y);
    if (side1 !== 0.0 && side2 !== 0.0 && f(side1 * side2) > 0.0) {
        return 0;
    }
    const side3 = side(q1.x, q1.y, q2.x, q2.y, p1.x, p1.y);
    const side4 = side(q1.x, q1.y, q2.x, q2.y, p2.x, p2.y);
    if (side3 !== 0.0 && side4 !== 0.0 && f(side3 * side4) > 0.0) {
        return 0;
    }
    if (side1 === side2) {
        return 2;
    }
    return 1;
}

export function SegmentCrossesLine2D(a: Vec3f, b: Vec3f, p: Vec3f, q: Vec3f): number {
    const side1 = side(a.x, a.y, b.x, b.y, p.x, p.y);
    const side2 = side(a.x, a.y, b.x, b.y, q.x, q.y);
    if (side1 !== 0.0 && side2 !== 0.0 && f(side1 * side2) > 0.0) {
        return 0;
    }
    if (side1 === side2) {
        return 2;
    }
    return 1;
}

export function SetRngSeed(seed: number): void {
    G.g_dwRandomSeed = seed >>> 0;
}

export function AdvanceRng(): number {
    G.g_dwRandomSeed = (Math.imul(G.g_dwRandomSeed, RNG_MULTIPLIER) & RNG_MASK) >>> 0;
    return G.g_dwRandomSeed;
}
