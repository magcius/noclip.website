
import { GfxColor } from './GfxPlatform.js';

// Copied from toplevel util.ts

export function assert(b: boolean, message: string = ""): asserts b {
    if (!b) {
        console.error(new Error().stack);
        throw new Error(`Assert fail: ${message}`);
    }
}

export function assertExists<T>(v: T | null | undefined): T {
    if (v !== undefined && v !== null)
        return v;
    else
        throw new Error("Missing object");
}

export function range(start: number, count: number): number[] {
    const L: number[] = [];
    for (let i = start; i < start + count; i++)
        L.push(i);
    return L;
}

// Eat your heart out, npm.
export function leftPad(S: string, spaces: number, ch: string = '0'): string {
    while (S.length < spaces)
        S = `${ch}${S}`;
    return S;
}

export function nArray<T>(n: number, c: () => T): T[] {
    const d = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = c();
    return d;
}

export function nullify<T>(v: T | undefined | null): T | null {
    return v === undefined ? null : v;
}

// Requires that multiple is a power of two.
export function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

export function alignNonPowerOfTwo(n: number, multiple: number): number {
    return (((n + multiple - 1) / multiple) | 0) * multiple;
}

export function fallbackUndefined<T>(v: T | null | undefined, fallback: T): T {
    return (v !== null && v !== undefined) ? v : fallback;
}

export function gfxColorEqual(c0: Readonly<GfxColor>, c1: Readonly<GfxColor>): boolean {
    return c0.r === c1.r && c0.g === c1.g && c0.b === c1.b && c0.a === c1.a;
}

export function gfxColorCopy(dst: GfxColor, src: Readonly<GfxColor>): void {
    dst.r = src.r;
    dst.g = src.g;
    dst.b = src.b;
    dst.a = src.a;
}

export function gfxColorNewCopy(src: Readonly<GfxColor>): GfxColor {
    const { r, g, b, a } = src;
    return { r, g, b, a };
}

