
// Color utilities

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
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

export function colorCopy(dst: Color, src: Color, a: number = src.a): void {
    dst.r = src.r;
    dst.g = src.g;
    dst.b = src.b;
    dst.a = a;
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

export const TransparentBlack = colorNew(0, 0, 0, 0);
export const OpaqueBlack = colorNew(0, 0, 0, 1);
export const White = colorNew(1, 1, 1, 1);
