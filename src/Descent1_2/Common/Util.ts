/** Variant of Map with additional operations for caching. */
export class CacheMap<K, V> extends Map<K, V> {
    /** If key is in the map, return the value; else, compute it, place it in the map and then return it. */
    public computeIfAbsent(key: K, compute: (key: K) => V): V {
        if (this.has(key)) return this.get(key)!;
        const value = compute(key);
        this.set(key, value);
        return value;
    }

    /** If key is in the map, return the value; else, compute it, place it in the map and then return it.
     *
     * If the compute function returns null, returns null without entering it in the map.
     */
    public computeIfAbsentOrNull(
        key: K,
        compute: (key: K) => V | null,
    ): V | null {
        if (this.has(key)) return this.get(key)!;
        const value = compute(key);
        if (value === null) return null;
        this.set(key, value);
        return value;
    }
}

/** A map where the values are arrays, with a helper function. */
export class MultiMap<K, V> extends Map<K, V[]> {
    public add(key: K, value: V) {
        let array = this.get(key);
        if (array) {
            array.push(value);
        } else {
            array = [value];
            this.set(key, array);
        }
    }
}
