
import { lerp } from "./MathHelpers";
import { assert } from "./util";

// Color utilities

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export function colorNew(r: number, g: number, b: number, a: number = 1.0): Color {
    return { r, g, b, a };
}

export function colorLerp(dst: Color, k0: Color, k1: Color, t: number): void {
    dst.r = lerp(k0.r, k1.r, t);
    dst.g = lerp(k0.g, k1.g, t);
    dst.b = lerp(k0.b, k1.b, t);
    dst.a = lerp(k0.a, k1.a, t);
}

export function colorMult(dst: Color, k0: Color, k1: Color): void {
    dst.g = k0.g * k1.g;
    dst.r = k0.r * k1.r;
    dst.b = k0.b * k1.b;
    dst.a = k0.a * k1.a;
}

export function colorCopy(dst: Color, src: Color, a: number = src.a): void {
    dst.r = src.r;
    dst.g = src.g;
    dst.b = src.b;
    dst.a = a;
}

export function colorNewCopy(src: Color, a: number = src.a): Color {
    return { r: src.r, g: src.g, b: src.b, a: a };
}

export function colorFromRGBA(dst: Color, r: number, g: number, b: number, a: number = 1.0): void {
    dst.r = r;
    dst.g = g;
    dst.b = b;
    dst.a = a;
}

export function colorFromRGBA8(dst: Color, n: number): void {
    dst.r = ((n >>> 24) & 0xFF) / 0xFF;
    dst.g = ((n >>> 16) & 0xFF) / 0xFF;
    dst.b = ((n >>>  8) & 0xFF) / 0xFF;
    dst.a = ((n >>>  0) & 0xFF) / 0xFF;
}

export function colorNewFromRGBA8(n: number): Color {
    const dst = colorNew(0, 0, 0, 0);
    colorFromRGBA8(dst, n);
    return dst;
}

export function colorFromARGB8(dst: Color, n: number): void {
    dst.a = ((n >>> 24) & 0xFF) / 0xFF;
    dst.r = ((n >>> 16) & 0xFF) / 0xFF;
    dst.g = ((n >>>  8) & 0xFF) / 0xFF;
    dst.b = ((n >>>  0) & 0xFF) / 0xFF;
}

export function colorToRGBA8(src: Color): number {
    return (
        (src.r * 0xFF) << 24 |
        (src.g * 0xFF) << 16 |
        (src.b * 0xFF) <<  8 |
        (src.a * 0xFF) <<  0
    );
}

export function colorToARGB8(src: Color): number {
    return (
        (src.a * 0xFF) << 24 |
        (src.r * 0xFF) << 16 |
        (src.g * 0xFF) <<  8 |
        (src.b * 0xFF) <<  0
    );
}

export function colorToCSS(src: Color): string {
    return `rgba(${src.r * 255}, ${src.g * 255}, ${src.b * 255}, ${src.a})`;
}

export function colorEqual(c0: Color, c1: Color): boolean {
    return c0.r === c1.r && c0.g === c1.g && c0.b === c1.b && c0.a === c1.a;
}

export function colorFromHex(c: Color, s: string): void {
    assert(s.length === 7 || s.length === 9);
    const r = parseInt(s.slice(1, 3), 16) / 0xFF;
    const g = parseInt(s.slice(3, 5), 16) / 0xFF;
    const b = parseInt(s.slice(5, 7), 16) / 0xFF;
    const a = s.length === 9 ? (parseInt(s.slice(7, 9), 16) / 0xFF) : 1;
    colorFromRGBA(c, r, g, b, a);
}

export function colorNewFromHex(s: string): Color {
    const dst = colorNew(0, 0, 0, 0);
    colorFromHex(dst, s);
    return dst;
}

export const TransparentBlack = colorNew(0, 0, 0, 0);
export const OpaqueBlack = colorNew(0, 0, 0, 1);
export const White = colorNew(1, 1, 1, 1);
export const Magenta = colorNew(1, 0, 1, 1);
