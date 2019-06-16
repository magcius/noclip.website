
// Quick and dirty HashMap for basic lookups.
// ECMAScript WeakMap does not allow two independent key objects to be "equivalent",
// which is the exact thing we want in our case. Currently not optimized at all.

import { nArray } from "./util";

// Jenkins One-at-a-Time hash from http://www.burtleburtle.net/bob/hash/doobs.html
export function hashCodeNumberUpdate(hash: number, v: number): number {
    hash += v;
    hash += hash << 10;
    hash += hash >>> 6;
    return hash >>> 0;
}

export function hashCodeNumberFinish(hash: number): number {
    hash += hash << 3;
    hash ^= hash >>> 11;
    hash += hash << 15;
    return hash >>> 0;
}

// Pass this as a hash function to use a one-bucket HashMap (equivalent to linear search in an array),
// which can be efficient for small numbers of items.
export function nullHashFunc<T>(k: T): number { return 0; }

export type EqualFunc<K> = (a: K, b: K) => boolean;
export type HashFunc<K> = (a: K) => number;

class HashBucket<K, V> {
    public keys: K[] = [];
    public values: V[] = [];
}

// TODO(jstpierre): Dynamic load factor.
export class HashMap<K, V> {
    public buckets: (HashBucket<K, V> | null)[];

    constructor(private keyEqualFunc: EqualFunc<K>, private keyHashFunc: HashFunc<K>, numBuckets = 16, private autoLoadFactor: number | null = null) {
        if (keyHashFunc === nullHashFunc)
            numBuckets = 1;
        this.buckets = nArray(numBuckets, () => null);
    }

    private findBucketIndex(bucket: HashBucket<K, V>, k: K): number {
        for (let i = 0; i < bucket.keys.length; i++)
            if (this.keyEqualFunc(k, bucket.keys[i]))
                return i;
        return -1;
    }

    private findBucket(k: K): HashBucket<K, V> | null {
        const bw = this.keyHashFunc(k) % this.buckets.length;
        return this.buckets[bw];
    }

    public get(k: K): V | null {
        const bucket = this.findBucket(k);
        if (bucket === null) return null;
        const bi = this.findBucketIndex(bucket, k);
        if (bi < 0) return null;
        return bucket.values[bi];
    }

    public add(k: K, v: V): void {
        const bw = this.keyHashFunc(k) % this.buckets.length;
        if (this.buckets[bw] === null) this.buckets[bw] = new HashBucket<K, V>();
        const bucket = this.buckets[bw]!;
        bucket.keys.push(k);
        bucket.values.push(v);

        if (this.autoLoadFactor !== null)
            this.reconfigureForLoadFactor(this.autoLoadFactor);
    }

    public delete(k: K): void {
        const bucket = this.findBucket(k);
        if (bucket === null) return;
        const bi = this.findBucketIndex(bucket, k);
        if (bi === -1) return;
        bucket.keys.splice(bi, 1);
        bucket.values.splice(bi, 1);
    }

    public clear(): void {
        for (let i = 0; i < this.buckets.length; i++) {
            const bucket = this.buckets[i];
            if (bucket === null) continue;
            bucket.keys = [];
            bucket.values = [];
        }
    }

    public size(): number {
        let acc = 0;
        for (let i = 0; i < this.buckets.length; i++) {
            const bucket = this.buckets[i];
            if (bucket === null) continue;
            acc += bucket.keys.length;
        }
        return acc;
    }

    public* entries(): IterableIterator<[K, V]> {
        for (let i = 0; i < this.buckets.length; i++) {
            const bucket = this.buckets[i];
            if (bucket === null) continue;
            for (let j = bucket.keys.length; j >= 0; j--)
                yield [bucket.keys[j], bucket.values[j]];
        }
    }

    public reconfigureForLoadFactor(loadFactor: number): void {
        let numBuckets = Math.ceil(this.size() / loadFactor);
        if (numBuckets <= this.buckets.length)
            return;

        // Align to nearest multiple of original numBuckets.

        const newBuckets: (HashBucket<K, V> | null)[] = nArray(numBuckets, () => null);
        for (let i = 0; i < this.buckets.length; i++) {
            const bucket = this.buckets[i];
            if (bucket === null) continue;
            for (let j = 0; j < bucket.keys.length; j++) {
                const bw = this.keyHashFunc(bucket.keys[j]) % newBuckets.length;
                if (newBuckets[bw] === null) newBuckets[bw] = new HashBucket<K, V>();
                const newBucket = newBuckets[bw]!;
                newBucket.keys.push(bucket.keys[j]);
                newBucket.values.push(bucket.values[j]);
            }
        }
        this.buckets = newBuckets;
    }

    public calcLoadFactor(): number {
        return this.size() / this.buckets.length;
    }
}
