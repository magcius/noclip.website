import { ObjectInstance, ObjectUpdateContext } from "../objects.js";
import { World } from "../world.js";

// This class is placed in its own file to avoid "Cannot access SFAClass before initialization" errors.

export class SFAClass {
    // Called when loading objects
    constructor(obj: ObjectInstance, data: DataView) { }
    // Called when adding objects to world, after all objects have been loaded
    public mount(obj: ObjectInstance, world: World): void { }
    // Called when removing objects from world
    public unmount(obj: ObjectInstance, world: World): void { }
    // Called on each frame
    public update(obj: ObjectInstance, updateCtx: ObjectUpdateContext): void { }
}