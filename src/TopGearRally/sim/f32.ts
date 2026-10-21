export const f = Math.fround;

const SIN_P = [1.0, -0.16666659550427756, 0.008333066246082155, -0.0001980960290193795, 2.605780637968037e-6];
const RPI = 0.3183098861837907;
const PIO2_HI = 3.141592621803284;
const PIO2_LO = 3.178650954705639e-8;

const bitsF32 = new Float32Array(1);
const bitsU32 = new Uint32Array(bitsF32.buffer);

function exponentRange(x: number): number {
    bitsF32[0] = x;
    return (bitsU32[0] >>> 22) & 0x1ff;
}

function round(d: number): number {
    return Math.trunc(d >= 0.0 ? d + 0.5 : d - 0.5);
}

function poly(dx: number): number {
    const xsq = dx * dx;
    const p = ((SIN_P[4] * xsq + SIN_P[3]) * xsq + SIN_P[2]) * xsq + SIN_P[1];
    return dx + dx * xsq * p;
}

export function sinf(x: number): number {
    x = f(x);
    const xpt = exponentRange(x);
    if (xpt < 0xff) {
        if (xpt >= 0xe6) {
            return f(poly(x));
        }
        return x;
    }
    if (xpt < 0x136) {
        const n = round(x * RPI);
        let dx = x - n * PIO2_HI;
        dx = dx - n * PIO2_LO;
        const result = poly(dx);
        return (n & 1) === 0 ? f(result) : -f(result);
    }
    if (x !== x) {
        return NaN;
    }
    return 0;
}

export function cosf(x: number): number {
    x = f(x);
    const xpt = exponentRange(x);
    if (xpt < 0x136) {
        const xabs = x > 0 ? x : -x;
        const n = round(xabs * RPI + 0.5);
        const dn = n - 0.5;
        let dx = xabs - dn * PIO2_HI;
        dx = dx - dn * PIO2_LO;
        const result = poly(dx);
        return (n & 1) === 0 ? f(result) : -f(result);
    }
    if (x !== x) {
        return NaN;
    }
    return 0;
}

export function sqrtf(x: number): number {
    return f(Math.sqrt(x));
}

export function s32(x: number): number {
    return Math.trunc(x) | 0;
}

export function s16(x: number): number {
    return (Math.trunc(x) << 16) >> 16;
}

export function s8(x: number): number {
    return (Math.trunc(x) << 24) >> 24;
}

export function u8(x: number): number {
    return Math.trunc(x) & 0xff;
}

export function u16(x: number): number {
    return Math.trunc(x) & 0xffff;
}

export function u32(x: number): number {
    return Math.trunc(x) >>> 0;
}
