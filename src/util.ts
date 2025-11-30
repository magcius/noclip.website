
import ArrayBufferSlice from './ArrayBufferSlice.js';

export function assert(b: boolean, message: string = ""): asserts b {
    if (!b) {
        console.error(new Error().stack);
        throw new Error(`Assert fail: ${message}`);
    }
}

export function assertExists<T>(v: T | null | undefined, name: string = ''): T {
    if (v !== undefined && v !== null)
        return v;
    else
        throw new Error(`Missing object ${name}`);
}

export function nullify<T>(v: T | undefined | null): T | null {
    return v === undefined ? null : v;
}

export function readString(buffer: ArrayBufferSlice, offs: number, length: number = -1, nulTerminated: boolean = true, encoding: string | null = null): string {
    const buf = buffer.createTypedArray(Uint8Array, offs);
    if (length < 0)
        length = buf.byteLength;
    let byteLength = 0;
    while (true) {
        if (byteLength >= length)
            break;
        if (nulTerminated && buf[byteLength] === 0)
            break;
        byteLength++;
    }

    if (byteLength === 0)
        return "";

    if (encoding !== null) {
        return decodeString(buffer, offs, byteLength, encoding);
    } else {
        return copyBufferToString(buffer, offs, byteLength);
    }
}

function copyBufferToString(buffer: ArrayBufferSlice, offs: number, byteLength: number): string {
    const buf = buffer.createTypedArray(Uint8Array, offs);
    let S = '';
    for (let i = 0; i < byteLength; i++)
        S += String.fromCharCode(buf[i]);
    return S;
}

export function decodeString(buffer: ArrayBufferSlice, offs: number | undefined = undefined, byteLength: number | undefined = undefined, encoding = 'utf8'): string {
    return new TextDecoder(encoding)!.decode(buffer.copyToBuffer(offs, byteLength));
}

// Requires that multiple is a power of two.
export function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

export function alignNonPowerOfTwo(n: number, multiple: number): number {
    return (((n + multiple - 1) / multiple) | 0) * multiple;
}

export function nArray<T>(n: number, c: (i: number) => T): T[] {
    const d = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = c(i);
    return d;
}

export function leftPad(S: string, spaces: number, ch: string = '0'): string {
    return S.padStart(spaces, ch);
}

export function hexzero(n: number, spaces: number): string {
    let S = (n >>> 0).toString(16);
    return leftPad(S, spaces);
}

export function hexzero0x(n: number, spaces: number = 8): string {
    if (n < 0)
        return `-0x${hexzero(-n, spaces)}`;
    else
        return `0x${hexzero(n, spaces)}`;
}

export function flatten<T>(L: T[][]): T[] {
    const R: T[] = [];
    for (let i = 0; i < L.length; i++)
        R.push(... L[i]);
    return R;
}

export function fallback<T>(v: T | null, fallback: T): T {
    return v !== null ? v : fallback;
}

export function fallbackUndefined<T>(v: T | null | undefined, fallback: T): T {
    return (v !== null && v !== undefined) ? v : fallback;
}

export function arraySwap<T>(L: T[], ia: number, ib: number): void {
    const tmp: T = L[ia];
    L[ia] = L[ib];
    L[ib] = tmp;
}

export function arrayRemove<T>(L: T[], n: T): number {
    const idx = L.indexOf(n);
    assert(idx >= 0);
    L.splice(idx, 1);
    return idx;
}

export function arrayRemoveIfExist<T>(L: T[], n: T): number {
    const idx = L.indexOf(n);
    if (idx >= 0)
        L.splice(idx, 1);
    return idx;
}

export function bisectRight<T>(L: T[], e: T, compare: (a: T, b: T) => number): number {
    let lo = 0, hi = L.length;
    while (lo < hi) {
        const mid = lo + ((hi - lo) >>> 1);
        const cmp = compare(e, L[mid]);
        if (cmp < 0)
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}

export function spliceBisectRight<T>(L: T[], e: T, compare: (a: T, b: T) => number): void {
    const idx = bisectRight(L, e, compare);
    L.splice(idx, 0, e);
}

export function setBitFlagEnabled(v: number, mask: number, enabled: boolean): number {
    if (enabled)
        v |= mask;
    else
        v &= ~mask;
    return v;
}

export function mod(a: number, b: number): number {
    return (a + b) % b;
}

export function ensureInList<T>(L: T[], v: T): void {
    if (!L.includes(v))
        L.push(v);
}
