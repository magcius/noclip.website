
import { dGlobals } from "./zww_scenes";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { vec3 } from "gl-matrix";
import { fopAcM_prm_class } from "./Actors";

// framework process

// Most of the base classes for things extend from this.

// Class methods. The game normally uses C-style vfuncs for these, but we go all-in on
// requiring classes for them.

export class base_process_class {
    // layer tag
    // line tag
    // delete tag
    // process priority

    constructor(globals: dGlobals) {

    }

    public execute(globals: dGlobals): void {
    }

    public delete(globals: dGlobals): void {
    }

    public isDelete(globals: dGlobals): boolean {
        return true;
    }
}

export class leafdraw_class extends base_process_class {
    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    }
}

// framework actor base class

export class fopAc_ac_c extends leafdraw_class {
    public pos = vec3.create();
    public rot = vec3.create();
    public scale = vec3.create();
    public parentPcId: number;
    public subtype: number;
    public parent: number;

    constructor(globals: dGlobals, prm: fopAcM_prm_class) {
        super(globals);

        vec3.copy(this.pos, prm.pos);
        vec3.copy(this.rot, prm.rot);
        vec3.copy(this.scale, prm.scale);
        this.subtype = prm.subtype;
    }
}

export function fopAcM_create(globals: dGlobals, pcName: number, arg: number, pos: vec3, roomNo: number, angle: vec3, scale: vec3, subtype: number): void {
    // Create on current layer.
    // TODO(jstpierre): Phase loading system.
}
