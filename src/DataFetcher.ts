
import ArrayBufferSlice from './ArrayBufferSlice';
import { assert } from './util';
import { IS_DEVELOPMENT } from './BuildVersion';
import { ProgressMeter } from './SceneBase';

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

function getDataStorageBaseURL(): string {
    if (IS_DEVELOPMENT)
        return `/data`;
    else
        return `https://gznoclip1.b-cdn.net`;
}

export function getDataURLForPath(url: string): string {
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

    public promise: Promise<NamedArrayBufferSlice>;
    private resolve: (slice: NamedArrayBufferSlice) => void;
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

    private isConsidered404Error(): boolean {
        const request = this.request!;

        if (request.status === 404)
            return true;

        // In production environments, 404s sometimes show up as CORS errors, which come back as status 0.
        if (request.status === 0)
            return true;

        // This check is for development purposes, as Parcel will return the index page for non-existent data.
        const contentType = request.getResponseHeader('Content-Type');
        if (contentType !== null && contentType.startsWith('text/html'))
            return true;

        return false;
    }

    private resolveError(): boolean {
        const request = this.request!;

        const allow404 = !!(this.flags & DataFetcherFlags.ALLOW_404);
        if (allow404 && this.isConsidered404Error()) {
            const emptySlice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            emptySlice.name = this.url;
            this.resolve(emptySlice);
            this.done();
            return true;
        }

        if (request.status === 200)
            return false;

        if (this.retriesLeft > 0) {
            this.retriesLeft--;
            this.destroy();
            this.start();
            return true;
        } else {
            console.error(`DataFetcherRequest: Received non-success status code ${request.status} when fetching file ${this.url}.`);
            this.reject(null);
            this.done();
            return true;
        }
    }

    public start(): void {
        this.request = new XMLHttpRequest();
        this.request.open("GET", this.url, true);
        this.request.responseType = "arraybuffer";
        this.request.send();
        this.request.onload = (e) => {
            const hadError = this.resolveError();
            if (!hadError) {
                const buffer: ArrayBuffer = this.request!.response;
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

    constructor(private abortSignal: AbortSignal, public progressMeter: ProgressMeter) {
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

    public fetchURL(url: string, flags: DataFetcherFlags = 0): Promise<NamedArrayBufferSlice> {
        if (this.aborted)
            throw new Error("Tried to fetch new data while aborted; should not happen");

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

    public fetchData(path: string, flags: DataFetcherFlags = 0): Promise<NamedArrayBufferSlice> {
        const url = getDataURLForPath(path);
        return this.fetchURL(url, flags);
    }
}
