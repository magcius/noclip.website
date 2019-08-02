
import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable, { ProgressMeter } from './Progressable';
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

class DataFetcherRequest {
    public request: XMLHttpRequest | null = null;
    public progress: number = 0;
    public ondone: ((slice: NamedArrayBufferSlice) => void) | null = null;
    public onprogress: (() => void) | null = null;

    public promise: Promise<NamedArrayBufferSlice>;
    private resolve: (slice: NamedArrayBufferSlice) => void;
    private reject: (e: Error) => void;

    constructor(public url: string) {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    public start(): void {
        this.request = new XMLHttpRequest();
        this.request.open("GET", this.url, true);
        this.request.responseType = "arraybuffer";
        this.request.send();
        this.request.onload = (e) => {
            const buffer: ArrayBuffer = this.request.response;
            const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
            slice.name = this.url;
            if (this.ondone !== null)
                this.ondone(slice);
            this.resolve(slice);
        };
        this.request.onerror = (e) => {
            // TODO(jstpierre): Proper error handling.
            console.error(`DataFetcherRequest error`, this, this.request, e);
        };
        this.request.onprogress = (e) => {
            if (e.lengthComputable)
                this.progress = e.loaded / e.total;
            if (this.onprogress !== null)
                this.onprogress();
        };
    }

    public destroy(): void {
        // Explicitly sever any GC cycles.
        if (this.request !== null) {
            this.request.onload = null;
            this.request.onerror = null;
            this.request.onprogress = null;
        }
        this.request = null;
    }

    public abort(): void {
        if (this.request !== null)
            this.request.abort();
        this.destroy();
    }
}

export class DataFetcher {
    public requests: DataFetcherRequest[] = [];
    public doneRequestCount: number = 0;
    public maxParallelRequests: number = 2;
    public aborted: boolean = false;

    constructor(private abortSignal: AbortSignal, private progressMeter: ProgressMeter) {
        abortSignal.addEventListener('abort', () => {
            this.aborted = true;
            for (let i = 0; i < this.requests.length; i++)
                this.requests[i].abort();
            this.requests = [];
        });
    }

    public waitForLoad(): Promise<void> {
        return Promise.all(this.requests.map((request) => request.promise)) as Promise<any>;
    }

    private calcProgress(): number {
        let n = 0;
        for (let i = 0; i < this.requests.length; i++)
            n += this.requests[i].progress;
        n += this.doneRequestCount;
        return n / (this.requests.length + this.doneRequestCount);
    }

    private setProgress(): void {
        this.progressMeter.setProgress(this.calcProgress());
    }

    private pump(): void {
        for (let i = 0; i < Math.min(this.requests.length, this.maxParallelRequests); i++) {
            if (this.requests[i].request === null)
                this.requests[i].start();
        }
    }

    public fetchData(path: string): Promise<NamedArrayBufferSlice> {
        if (this.aborted)
            throw new Error("Tried to fetch new data while aborted; should not happen");

        const url = getDataURLForPath(path);
        const request = new DataFetcherRequest(url);
        this.requests.push(request);
        request.ondone = () => {
            this.doneRequestCount++;
            request.destroy();
            this.requests.splice(this.requests.indexOf(request), 1);
            this.pump();
        };
        request.onprogress = () => {
            this.setProgress();
        };
        this.pump();
        return request.promise!;
    }
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
