
export interface ProgressMeter {
    setProgress(n: number): void;
}

export default class Progressable<T> {
    public promise: PromiseLike<T> | null;
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
        const prThen = new Progressable<TResult>(this.promise.then((b) => {
            const result = onfulfilled(b);

            // Clear our promise out so that objects allocated from the promise callback itself can be collected.
            this.promise = null;

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
        this.chainProgressable = prThen;

        return prThen;
    }

    public static resolve<T>(value: T): Progressable<T> {
        return new Progressable(Promise.resolve(value), 1);
    }

    public static all<T>(progressables: Progressable<T>[]): Progressable<T[]> {
        const pAll = Promise.all(progressables.map((p) => p.promise));
        function calcProgress() {
            const progresses = progressables.map((p) => p.progress);
            prAll.setProgress(avg(progresses));
        }
        progressables.forEach((p) => {
            p.onProgress = calcProgress;
        });
        const prAll = new Progressable<T[]>(pAll);
        calcProgress();
        return prAll;
    }
}

function avg(L: number[]) {
    let s = 0;
    L.forEach((i) => s += i);
    s /= L.length;
    return s;
}
