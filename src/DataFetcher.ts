
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

class DataFetcherRequest {
    public request: XMLHttpRequest | null = null;
    public progress: number = 0;
    public ondone: (() => void) | null = null;
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
            this.progress = 1.0;
            if (this.onprogress !== null)
                this.onprogress();

            const buffer: ArrayBuffer = this.request.response;
            const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
            slice.name = this.url;
            if (this.ondone !== null)
                this.ondone();
            this.resolve(slice);
        };
        this.request.onerror = (e) => {
            this.progress = 1.0;
            if (this.onprogress !== null)
                this.onprogress();

            // TODO(jstpierre): Proper error handling.
            console.error(`DataFetcherRequest error`, this, this.request, e);

            if (this.ondone !== null)
                this.ondone();
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
