import { mat4, vec3 } from "gl-matrix";
import AnimationController from "../AnimationController";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import * as Viewer from "../viewer";
import { interpolateAnimPose, loopWrap } from "./Anim";
import { Background } from "./Background";
import { BgModelInst } from "./BgModel";
import * as Gma from "./Gma";
import { ModelInst, RenderParams } from "./Model";
import { ModelCache } from "./ModelCache";
import { RenderContext } from "./Render";
import * as SD from "./Stagedef";
import { StageInfo } from "./StageInfo";
import { S16_TO_RADIANS } from "./Utils";

const scratchRenderParams: RenderParams = { alpha: 0, sort: "none" };

// Immutable parsed stage definition
export type StageData = {
    stageInfo: StageInfo;
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
};

const scratchVec3a = vec3.create();
const scratchMat4a = mat4.create();
class Itemgroup {
    private models: ModelInst[];
    private worldFromIg: mat4;
    private originFromIg: mat4;
    private igData: SD.Itemgroup;

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        modelCache: ModelCache,
        private stagedef: SD.Stage,
        private itemgroupIdx: number
    ) {
        this.igData = stagedef.itemgroups[itemgroupIdx];
        this.models = [];
        for (let i = 0; i < this.igData.levelModels.length; i++) {
            const name = this.igData.levelModels[i].modelName;
            const modelInst = modelCache.getModel(device, renderCache, name);
            if (modelInst !== null) {
                this.models.push(modelInst);
            }
        }

        this.worldFromIg = mat4.create();
        this.originFromIg = mat4.create();

        if (itemgroupIdx > 0) {
            // Not in world space, animate
            mat4.fromXRotation(this.originFromIg, -this.igData.originRot[0] * S16_TO_RADIANS);
            mat4.rotateY(this.originFromIg, this.originFromIg, -this.igData.originRot[1] * S16_TO_RADIANS);
            mat4.rotateZ(this.originFromIg, this.originFromIg, -this.igData.originRot[2] * S16_TO_RADIANS);
            const negOrigin = scratchVec3a;
            vec3.negate(negOrigin, this.igData.originPos);
            mat4.translate(this.originFromIg, this.originFromIg, negOrigin);
        } else {
            // In world space
            mat4.identity(this.originFromIg);
            mat4.identity(this.worldFromIg);
        }
    }

    public update(animController: AnimationController): void {
        // Check if this is the world space itemgroup
        if (this.itemgroupIdx === 0) return;

        const loopedTimeSeconds = loopWrap(
            animController.getTimeInSeconds(),
            this.stagedef.loopStartSeconds,
            this.stagedef.loopEndSeconds
        );

        const worldFromOrigin = scratchMat4a;
        interpolateAnimPose(
            worldFromOrigin,
            loopedTimeSeconds,
            this.igData.anim.posXKeyframes,
            this.igData.anim.posYKeyframes,
            this.igData.anim.posZKeyframes,
            this.igData.anim.rotXKeyframes,
            this.igData.anim.rotYKeyframes,
            this.igData.anim.rotZKeyframes
        );
        mat4.mul(this.worldFromIg, worldFromOrigin, this.originFromIg);
    }

    public prepareToRender(ctx: RenderContext) {
        const rp = scratchRenderParams;
        rp.alpha = 1.0;
        rp.sort = "translucent";

        const viewFromIg = scratchMat4a;
        mat4.mul(viewFromIg, ctx.viewerInput.camera.viewMatrix, this.worldFromIg);
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(ctx, viewFromIg, rp);
        }
    }
}

export class World {
    private animTime: number;
    private animController: AnimationController;
    private itemgroups: Itemgroup[];
    private background: Background;

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        private modelCache: ModelCache,
        private stageData: StageData
    ) {
        this.animController = new AnimationController(60);
        this.itemgroups = stageData.stagedef.itemgroups.map(
            (_, i) => new Itemgroup(device, renderCache, modelCache, stageData.stagedef, i)
        );
        this.animTime = 0;

        const bgModels: BgModelInst[] = [];
        for (const bgModel of stageData.stagedef.bgModels.concat(stageData.stagedef.fgModels)) {
            if (!(bgModel.flags & SD.BgModelFlags.Visible)) continue;
            const model = modelCache.getModel(device, renderCache, bgModel.modelName);
            if (model === null) continue;
            bgModels.push(new BgModelInst(model, bgModel));
        }
        this.background = new stageData.stageInfo.bgInfo.bgConstructor(bgModels);
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.animTime += viewerInput.deltaTime;
        this.animController.setTimeInMilliseconds(this.animTime);
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].update(this.animController);
        }
        this.background.update(this.animController);
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].prepareToRender(ctx);
        }
        this.background.prepareToRender(ctx);
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}
