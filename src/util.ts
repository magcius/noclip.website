
export function fetch(path: string): PromiseLike<ArrayBuffer> {
    const request = new XMLHttpRequest();
    request.open("GET", path, true);
    request.responseType = "arraybuffer";
    request.send();

    return new Promise((resolve, reject) => {
        request.onload = () => {
            resolve(request.response);
        };
        request.onerror = () => {
            reject();
        };
    });
}

export function assert(b: boolean) {
    if (!b) throw new Error("Assert fail");
}

export function readString(buffer: ArrayBuffer, offs: number, length: number = -1, nulTerminated: boolean = true): string {
    const buf = new Uint8Array(buffer, offs);
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
