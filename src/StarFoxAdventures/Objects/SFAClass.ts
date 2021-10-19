import { ObjectInstance, ObjectUpdateContext } from "../objects";
import { World } from "../world";

// This class is placed in its own file to avoid "Cannot access SFAClass before initialization" errors.

export class SFAClass {
    // Called when loading objects
    public constructor(obj: ObjectInstance, data: DataView) { }
    // Called when adding objects to world, after all objects have been loaded
    public mount(obj: ObjectInstance, world: World): void { }
    // Called when removing objects from world
    public unmount(obj: ObjectInstance, world: World): void { }
    // Called on each frame
    public update(obj: ObjectInstance, updateCtx: ObjectUpdateContext): void { }
}