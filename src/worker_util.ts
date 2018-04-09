
interface WorkerManagerRequest<TReq, TRes> {
    request: TReq;
    resolve: (v: TRes) => void;
}

interface WorkerRequest {
    priority: number;
}

class WorkerManager<TReq extends WorkerRequest, TRes> {
    private currentRequest: WorkerManagerRequest<TReq, TRes> = null;
    public onworkerdone: () => void;

    constructor(private worker: Worker) {
        this.worker.onmessage = this._workerOnMessage.bind(this);
    }

    private _workerOnMessage(e: MessageEvent) {
        const resp: TRes = e.data;
        this.currentRequest.resolve(resp);
        this.currentRequest = null;
        this.onworkerdone();
    }

    public execute(req: WorkerManagerRequest<TReq, TRes>): void {
        this.currentRequest = req;
        this.worker.postMessage(req.request);
    }

    public isFree() {
        return this.currentRequest === null;
    }

    public terminate() {
        return this.worker.terminate();
    }
}

export class WorkerPool<TReq extends WorkerRequest, TRes> {
    private outstandingRequests: WorkerManagerRequest<TReq, TRes>[] = [];
    private workers: WorkerManager<TReq, TRes>[] = [];

    constructor(private workerConstructor: () => Worker, private numWorkers: number = 8) {
    }

    public terminate() {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }

    public build() {
        if (this.workers.length > 0)
            return;

        let numWorkers = this.numWorkers;
        while(numWorkers--) {
            const manager = new WorkerManager<TReq, TRes>(this.workerConstructor());
            manager.onworkerdone = this._onWorkerDone.bind(this);
            this.workers.push(manager);
        }
    }

    public execute(request: TReq): Promise<TRes> {
        this.build();

        let resolve;
        const p = new Promise<TRes>((resolve_, reject) => {
            resolve = resolve_;
        });
        const workerManagerRequest = { request, resolve };
        this.insertRequest(workerManagerRequest);
        this.pumpQueue();
        return p;
    }

    private insertRequest(workerManagerRequest: WorkerManagerRequest<TReq, TRes>) {
        let i;
        for (i = 0; i < this.outstandingRequests.length; i++) {
            if (this.outstandingRequests[i].request.priority > workerManagerRequest.request.priority)
                break;
        }
        this.outstandingRequests.splice(i, 0, workerManagerRequest);
    }

    private pumpQueue() {
        for (const worker of this.workers) {
            if (this.outstandingRequests.length === 0)
            return;

            if (worker.isFree()) {
                const req = this.outstandingRequests.shift();
                worker.execute(req);
            }
        }
    }

    private _onWorkerDone() {
        this.pumpQueue();
    }
}

export function makeWorkerFromSource(sources: string[]): Worker {
    const blob = new Blob(sources, { type: 'application/javascript' });
    const url = window.URL.createObjectURL(blob);
    const w = new Worker(url);
    window.URL.revokeObjectURL(url);
    return w;
}
