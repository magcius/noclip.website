import { RenderContext } from "./Render";
import { BgModelInst } from "./BgModel";
import { RenderParams } from "./Model";
import { mat4, vec3 } from "gl-matrix";
import { Vec3Zero } from "../MathHelpers";
import { MkbTime, MKB_FPS } from "./Utils";
import { Lighting } from "./World";

export interface Background {
    update(t: MkbTime): void;
    prepareToRender(ctx: RenderContext, lighting: Lighting): void;
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

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgWater implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgNight implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

type SunsetModel = {
    bgModel: BgModelInst;
    currTexTranslate: vec3;
    currTexVel: vec3;
    desiredTexVel: vec3;
};

const enum BgSunsetMode {
    Default,
    HurryUp,
}

export class BgSunset implements Background {
    private bgModels: BgModelInst[] = [];
    private cloudModels: SunsetModel[] = []; // Models to apply texture scroll to
    private lastTimeFrames: number = 0;
    private mode = BgSunsetMode.Default;

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

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }

        // At 11s remaining on the clock ("hurry up!"), change cloud scroll direction and speed up
        let speedUpClouds = false;
        if (this.mode === BgSunsetMode.Default && t.getStageTimeFrames() < 660) {
            this.mode = BgSunsetMode.HurryUp;
            speedUpClouds = true;
        }

        for (let i = 0; i < this.cloudModels.length; i++) {
            const cloudModel = this.cloudModels[i];
            cloudModel.bgModel.update(t);
            if (speedUpClouds) {
                vec3.set(cloudModel.desiredTexVel, 0, (Math.random() * 0.2 + 0.9) * 0.0030303029343485832, 0);
                vec3.rotateZ(cloudModel.desiredTexVel, cloudModel.desiredTexVel, Vec3Zero, Math.random() * Math.PI);
            }
            // Exponential interpolate desired tex vel towards current tex vel
            const lerp = Math.pow(0.95, t.getDeltaTimeFrames()); // Adjust lerp multipler for framerate
            vec3.lerp(cloudModel.currTexVel, cloudModel.desiredTexVel, cloudModel.currTexVel, lerp);
            vec3.scaleAndAdd(
                cloudModel.currTexTranslate,
                cloudModel.currTexTranslate,
                cloudModel.currTexVel,
                t.getDeltaTimeFrames()
            );
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }

        for (let i = 0; i < this.cloudModels.length; i++) {
            const cloudModel = this.cloudModels[i];
            const texMtx = scratchMat4a;
            mat4.fromTranslation(texMtx, cloudModel.currTexTranslate);
            cloudModel.bgModel.prepareToRender(ctx, lighting, texMtx);
        }
    }
}

export class BgSpace implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgSand implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgIce implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgStorm implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgBonus implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}

export class BgMaster implements Background {
    private bgModels: BgModelInst[] = [];

    constructor(bgModels: BgModelInst[]) {
        this.bgModels = bgModels;
    }

    public update(t: MkbTime): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting): void {
        for (let i = 0; i < this.bgModels.length; i++) {
            this.bgModels[i].prepareToRender(ctx, lighting);
        }
    }
}
