
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';

export function fetch(path: string): Progressable<ArrayBufferSlice> {
    const request = new XMLHttpRequest();
    request.open("GET", path, true);
    request.responseType = "arraybuffer";
    request.send();

    const p = new Promise<ArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            pr.setProgress(1);
            const buffer: ArrayBuffer = request.response;
            const slice = new ArrayBufferSlice(buffer);
            resolve(slice);
        };
        request.onerror = () => {
            reject();
        };
        request.onprogress = (e) => {
            if (e.lengthComputable)
                pr.setProgress(e.loaded / e.total);
        };
    });
    const pr = new Progressable<ArrayBufferSlice>(p);
    return pr;
}

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

function hexzero(n: number, spaces: number): string {
    let S = n.toString(16);
    while (S.length < spaces)
        S = `0${S}`;
    return S;
}

export function hexdump(buffer: ArrayBufferSlice, offs: number = 0, length: number = 0x100): void {
    const groupSize = 16;
    let S = '';
    const arr = buffer.createTypedArray(Uint8Array, offs, length);
    for (let i = offs; i < length; i += groupSize) {
        S += `${hexzero(i, 8)}    `;
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

// Debug utilities.
declare global {
    interface Window {
        hexdump: any;
        debug: boolean;
    }
}
window.hexdump = hexdump;
window.debug = false;