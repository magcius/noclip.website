
interface WorkerRequest<T> {
    p: Promise<T>;
    resolve: (v: T) => void;
}

export class WorkerManager<T, R> {
    private outstandingRequests: WorkerRequest<T>[] = [];

    constructor(private worker: Worker) {
        this.worker.onmessage = this._workerOnMessage.bind(this);
    }

    private _workerOnMessage(e: MessageEvent) {
        const resp: T = e.data;
        const outstandingReq = this.outstandingRequests.shift();
        outstandingReq.resolve(resp);
    }

    public terminate() {
        return this.worker.terminate();
    }

    public execute(req: R): Promise<T> {
        let resolve;
        const p = new Promise<T>((resolve_, reject) => {
            resolve = resolve_;
        });
        this.worker.postMessage(req);
        const outstandingRequest: WorkerRequest<T> = { p, resolve };
        this.outstandingRequests.push(outstandingRequest);
        return p;
    }
}

// TODO(jstpierre): This is a round-robin, which is the best
// we can do with WebWorkers without SharedArrayBuffer or similar, I think...
class MultiWorkerManager<T, R> {
    private nextWorker: number = 0;

    constructor(private workers: WorkerManager<T, R>[]) {
    }

    public terminate() {
        for (const worker of this.workers)
            worker.terminate();
    }

    public execute(req: R): Promise<T> {
        const p = this.workers[this.nextWorker].execute(req);
        this.nextWorker = (this.nextWorker + 1) % this.workers.length;
        return p;
    }
}

export class WorkerPool<T, R> {
    private multiWorkerManager: MultiWorkerManager<T, R>;

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

        const workers: WorkerManager<T, R>[] = [];
        let numWorkers = this.numWorkers;
        while(numWorkers--)
            workers.push(new WorkerManager<T, R>(this.workerConstructor()));
        this.multiWorkerManager = new MultiWorkerManager<T, R>(workers);
    }

    public execute(req: R): Promise<T> {
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
