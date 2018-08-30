
import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';

export const BASE_URL = `https://noclip.website/`;

export function fetchData(url: string): Progressable<ArrayBufferSlice> {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
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
