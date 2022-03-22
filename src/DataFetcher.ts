
import ArrayBufferSlice from './ArrayBufferSlice';
import { assert, assertExists } from './util';
import { IS_DEVELOPMENT } from './BuildVersion';
import { ProgressMeter } from './SceneBase';

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

function getDataStorageBaseURL(isDevelopment: boolean): string {
    if (isDevelopment)
        return `/data`;
    else
        return `https://noclip.beyond3d.com`;
}

export function getDataURLForPath(url: string, isDevelopment: boolean = IS_DEVELOPMENT): string {
    if (url.startsWith('https://') || url.startsWith('http://'))
        return url;

    assert(!url.startsWith(`data/`));
    return `${getDataStorageBaseURL(isDevelopment)}/${url}`;
}

export type AbortedCallback = () => void;

class DataFetcherRequest {
    public request: XMLHttpRequest | null = null;
    public progress: number = 0;
    public ondone: (() => void) | null = null;
    public onprogress: (() => void) | null = null;

    public promise: Promise<NamedArrayBufferSlice>;
    private resolve: (slice: NamedArrayBufferSlice) => void;
    private reject: (e: Error | null) => void;
    private retriesLeft = 2;

    constructor(public url: string, private options: DataFetcherOptions) {
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

        return false;
    }

    private resolveError(): boolean {
        const request = this.request!;

        const allow404 = !!this.options.allow404;
        if (allow404 && this.isConsidered404Error()) {
            const emptySlice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            emptySlice.name = this.url;
            this.resolve(emptySlice);
            this.done();
            return true;
        }

        if (request.status === 200 || request.status === 206)
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

        if (this.options.rangeStart !== undefined && this.options.rangeSize !== undefined) {
            const rangeStart = this.options.rangeStart;
            const rangeEnd = rangeStart + this.options.rangeSize + 1; // Range header is inclusive.
            this.request.setRequestHeader('Range', `bytes=${rangeStart}-${rangeEnd}`);
        }
        this.request.send();
        this.request.onload = (e) => {
            const hadError = this.resolveError();
            if (!hadError) {
                const request = this.request!;
                const buffer: ArrayBuffer = request.response;

                let slice = new ArrayBufferSlice(buffer);

                const namedSlice = slice as NamedArrayBufferSlice;
                namedSlice.name = this.url;

                this.resolve(namedSlice);
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
        if (this.options.abortedCallback !== undefined)
            this.options.abortedCallback();
        this.destroy();
    }
}

interface DataFetcherOptions {
    allow404?: boolean;
    abortedCallback?: AbortedCallback;
    /**
     * rangeStart: 0-based byte index for the range Header. Use to request part of a file.
     * Must be specified in tandem with rangeSize.
     */
    rangeStart?: number;
    /**
     * rangeSize: Length for the range header.
     * Must be specified together with rangeStart.
     */
    rangeSize?: number;
}

export class DataFetcher {
    public requests: DataFetcherRequest[] = [];
    public doneRequestCount: number = 0;
    public maxParallelRequests: number = 10;
    public aborted: boolean = false;
    public useDevelopmentStorage: boolean | null = null;

    constructor(public progressMeter: ProgressMeter) {
    }

    public async init() {
        if (IS_DEVELOPMENT) {
            // Check for the existence of a /data directory.
            const url = getDataURLForPath('', true);
            try {
                await this.fetchURL(url, {});
                this.useDevelopmentStorage = true;
            } catch(e) {
                this.useDevelopmentStorage = false;
            }
        } else {
            this.useDevelopmentStorage = false;
        }
    }

    public abort(): void {
        this.aborted = true;
        for (let i = 0; i < this.requests.length; i++)
            this.requests[i].abort();
        this.requests = [];
    }

    public reset(): void {
        this.aborted = false;
        this.doneRequestCount = 0;
    }

    public waitForLoad(): Promise<void> {
        return Promise.all(this.requests.map((request) => request.promise)) as Promise<any>;
    }

    private calcProgress(): number {
        if (this.requests.length === 0)
            return 1;

        let n = 0;
        for (let i = 0; i < this.requests.length; i++)
            n += this.requests[i].progress;
        n += this.doneRequestCount;
        return n / (this.requests.length + this.doneRequestCount);
    }

    public setProgress(): void {
        this.progressMeter.setProgress(this.calcProgress());
    }

    private pump(): void {
        for (let i = 0; i < Math.min(this.requests.length, this.maxParallelRequests); i++) {
            if (this.requests[i].request === null)
                this.requests[i].start();
        }
    }

    public fetchURL(url: string, options: DataFetcherOptions): Promise<NamedArrayBufferSlice> {
        if (this.aborted)
            throw new Error("Tried to fetch new data while aborted; should not happen");

        const request = new DataFetcherRequest(url, options);
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

    public fetchData(path: string, options: DataFetcherOptions = { }): Promise<NamedArrayBufferSlice> {
        const url = getDataURLForPath(path, assertExists(this.useDevelopmentStorage));
        return this.fetchURL(url, options);
    }
}
