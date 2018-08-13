
export default class Progressable<T> {
    public promise: PromiseLike<T>;
    public onProgress: (() => void) | null;
    public progress: number; // Between 0 and 1.

    constructor(promise: PromiseLike<T>, initialProgress: number = 0) {
        this.promise = promise;
        this.onProgress = null;
        this.progress = initialProgress;
    }

    public setProgress(n: number) {
        this.progress = n;
        if (this.onProgress !== null)
            this.onProgress();
    }

    public then<TResult>(onfulfilled?: ((value: T) => TResult | PromiseLike<TResult>)): Progressable<TResult> {
        // The rough idea is that any then-able is implicitly at the same progress as this one.
        const pr = new Progressable(this.promise.then(onfulfilled), this.progress);
        this.onProgress = () => {
            pr.setProgress(this.progress);
        };
        return pr;
    }

    public static resolve<T>(value: T): Progressable<T> {
        return new Progressable(Promise.resolve(value), 1);
    }

    public static all<T>(progressables: Progressable<T>[]): Progressable<T[]> {
        const p = Promise.all(progressables.map((p) => p.promise));
        function calcProgress() {
            const progresses = progressables.map((p) => p.progress);
            pr.progress = avg(progresses);
            if (pr.onProgress !== null)
                pr.onProgress();
        }
        progressables.forEach((p) => {
            p.onProgress = calcProgress;
        });
        const pr = new Progressable<T[]>(p);
        return pr;
    }
}

function avg(L: number[]) {
    let s = 0;
    L.forEach((i) => s += i);
    s /= L.length;
    return s;
}

function setTimeoutProgressable(n: number): Progressable<number> {
    const p = new Promise<number>((resolve, reject) => {
        setTimeout(() => {
            resolve(n);
        }, n);
    });

    const pr = new Progressable(p);

    const start = +(new Date());
    function tick() {
        const ms = +(new Date());
        const t = (ms - start) / n;
        pr.setProgress(t);
        if (t < 1)
            window.requestAnimationFrame(tick);
    }
    tick();

    return pr;
}
