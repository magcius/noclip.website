
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
    if (!b) throw new Error("Assert fail");
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
