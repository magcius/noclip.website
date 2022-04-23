import AnimationController from "../AnimationController";
import { RenderContext } from "./Render";
import { BgModelInst } from "./BgModel";
import { RenderParams } from "./Model";
import { mat4, vec3 } from "gl-matrix";
import { Vec3Zero } from "../MathHelpers";

export interface Background {
    update(animController: AnimationController): void;
    prepareToRender(ctx: RenderContext): void;
}

export interface BackgroundConstructor {
    new (bgModels: BgModelInst[]): Background;
}

const scratchMat4a = mat4.create();

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

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
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

type SunsetModel = {
    bgModel: BgModelInst;
    currTexTranslate: vec3;
    currTexVel: vec3;
    desiredTexVel: vec3;
};

export class BgSunset implements Background {
    private bgModels: BgModelInst[] = [];
    private cloudModels: SunsetModel[] = []; // Models to apply texture scroll to
    private lastTimeFrames: number = 0;

    constructor(bgModels: BgModelInst[]) {
        for (const bgModel of bgModels) {
            const name = bgModel.bgModelData.modelName;
            if (name === "SUN_GROUND" || name.startsWith("SUN_CLOUD_")) {
                const cloudModel: SunsetModel = {
                    bgModel,
                    currTexTranslate: vec3.create(),
                    currTexVel: vec3.create(),
                    desiredTexVel: vec3.create(),
                };
                this.cloudModels.push(cloudModel);

                vec3.set(cloudModel.currTexTranslate, Math.random(), Math.random(), Math.random());
                vec3.set(cloudModel.desiredTexVel, 0, (Math.random() * 0.2 + 0.9) * 0.0015151514671742916, 0);
                vec3.rotateZ(cloudModel.desiredTexVel, cloudModel.desiredTexVel, Vec3Zero, Math.random() * Math.PI);
                vec3.copy(cloudModel.currTexVel, cloudModel.desiredTexVel);
            } else {
                this.bgModels.push(bgModel);
            }
        }
    }

    public update(animController: AnimationController): void {
        const deltaFrames = animController.getTimeInFrames() - this.lastTimeFrames;
        this.lastTimeFrames = animController.getTimeInFrames();

        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(animController);
        }

        for (let i = 0; i < this.cloudModels.length; i++) {
            const cloudModel = this.cloudModels[i];
            cloudModel.bgModel.update(animController);
            vec3.scaleAndAdd(
                cloudModel.currTexTranslate,
                cloudModel.currTexTranslate,
                cloudModel.currTexVel,
                deltaFrames
            );
        }
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx);
        }

        for (let i = 0; i < this.cloudModels.length; i++) {
            const cloudModel = this.cloudModels[i];
            const texMtx = scratchMat4a;
            mat4.fromTranslation(texMtx, cloudModel.currTexTranslate);
            cloudModel.bgModel.prepareToRender(ctx, texMtx);
        }
    }
}

export class BgSpace implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
}

export class BgSand implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
}

export class BgIce implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
}

export class BgStorm implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
}

export class BgBonus implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
}

export class BgMaster implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {}

    public update(animController: AnimationController): void {}

    public prepareToRender(ctx: RenderContext): void {}
}
