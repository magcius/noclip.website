import { RenderContext } from "./Render";
import { BgObjectInst } from "./BgObject";
import { ModelInst, RenderParams } from "./Model";
import { mat4, vec3 } from "gl-matrix";
import { Vec3Zero } from "../MathHelpers";
import { getMat4RotY, MkbTime, MKB_FPS } from "./Utils";
import { Lighting } from "./Lighting";
import { BgStormModelID } from "./ModelInfo";
import { GmaSrc, ModelCache } from "./ModelCache";
import { Gma } from "./Gma";
import { assertExists, nArray } from "../util";
import { WorldState } from "./World";

export interface Background {
    update(state: WorldState): void;
    prepareToRender(state: WorldState, ctx: RenderContext): void;
}

export interface BackgroundConstructor {
    new (state: WorldState, bgObjects: BgObjectInst[]): Background;
}

const scratchMat4a = mat4.create();
const scratchRenderParams = new RenderParams();

export class BgJungle implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

export class BgWater implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

export class BgNight implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

type SunsetModel = {
    bgObject: BgObjectInst;
    currTexTranslate: vec3;
    currTexVel: vec3;
    desiredTexVel: vec3;
};

const enum BgSunsetMode {
    Default,
    HurryUp,
}

export class BgSunset implements Background {
    private bgObjects: BgObjectInst[] = [];
    private cloudModels: SunsetModel[] = []; // Models to apply texture scroll to
    private lastTimeFrames: number = 0;
    private mode = BgSunsetMode.Default;

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        for (const bgObject of bgObjects) {
            const name = bgObject.bgObjectData.modelName;
            if (name === "SUN_GROUND" || name.startsWith("SUN_CLOUD_")) {
                const cloudModel: SunsetModel = {
                    bgObject: bgObject,
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
                this.bgObjects.push(bgObject);
            }
        }
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }

        // At 11s remaining on the clock ("hurry up!"), change cloud scroll direction and speed up
        let speedUpClouds = false;
        if (this.mode === BgSunsetMode.Default && state.time.getStageTimeFrames() < 660) {
            this.mode = BgSunsetMode.HurryUp;
            speedUpClouds = true;
        }

        for (let i = 0; i < this.cloudModels.length; i++) {
            const cloudModel = this.cloudModels[i];
            cloudModel.bgObject.update(state);
            if (speedUpClouds) {
                vec3.set(cloudModel.desiredTexVel, 0, (Math.random() * 0.2 + 0.9) * 0.0030303029343485832, 0);
                vec3.rotateZ(cloudModel.desiredTexVel, cloudModel.desiredTexVel, Vec3Zero, Math.random() * Math.PI);
            }
            // Exponential interpolate desired tex vel towards current tex vel
            const lerp = Math.pow(0.95, state.time.getDeltaTimeFrames()); // Adjust lerp multipler for framerate
            vec3.lerp(cloudModel.currTexVel, cloudModel.desiredTexVel, cloudModel.currTexVel, lerp);
            vec3.scaleAndAdd(
                cloudModel.currTexTranslate,
                cloudModel.currTexTranslate,
                cloudModel.currTexVel,
                state.time.getDeltaTimeFrames()
            );
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }

        for (let i = 0; i < this.cloudModels.length; i++) {
            const cloudModel = this.cloudModels[i];
            const texMtx = scratchMat4a;
            mat4.fromTranslation(texMtx, cloudModel.currTexTranslate);
            cloudModel.bgObject.prepareToRender(state, ctx, texMtx);
        }
    }
}

export class BgSpace implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

export class BgSand implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

export class BgIce implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

const STORM_FIRE_MODELS = [
    BgStormModelID.STM_FIRE00,
    BgStormModelID.STM_FIRE01,
    BgStormModelID.STM_FIRE02,
    BgStormModelID.STM_FIRE03,
    BgStormModelID.STM_FIRE04,
    BgStormModelID.STM_FIRE05,
    BgStormModelID.STM_FIRE06,
    BgStormModelID.STM_FIRE07,
    BgStormModelID.STM_FIRE08,
    BgStormModelID.STM_FIRE09,
    BgStormModelID.STM_FIRE10,
    BgStormModelID.STM_FIRE11,
    BgStormModelID.STM_FIRE12,
    BgStormModelID.STM_FIRE13,
    BgStormModelID.STM_FIRE14,
    BgStormModelID.STM_FIRE15,
    BgStormModelID.STM_FIRE16,
    BgStormModelID.STM_FIRE17,
    BgStormModelID.STM_FIRE18,
    BgStormModelID.STM_FIRE19,
    BgStormModelID.STM_FIRE20,
    BgStormModelID.STM_FIRE21,
    BgStormModelID.STM_FIRE22,
    BgStormModelID.STM_FIRE23,
    BgStormModelID.STM_FIRE24,
    BgStormModelID.STM_FIRE25,
    BgStormModelID.STM_FIRE26,
    BgStormModelID.STM_FIRE27,
    BgStormModelID.STM_FIRE28,
    BgStormModelID.STM_FIRE29,
    BgStormModelID.STM_FIRE30,
    BgStormModelID.STM_FIRE31,
];

export class BgStorm implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;

        // Cache fire models
        for (let i = 0; i < STORM_FIRE_MODELS.length; i++) {
            state.modelCache.getModel(STORM_FIRE_MODELS[i], GmaSrc.Bg);
        }
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);

            const flipbookAnims = this.bgObjects[i].bgObjectData.flipbookAnims;
            if (flipbookAnims === null) continue;
            for (let j = 0; j < flipbookAnims.stormFireAnims.length; j++) {
                const fireAnim = flipbookAnims.stormFireAnims[j];
                const fireFrame =
                    (Math.floor(state.time.getAnimTimeFrames()) + 4 * fireAnim.frameOffset) % STORM_FIRE_MODELS.length;
                const fireModel = assertExists(state.modelCache.getModel(STORM_FIRE_MODELS[fireFrame], GmaSrc.Bg));

                // Face fire towards camera on Y axis
                const rotY = getMat4RotY(ctx.viewerInput.camera.worldMatrix);

                const renderParams = scratchRenderParams;
                renderParams.reset();
                renderParams.lighting = state.lighting;
                mat4.translate(renderParams.viewFromModel, ctx.viewerInput.camera.viewMatrix, fireAnim.pos);
                mat4.rotateY(renderParams.viewFromModel, renderParams.viewFromModel, rotY);
                fireModel.prepareToRender(ctx, renderParams);
            }
        }
    }
}

export class BgBonus implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}

export class BgMaster implements Background {
    private bgObjects: BgObjectInst[] = [];

   constructor(state: WorldState, bgObjects: BgObjectInst[]) {
        this.bgObjects = bgObjects;
    }

    public update(state: WorldState): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].update(state);
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext): void {
        for (let i = 0; i < this.bgObjects.length; i++) {
            this.bgObjects[i].prepareToRender(state, ctx);
        }
    }
}
