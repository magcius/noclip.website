
import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';
import { assert } from './util';
import { IS_DEVELOPMENT } from './BuildVersion';

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

function getDataStorageBaseURL(): string {
    if (IS_DEVELOPMENT)
        return `/data`;
    else
        return `https://noclip.beyond3d.com`;
}

export class AbortedError extends Error {
    constructor(...args: any[]) {
        super(...args);
        this.name = 'AbortedError';
    }
}

export function getDataURLForPath(url: string): string {
    assert(!url.startsWith(`data/`));
    return `${getDataStorageBaseURL()}/${url}`;
}

export function fetchData(path: string, abortSignal: AbortSignal | null): Progressable<NamedArrayBufferSlice> {
    const request = new XMLHttpRequest();
    const url = getDataURLForPath(path);
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.send();
    if (abortSignal !== null) {
        abortSignal.addEventListener('abort', () => {
            request.abort();
        });
    }
    const pFetch = new Promise<NamedArrayBufferSlice>((resolve, reject) => {
        function done() {
            prFetch.setProgress(1);
            let slice: NamedArrayBufferSlice;

            // If we aborted the request, then don't call our callback.
            if (request.status === 0 && (abortSignal !== null && abortSignal.aborted))
                reject(new AbortedError());

            if (request.status !== 200 || request.getResponseHeader('Content-Type').startsWith('text/html')) {
                console.error(`fetchData: Received non-success status code ${request.status} when fetching file ${path}. Status: ${request.status}, aborted: ${abortSignal ? abortSignal.aborted : 'no signal'}`);
                slice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            } else {
                const buffer: ArrayBuffer = request.response;
                slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
            }
            slice.name = url;
            resolve(slice);
        }

        request.onload = done;
        request.onerror = done;
        request.onabort = () => {
            reject(new AbortedError());
        };
        request.onprogress = (e) => {
            if (e.lengthComputable)
                prFetch.setProgress(e.loaded / e.total);
        };
    });
    const prFetch = new Progressable<NamedArrayBufferSlice>(pFetch);
    return prFetch;
}

function downloadHref(filename: string, href: string): void {
    const elem = document.createElement('a');
    elem.setAttribute('href', href);
    elem.setAttribute('download', filename);
    document.body.appendChild(elem);
    elem.click();
    document.body.removeChild(elem);
}

export function downloadBlob(filename: string, blob: Blob): void {
    const url = window.URL.createObjectURL(blob);
    downloadHref(filename, url);
    window.URL.revokeObjectURL(url);
}

export function downloadBufferSlice(filename: string, buffer: ArrayBufferSlice, type: string = 'application/octet-stream'): void {
    const blob = new Blob([buffer.createTypedArray(Uint8Array)], { type });
    downloadBlob(filename, blob);
}

export function downloadBuffer(filename: string, buffer: ArrayBuffer, type: string = 'application/octet-stream'): void {
    const blob = new Blob([buffer], { type });
    downloadBlob(filename, blob);
}
