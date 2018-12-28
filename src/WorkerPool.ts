
import { assertExists } from "./util";

interface WorkerManagerRequest<TReq, TRes> {
    request: TReq;
    resolve: (v: TRes) => void;
}

interface WorkerRequest {
    priority: number;
}

class WorkerManager<TReq extends WorkerRequest, TRes> {
    private currentRequest: (WorkerManagerRequest<TReq, TRes> | null) = null;

    constructor(private worker: Worker, public onworkerdone: () => void) {
        this.worker.onmessage = this._workerOnMessage.bind(this);
    }

    private _workerOnMessage(e: MessageEvent): void {
        const resp: TRes = e.data;
        this.currentRequest = assertExists(this.currentRequest);
        this.currentRequest.resolve(resp);
        this.currentRequest = null;
        this.onworkerdone();
    }

    public execute(req: WorkerManagerRequest<TReq, TRes>): void {
        this.currentRequest = req;
        this.worker.postMessage(req.request);
    }

    public isFree(): boolean {
        return this.currentRequest === null;
    }

    public terminate(): void {
        this.worker.terminate();
    }
}

export default class WorkerPool<TReq extends WorkerRequest, TRes> {
    private outstandingRequests: WorkerManagerRequest<TReq, TRes>[] = [];
    private workers: WorkerManager<TReq, TRes>[] = [];

    constructor(private workerConstructor: () => Worker, private numWorkers: number = 1) {
    }

    public terminate(): void {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }

    public build(): void {
        if (this.workers.length > 0)
            return;

        let numWorkers = this.numWorkers;
        while(numWorkers--) {
            const manager = new WorkerManager<TReq, TRes>(this.workerConstructor(), this._onWorkerDone.bind(this));
            this.workers.push(manager);
        }
    }

    public execute(request: TReq): Promise<TRes> {
        this.build();
        const p = new Promise<TRes>((resolve, reject) => {
            const workerManagerRequest: WorkerManagerRequest<TReq, TRes> = { request, resolve };
            this.insertRequest(workerManagerRequest);
        });
        this.pumpQueue();
        return p;
    }

    private insertRequest(workerManagerRequest: WorkerManagerRequest<TReq, TRes>): void {
        let i;
        for (i = 0; i < this.outstandingRequests.length; i++) {
            if (this.outstandingRequests[i].request.priority > workerManagerRequest.request.priority)
                break;
        }
        this.outstandingRequests.splice(i, 0, workerManagerRequest);
    }

    private pumpQueue(): void {
        for (const worker of this.workers) {
            if (this.outstandingRequests.length === 0)
                return;

            if (worker.isFree()) {
                const req = assertExists(this.outstandingRequests.shift());
                worker.execute(req);
            }
        }
    }

    private _onWorkerDone(): void {
        this.pumpQueue();
    }
}
