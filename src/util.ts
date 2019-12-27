
import ArrayBufferSlice from './ArrayBufferSlice';

export function assert(b: boolean, message: string = ""): void {
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

export function nullify<T>(v: T | undefined | null): T | null {
    return v === undefined ? null : v;
}

function makeTextDecoder(encoding: string): TextDecoder | null {
    if ((window as any).TextDecoder)
        return new TextDecoder(encoding);
    else
        return null;
}

const textDecoderCache = new Map<string, TextDecoder | null>();
export function getTextDecoder(encoding: string): TextDecoder | null {
    if (!textDecoderCache.has(encoding))
        textDecoderCache.set(encoding, makeTextDecoder(encoding));
    return textDecoderCache.get(encoding)!;
}

export function readString(buffer: ArrayBufferSlice, offs: number, length: number = -1, nulTerminated: boolean = true): string {
    const buf = buffer.createTypedArray(Uint8Array, offs);
    let S = '';
    let i = 0;
    while (true) {
        if (length >= 0 && i >= length)
            break;
        if (nulTerminated && buf[i] === 0)
            break;
        S += String.fromCharCode(buf[i]);
        i++;
    }
    return S;
}

// Requires that multiple is a power of two.
export function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

export function alignNonPowerOfTwo(n: number, multiple: number): number {
    return (((n + multiple - 1) / multiple) | 0) * multiple;
}

export function nArray<T>(n: number, c: () => T): T[] {
    const d = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = c();
    return d;
}

// Eat your heart out, npm.
export function leftPad(S: string, spaces: number, ch: string = '0'): string {
    while (S.length < spaces)
        S = `${ch}${S}`;
    return S;
}

export function hexzero(n: number, spaces: number): string {
    let S = n.toString(16);
    return leftPad(S, spaces);
}

export function hexdump(b_: ArrayBufferSlice | ArrayBuffer, offs: number = 0, length: number = 0x100): void {
    const buffer: ArrayBufferSlice = b_ instanceof ArrayBufferSlice ? b_ : new ArrayBufferSlice(b_);
    const groupSize_ = 16;
    let S = '';
    const arr = buffer.createTypedArray(Uint8Array, offs);
    length = Math.min(length, arr.byteLength);
    for (let i = 0; i < length; i += groupSize_) {
        let groupSize = Math.min(length - i, groupSize_);
        const addr = offs + i;
        S += `${hexzero(addr, 8)}    `;
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            S += ` ${hexzero(b, 2)}`;
        }
        for (let j = groupSize; j < groupSize_; j++)
            S += `   `;

        S += '  ';
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            const c = (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
            S += `${c}`;
        }
        for (let j = groupSize; j < groupSize_; j++)
            S += ` `;

        S += '\n';
    }
    console.log(S);
}

export function wordCountFromByteCount(byteCount: number): number {
    return align(byteCount, 4) / 4;
}

export function concat<T>(dst: T[], src: T[]): void {
    for (let i = 0; i < src.length; i++)
        dst.push(src[i]);
}

export function flatten<T>(L: T[][]): T[] {
    const R: T[] = [];
    for (let i = 0; i < L.length; i++)
        R.push.apply(R, L[i]);
    return R;
}

export function fallback<T>(v: T | null, fallback: T): T {
    return v !== null ? v : fallback;
}

export function fallbackUndefined<T>(v: T | null | undefined, fallback: T): T {
    return (v !== null && v !== undefined) ? v : fallback;
}

export function arrayRemove<T>(L: T[], n: T): void {
    L.splice(L.indexOf(n), 1);
}
