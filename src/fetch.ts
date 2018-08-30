
import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';

export const BASE_URL = `https://noclip.website/`;

function isDevelopment(): boolean {
    return window.location.protocol === 'file:' || window.location.hostname === 'localhost';
}

function resolveURL(url: string): string {
    const siteBase = `https://noclip.website/`;
    if (url.startsWith(`data/`) && !isDevelopment())
        return `${siteBase}/${url}`;
    else
        return url;
}

export function fetchData(url: string): Progressable<ArrayBufferSlice> {
    const resolvedURL = resolveURL(url);
    const request = new XMLHttpRequest();
    request.open("GET", resolvedURL, true);
    request.responseType = "arraybuffer";
    request.send();
    const p = new Promise<ArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            pr.setProgress(1);
            const buffer: ArrayBuffer = request.response;
            const slice = new ArrayBufferSlice(buffer);
            console.log(slice);
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
