
import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';

export const BASE_URL = `https://noclip.website/`;

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

export function fetchData(url: string): Progressable<NamedArrayBufferSlice> {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.send();
    const p = new Promise<NamedArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            pr.setProgress(1);
            const buffer: ArrayBuffer = request.response;
            const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
            slice.name = url;
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
    const pr = new Progressable<NamedArrayBufferSlice>(p);
    return pr;
}
