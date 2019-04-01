
export default class Progressable<T> {
    public promise: PromiseLike<T>;
    public chainProgressable: Progressable<any> | null = null;
    public onProgress: (() => void) | null = null;
    public progress: number; // Between 0 and 1.

    constructor(promise: PromiseLike<T>, initialProgress: number = 0) {
        this.promise = promise;
        this.progress = initialProgress;
    }

    public setProgress(n: number) {
        this.progress = n;
        if (this.onProgress !== null)
            this.onProgress();
        if (this.chainProgressable !== null)
            this.chainProgressable.setProgress(this.progress);
    }

    public then<TResult>(onfulfilled?: ((value: T) => TResult | PromiseLike<TResult> | Progressable<TResult>)): Progressable<TResult> {
        const pr = new Progressable<TResult>(this.promise.then((b) => {
            const result = onfulfilled(b);

            if (result instanceof Progressable) {
                // If a callback returns a Progressable, then bubble that progress up to us.
                result.chainProgressable = this;
                this.setProgress(result.progress);
                return result.promise;
            } else {
                return result;
            }
        }), this.progress);

        // Any then-able chain is the same progress as this one (however it can also report progress which will replace this).
        this.chainProgressable = pr;

        return pr;
    }

    public static resolve<T>(value: T): Progressable<T> {
        return new Progressable(Promise.resolve(value), 1);
    }

    public static all<T>(progressables: Progressable<T>[]): Progressable<T[]> {
        const p = Promise.all(progressables.map((p) => p.promise));
        function calcProgress() {
            const progresses = progressables.map((p) => p.progress);
            pr.setProgress(avg(progresses));
        }
        progressables.forEach((p) => {
            p.onProgress = calcProgress;
        });
        const pr = new Progressable<T[]>(p);
        calcProgress();
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
