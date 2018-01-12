
export function fetch(path): PromiseLike<ArrayBuffer> {
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

export function readString(buffer: ArrayBuffer, offs: number, length: number): string {
    const buf = new Uint8Array(buffer, offs, length);
    let S = '';
    for (let i = 0; i < length; i++) {
        if (buf[i] === 0)
            break;
        S += String.fromCharCode(buf[i]);
    }
    return S;
}
