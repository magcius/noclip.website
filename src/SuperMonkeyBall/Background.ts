import AnimationController from "../AnimationController";
import { RenderContext } from "./Render";
import {BgModelInst} from "./BgModel";

export interface Background {
    update(animController: AnimationController): void;
    prepareToRender(ctx: RenderContext): void;
}

export interface BackgroundConstructor {
    new (bgModels: BgModelInst[]): Background;
}

export class BgJungle implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(animController: AnimationController): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(animController);
        }
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx);
        }
    }
}

export class BgWater implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

export class BgNight implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(animController: AnimationController): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(animController);
        }
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx);
        }
    }
}

export class BgSunset implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(animController: AnimationController): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(animController);
        }
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx);
        }
    }
}

export class BgSpace implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

export class BgSand implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

export class BgIce implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

export class BgStorm implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

export class BgBonus implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

export class BgMaster implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
    }

    public update(animController: AnimationController): void {
        
    }

    public prepareToRender(ctx: RenderContext): void {
        
    }
}

