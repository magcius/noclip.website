
import ArrayBufferSlice from './ArrayBufferSlice';
import { assert } from './util';
import { IS_DEVELOPMENT } from './BuildVersion';
import { ProgressMeter } from './SceneBase';

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

function getDataStorageBaseURL(): string {
    if (false && IS_DEVELOPMENT)
        return `/data`;
    else
        return `https://noclip.beyond3d.com`;
}

function getDataURLForPath(url: string): string {
    assert(!url.startsWith(`data/`));
    return `${getDataStorageBaseURL()}/${url}`;
}

export const enum DataFetcherFlags {
    ALLOW_404 = 0x01,
}

class DataFetcherRequest {
    public request: XMLHttpRequest | null = null;
    public progress: number = 0;
    public ondone: (() => void) | null = null;
    public onprogress: (() => void) | null = null;

    public promise: Promise<NamedArrayBufferSlice | null>;
    private resolve: (slice: NamedArrayBufferSlice | null) => void;
    private reject: (e: Error | null) => void;
    private retriesLeft = 2;

    constructor(public url: string, private flags: DataFetcherFlags) {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    private done(): void {
        this.progress = 1.0;
        if (this.onprogress !== null)
            this.onprogress();
        if (this.ondone !== null)
            this.ondone();
    }

    private resolveError(): void {
        const allow404 = !!(this.flags & DataFetcherFlags.ALLOW_404);
        if (allow404) {
            const emptySlice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            emptySlice.name = this.url;
            this.resolve(emptySlice);
            this.done();
        } else if (this.retriesLeft > 0) {
            this.retriesLeft--;
            this.destroy();
            this.start();
        } else {
            this.reject(null);
            this.done();
        }
    }

    public start(): void {
        this.request = new XMLHttpRequest();
        this.request.open("GET", this.url, true);
        this.request.responseType = "arraybuffer";
        this.request.send();
        this.request.onload = (e) => {
            if (this.request.status !== 200 || this.request.getResponseHeader('Content-Type').startsWith('text/html')) {
                console.error(`DataFetcherRequest: Received non-success status code ${this.request.status} when fetching file ${this.url}. Status: ${this.request.status}`);
                this.resolveError();
            } else {
                const buffer: ArrayBuffer = this.request.response;
                const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
                slice.name = this.url;
                this.resolve(slice);
                this.done();
            }
        };
        this.request.onerror = (e) => {
            // TODO(jstpierre): Proper error handling.
            console.error(`DataFetcherRequest: Received error`, this, this.request, e);

            this.resolveError();
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

    public fetchData(path: string, flags: DataFetcherFlags = 0): Promise<NamedArrayBufferSlice | null> {
        if (this.aborted)
            throw new Error("Tried to fetch new data while aborted; should not happen");

        const url = getDataURLForPath(path);
        const request = new DataFetcherRequest(url, flags);
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
