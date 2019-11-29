
import { Destroyable } from "./SceneBase";
import { GfxDevice } from "./gfx/platform/GfxPlatform";

// The DataShare lets two scenes share objects that might want to be kept between scenes.

class DataShareObject<T extends Destroyable> {
    constructor(public object: T, public lastUsedAge: number) {
    }
}

export class DataShare {
    private objects = new Map<string, DataShareObject<Destroyable>>();
    private currentAge = 0;

    public loadNewScene(): void {
        this.currentAge++;
    }

    private deleteObjectsOlderThan(device: GfxDevice, ageThreshold: number): void {
        for (const [k, v] of this.objects.entries()) {
            if (v.lastUsedAge <= ageThreshold) {
                v.object.destroy(device);
                this.objects.delete(k);
            }
        }
    }

    public pruneOldObjects(device: GfxDevice, delta: number): void {
        const ageThreshold = this.currentAge - delta;
        this.deleteObjectsOlderThan(device, ageThreshold);
    }

    public setObject<T extends Destroyable>(key: string, object: T): void {
        const dsObject = new DataShareObject(object, this.currentAge);
        this.objects.set(key, dsObject);
    }

    public getObject<T extends Destroyable>(key: string): T | null {
        if (this.objects.has(key)) {
            const dsObject = this.objects.get(key)!;
            dsObject.lastUsedAge = this.currentAge;
            return dsObject.object as T;
        } else {
            return null;
        }
    }

    public async ensureObject<T extends Destroyable>(key: string, ensureFunc: () => Promise<T>): Promise<T> {
        let object = this.getObject(key) as T;
        if (object === null) {
            object = await ensureFunc();
            this.setObject(key, object);
        }
        return object;
    }
}
