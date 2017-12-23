
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
