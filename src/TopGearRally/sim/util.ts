const SHORT_SORT_LIMIT = 8;
const SORT_STACK_SIZE = 30;

export type CompareFunc<T> = (a: T, b: T) => number;

function swap<T>(array: T[], a: number, b: number): void {
    if (a !== b) {
        const temp = array[a];
        array[a] = array[b];
        array[b] = temp;
    }
}

export function ShortSort<T>(array: T[], lo: number, hi: number, compare: CompareFunc<T>): void {
    for (; hi > lo; hi--) {
        let max = lo;
        for (let p = lo + 1; p <= hi; p++) {
            if (compare(array[p], array[max]) > 0) {
                max = p;
            }
        }
        swap(array, max, hi);
    }
}

export function QuickSort<T>(base: T[], count: number, compare: CompareFunc<T>, start = 0): void {
    if (count < 2) {
        return;
    }
    const lostk = new Array<number>(SORT_STACK_SIZE);
    const histk = new Array<number>(SORT_STACK_SIZE);
    let stkptr = 0;
    let lo = start;
    let hi = start + count - 1;
    for (;;) {
        const n = hi - lo + 1;
        if (n <= SHORT_SORT_LIMIT) {
            ShortSort(base, lo, hi, compare);
        } else {
            const mid = lo + Math.floor(n / 2);
            swap(base, mid, lo);
            let loguy = lo;
            let higuy = hi + 1;
            for (;;) {
                do {
                    loguy++;
                } while (loguy <= hi && compare(base[loguy], base[lo]) <= 0);
                do {
                    higuy--;
                } while (higuy > lo && compare(base[higuy], base[lo]) >= 0);
                if (higuy < loguy) {
                    break;
                }
                swap(base, loguy, higuy);
            }
            swap(base, lo, higuy);
            if (higuy - lo > hi - loguy) {
                if (lo + 1 < higuy) {
                    lostk[stkptr] = lo;
                    histk[stkptr] = higuy - 1;
                    stkptr++;
                }
                if (loguy < hi) {
                    lo = loguy;
                    continue;
                }
            } else {
                if (loguy < hi) {
                    lostk[stkptr] = loguy;
                    histk[stkptr] = hi;
                    stkptr++;
                }
                if (lo + 1 < higuy) {
                    hi = higuy - 1;
                    continue;
                }
            }
        }
        stkptr--;
        if (stkptr < 0) {
            return;
        }
        lo = lostk[stkptr];
        hi = histk[stkptr];
    }
}
