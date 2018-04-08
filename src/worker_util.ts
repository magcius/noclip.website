
interface WorkerRequest<T> {
    p: Promise<T>;
    resolve: (v: T) => void;
}

export class WorkerManager<TReq, TRes> {
    private outstandingRequests: WorkerRequest<TRes>[] = [];

    constructor(private worker: Worker) {
        this.worker.onmessage = this._workerOnMessage.bind(this);
    }

    private _workerOnMessage(e: MessageEvent) {
        const resp: TRes = e.data;
        const outstandingReq = this.outstandingRequests.shift();
        outstandingReq.resolve(resp);
    }

    public terminate() {
        return this.worker.terminate();
    }

    public execute(req: TReq): Promise<TRes> {
        let resolve;
        const p = new Promise<TRes>((resolve_, reject) => {
            resolve = resolve_;
        });
        this.worker.postMessage(req);
        const outstandingRequest: WorkerRequest<TRes> = { p, resolve };
        this.outstandingRequests.push(outstandingRequest);
        return p;
    }
}

// TODO(jstpierre): This is a round-robin, which is the best
// we can do with WebWorkers without SharedArrayBuffer or similar, I think...
class MultiWorkerManager<TReq, TRes> {
    private nextWorker: number = 0;

    constructor(private workers: WorkerManager<TReq, TRes>[]) {
    }

    public terminate() {
        for (const worker of this.workers)
            worker.terminate();
    }

    public execute(req: TReq): Promise<TRes> {
        const p = this.workers[this.nextWorker].execute(req);
        this.nextWorker = (this.nextWorker + 1) % this.workers.length;
        return p;
    }
}

export class WorkerPool<TReq, TRes> {
    private multiWorkerManager: MultiWorkerManager<TReq, TRes>;

    constructor(private workerConstructor: () => Worker, private numWorkers: number = 8) {
    }

    public terminate() {
        if (this.multiWorkerManager) {
            this.multiWorkerManager.terminate();
            this.multiWorkerManager = null;
        }
    }

    public build() {
        if (this.multiWorkerManager)
            return;

        const workers: WorkerManager<TReq, TRes>[] = [];
        let numWorkers = this.numWorkers;
        while(numWorkers--)
            workers.push(new WorkerManager<TReq, TRes>(this.workerConstructor()));
        this.multiWorkerManager = new MultiWorkerManager<TReq, TRes>(workers);
    }

    public execute(req: TReq): Promise<TRes> {
        this.build();
        return this.multiWorkerManager.execute(req);
    }
}

export function makeWorkerFromSource(sources: string[]): Worker {
    const blob = new Blob(sources, { type: 'application/javascript' });
    const url = window.URL.createObjectURL(blob);
    const w = new Worker(url);
    window.URL.revokeObjectURL(url);
    return w;
}
