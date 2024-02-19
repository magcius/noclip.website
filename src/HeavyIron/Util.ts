export function strHash(s: string): number {
    return strHashCat(0, s);
}

export function strHashCat(h: number, s: string): number {
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        c -= (c & (c >>> 1)) & 0x20;
        h = ((h * 131 + c) & 0xFFFFFFFF) >>> 0;
    }
    return h;
}