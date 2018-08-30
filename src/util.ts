
import ArrayBufferSlice from './ArrayBufferSlice';

export function assert(b: boolean): void {
    if (!b) { console.error(new Error().stack); throw new Error("Assert fail"); }
}

export function assertExists<T>(v: T | null | undefined): T {
    if (v)
        return v;
    else
        throw new Error("Missing object");
}

export function readString(buffer: ArrayBufferSlice, offs: number, length: number = -1, nulTerminated: boolean = true): string {
    const buf = buffer.createTypedArray(Uint8Array, offs);
    let S = '';
    let i = 0;
    while (true) {
        if (length > 0 && i >= length)
            break;
        if (nulTerminated && buf[i] === 0)
            break;
        S += String.fromCharCode(buf[i]);
        i++;
    }
    return S;
}

export function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

let counter = 0;
export function generateFormID() {
    return `FormGeneratedID_${counter++}`;
}

export function nArray<T>(n: number, c: () => T): T[] {
    const d = new Array(n);
    while (n--)
        d[n] = c();
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

export function hexdump(buffer: ArrayBufferSlice, offs: number = 0, length: number = 0x100): void {
    const groupSize = 16;
    let S = '';
    const arr = buffer.createTypedArray(Uint8Array, offs, length);
    for (let i = 0; i < length; i += groupSize) {
        const addr = offs + i;
        S += `${hexzero(addr, 8)}    `;
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            S += ` ${hexzero(b, 2)}`;
        }

        S += '  ';
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            const c = (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
            S += `${c}`;
        }

        S += '\n';
    }
    console.log(S);
}
