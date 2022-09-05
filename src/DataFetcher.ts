
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

function getDataURLForPath(url: string, isDevelopment: boolean = IS_DEVELOPMENT): string {
    if (url.startsWith('https://') || url.startsWith('http://'))
        return url;

    assert(!url.startsWith(`data/`));
    return `${getDataStorageBaseURL(isDevelopment)}/${url}`;
}

export type AbortedCallback = () => void;

class DataFetcherRequest {
    public promise: Promise<NamedArrayBufferSlice>;
    public progress: number = 0;
    public ondone: (() => void) | null = null;
    public onprogress: (() => void) | null = null;

    private started = false;
    private request: Request;
    private response: Response | null = null;
    private abortController = new AbortController();
    private resolve: (slice: NamedArrayBufferSlice) => void;
    private reject: (e: Error | null) => void;
    private retriesLeft = 2;

    constructor(private cache: Cache | null, public url: string, private options: DataFetcherOptions) {
        this.request = new Request(this.url);

        if (this.options.rangeStart !== undefined && this.options.rangeSize !== undefined) {
            const rangeStart = this.options.rangeStart;
            const rangeEnd = rangeStart + this.options.rangeSize - 1; // Range header is inclusive.
            this.request.headers.set('Range', `bytes=${rangeStart}-${rangeEnd}`);
        }

        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    public inFlight(): boolean {
        return this.started;
    }

    private isConsidered404Error(): boolean {
        const response = this.response;

        if (response === null)
            return false;

        if (response.status === 404)
            return true;

        // In production environments, 404s sometimes show up as CORS errors, which come back as status 0.
        if (response.status === 0)
            return true;

        return false;
    }

    private resolveError(): boolean {
        const allow404 = !!this.options.allow404;
        if ((allow404 && this.isConsidered404Error()) || this.abortController.signal.aborted) {
            const emptySlice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            emptySlice.name = this.url;
            this.resolve(emptySlice);
            this.done();
            return true;
        }

        const response = this.response;
        let status = 999;
        if (response !== null) {
            status = response.status;
            if (status === 200 || status === 206)
                return false;
        }

        if (this.retriesLeft > 0) {
            this.retriesLeft--;
            this.destroy();
            this.start();
            return true;
        } else {
            console.error(`DataFetcherRequest: Received non-success status code ${status} when fetching file ${this.url}.`);
            this.reject(null);
            this.done();
            return true;
        }
    }

    private resolveArrayBuffer(buffer: ArrayBufferLike) {
        const slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
        slice.name = this.url;
        this.resolve(slice);
        this.done();
    }

    public async start() {
        this.started = true;

        if (this.cache !== null) {
            const match = await this.cache.match(this.request);
            if (match !== undefined) {
                const arrayBuffer = await match.arrayBuffer();
                this.resolveArrayBuffer(arrayBuffer);
            }
        }

        assert(this.response === null);
        try {
            this.response = await fetch(this.request, { signal: this.abortController.signal });
        } catch(e) {
            // Error handling below.
        }

        if (this.resolveError())
            return;

        const response = this.response!;

        if (response.status === 206) {
            // Partial responses are unsupported with Cache, for some lovely reason.
            this.cache = null;
        }

        // Clone now, so we can add to the cache later (??? Why? What was the point of this?)
        const responseClone = this.cache !== null ? response.clone() : null;

        let contentLengthStr = response.headers.get('content-length');
        if (contentLengthStr === null)
            contentLengthStr = '1';

        // XXX(jstpierre): There's no way to correctly compute progress in fetch()
        // under the duress of Content-Encoding compression:
        // https://github.com/whatwg/fetch/issues/1358
        const contentLength = parseInt(contentLengthStr, 10);

        const chunks: Uint8Array[] = [];

        const reader = response.body!.getReader();
        let totalBytesReceived = 0;
        while (true) {
            try {
                // XXX(jstpierre): This is so freaking wasteful, lmao.
                const { done, value } = await reader.read();
                if (done)
                    break;

                totalBytesReceived += value!.byteLength;
                this.progress = Math.min(totalBytesReceived / contentLength, 1);
    
                if (this.onprogress !== null)
                    this.onprogress();
    
                chunks.push(value!);
            } catch(e) {
                break;
            }
        }

        if (this.resolveError())
            return;

        assert(chunks.length >= 1);

        let bigBuffer: Uint8Array;
        if (chunks.length === 1) {
            bigBuffer = chunks[0];
        } else {
            // Merge together buffers
            bigBuffer = new Uint8Array(totalBytesReceived);
            let idx = 0;
            for (let i = 0; i < chunks.length; i++) {
                bigBuffer.set(chunks[i], idx);
                idx += chunks[i].byteLength;
            }
        }

        this.resolveArrayBuffer(bigBuffer.buffer);

        if (this.cache !== null)
            await this.cache.put(this.request, responseClone!);

        this.response = null;
    }

    private done(): void {
        this.progress = 1.0;
        if (this.onprogress !== null)
            this.onprogress();
        if (this.ondone !== null)
            this.ondone();
    }

    public destroy(): void {
        this.response = null;
    }

    public abort(): void {
        this.abortController.abort();
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
    private cache: Cache | null = null;

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

        const REQUEST_CACHE_NAME = `request-cache-v1`;
        this.cache = await caches.open(REQUEST_CACHE_NAME);
    }

    private manageCache(): void {
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
            if (!this.requests[i].inFlight())
                this.requests[i].start();
        }
    }

    public fetchURL(url: string, options: DataFetcherOptions): Promise<NamedArrayBufferSlice> {
        if (this.aborted)
            throw new Error("Tried to fetch new data while aborted; should not happen");

        const request = new DataFetcherRequest(this.cache, url, options);
        this.requests.push(request);
        request.ondone = () => {
            this.doneRequestCount++;
            request.destroy();
            this.requests.splice(this.requests.indexOf(request), 1);
            this.pump();
            this.manageCache();
        };
        request.onprogress = () => {
            this.setProgress();
        };
        this.pump();
        return request.promise!;
    }

    public getDataURLForPath(path: string): string {
        return getDataURLForPath(path, assertExists(this.useDevelopmentStorage));
    }

    public fetchData(path: string, options: DataFetcherOptions = { }): Promise<NamedArrayBufferSlice> {
        const url = this.getDataURLForPath(path);
        return this.fetchURL(url, options);
    }
}
