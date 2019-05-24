
import { assertExists } from "./util";

export default abstract class MemoizeCache<TKey, TRes> {
    private cache = new Map<string, TRes>();

    protected abstract make(key: TKey): TRes | null;
    protected abstract makeKey(key: TKey): string;

    public get(key: TKey): TRes | null {
        const keyStr = this.makeKey(key);
        if (this.cache.has(keyStr)) {
            return assertExists(this.cache.get(keyStr));
        } else {
            const obj = this.make(key);
            if (obj !== null)
                this.cache.set(keyStr, obj);
            return obj;
        }
    }

    public clear(): void {
        this.cache.clear();
    }
}
