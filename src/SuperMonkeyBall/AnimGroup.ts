import { mat4, vec3 } from "gl-matrix";
import {
    MathConstants,
    setMatrixTranslation, transformVec3Mat4w1
} from "../MathHelpers";
import { assertExists } from "../util";
import { interpolateKeyframes, loopWrap } from "./Anim";
import { Lighting } from "./Lighting";
import { ModelInst, RenderParams, RenderSort } from "./Model";
import { GmaSrc, ModelCache } from "./ModelCache";
import { CommonModelID } from "./ModelInfo";
import { RenderContext } from "./Render";
import * as SD from "./Stagedef";
import { StageId } from "./StageInfo";
import { MkbTime, S16_TO_RADIANS } from "./Utils";
import { StageData, WorldState } from "./World";

const scratchRenderParams = new RenderParams();

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchMat4a = mat4.create();
export class AnimGroup {
    private models: ModelInst[];
    private blurBridgeAccordionModel: ModelInst | null = null;
    private worldFromAg: mat4;
    private originFromAg: mat4;
    private agData: SD.AnimGroup;
    private bananas: Banana[];
    private goals: Goal[];
    private bumpers: Bumper[];

    // Current translation, needed directly for blur bridge
    private translation = vec3.create();
    private loopedTimeSeconds = 0;

    constructor(modelCache: ModelCache, private stageData: StageData, private animGroupIdx: number) {
        this.agData = stageData.stagedef.animGroups[animGroupIdx];
        this.models = [];
        for (let i = 0; i < this.agData.animGroupModels.length; i++) {
            const name = this.agData.animGroupModels[i].modelName;
            const modelInst = modelCache.getModel(name, GmaSrc.StageAndBg);
            if (modelInst !== null) {
                this.models.push(modelInst);
            }
        }

        this.worldFromAg = mat4.create();
        this.originFromAg = mat4.create();

        if (animGroupIdx > 0) {
            // Not in world space, animate
            mat4.fromXRotation(this.originFromAg, -this.agData.originRot[0] * S16_TO_RADIANS);
            mat4.rotateY(this.originFromAg, this.originFromAg, -this.agData.originRot[1] * S16_TO_RADIANS);
            mat4.rotateZ(this.originFromAg, this.originFromAg, -this.agData.originRot[2] * S16_TO_RADIANS);
            const negOrigin = scratchVec3a;
            vec3.negate(negOrigin, this.agData.originPos);
            mat4.translate(this.originFromAg, this.originFromAg, negOrigin);
        } else {
            // In world space
            mat4.identity(this.originFromAg);
            mat4.identity(this.worldFromAg);
        }

        this.bananas = this.agData.bananas.map((ban) => new Banana(modelCache, ban));
        this.goals = this.agData.goals.map((goal) => new Goal(modelCache, goal));
        this.bumpers = this.agData.bumpers.map((bumper) => new Bumper(modelCache, bumper));

        if (stageData.stageInfo.id === StageId.St101_Blur_Bridge) {
            this.blurBridgeAccordionModel = assertExists(modelCache.getModel("MOT_STAGE101_BLUR", GmaSrc.StageAndBg));
        }
    }

    public update(state: WorldState): void {
        // Check if this is the world space anim group
        if (this.animGroupIdx > 0) {
            this.loopedTimeSeconds = loopWrap(
                state.time.getAnimTimeSeconds(),
                this.stageData.stagedef.loopStartSeconds,
                this.stageData.stagedef.loopEndSeconds
            );

            // Use initial values if there are no corresponding keyframes
            vec3.copy(this.translation, this.agData.originPos);
            const rotRadians = scratchVec3b;
            vec3.scale(rotRadians, this.agData.originRot, S16_TO_RADIANS);
            const anim = this.agData.anim;

            if (anim !== null) {
                if (anim.posXKeyframes.length !== 0) {
                    this.translation[0] = interpolateKeyframes(this.loopedTimeSeconds, anim.posXKeyframes);
                }
                if (anim.posYKeyframes.length !== 0) {
                    this.translation[1] = interpolateKeyframes(this.loopedTimeSeconds, anim.posYKeyframes);
                }
                if (anim.posZKeyframes.length !== 0) {
                    this.translation[2] = interpolateKeyframes(this.loopedTimeSeconds, anim.posZKeyframes);
                }
                if (anim.rotXKeyframes.length !== 0) {
                    rotRadians[0] =
                        interpolateKeyframes(this.loopedTimeSeconds, anim.rotXKeyframes) * MathConstants.DEG_TO_RAD;
                }
                if (anim.rotYKeyframes.length !== 0) {
                    rotRadians[1] =
                        interpolateKeyframes(this.loopedTimeSeconds, anim.rotYKeyframes) * MathConstants.DEG_TO_RAD;
                }
                if (anim.rotZKeyframes.length !== 0) {
                    rotRadians[2] =
                        interpolateKeyframes(this.loopedTimeSeconds, anim.rotZKeyframes) * MathConstants.DEG_TO_RAD;
                }
            }

            mat4.fromTranslation(this.worldFromAg, this.translation);
            mat4.rotateZ(this.worldFromAg, this.worldFromAg, rotRadians[2]);
            mat4.rotateY(this.worldFromAg, this.worldFromAg, rotRadians[1]);
            mat4.rotateX(this.worldFromAg, this.worldFromAg, rotRadians[0]);
            mat4.mul(this.worldFromAg, this.worldFromAg, this.originFromAg);
        }

        for (let i = 0; i < this.bananas.length; i++) {
            this.bananas[i].update(state);
        }
        for (let i = 0; i < this.bumpers.length; i++) {
            this.bumpers[i].update(state);
        }
    }

    private drawBlurBridgeAccordion(state: WorldState, ctx: RenderContext): void {
        if (
            this.blurBridgeAccordionModel === null ||
            this.animGroupIdx === 0 ||
            this.agData.animGroupModels.length === 0 ||
            this.agData.anim === null
        ) {
            return;
        }

        const rp = scratchRenderParams;
        rp.reset();
        rp.lighting = state.lighting;

        const accordionPos = scratchVec3a;
        vec3.copy(accordionPos, this.translation);

        const prevX = interpolateKeyframes(this.loopedTimeSeconds - 0.5, this.agData.anim.posXKeyframes);
        const flip = prevX >= accordionPos[0];
        const deltaX = Math.abs(prevX - accordionPos[0]);
        accordionPos[0] = (accordionPos[0] + prevX) / 2 + (flip ? 1 : -1);

        mat4.translate(rp.viewFromModel, ctx.viewerInput.camera.viewMatrix, accordionPos);
        if (flip) {
            mat4.rotateY(rp.viewFromModel, rp.viewFromModel, Math.PI);
        }

        const scale = scratchVec3a;
        vec3.set(scale, deltaX / 2, 1, 1);
        mat4.scale(rp.viewFromModel, rp.viewFromModel, scale);

        this.blurBridgeAccordionModel.prepareToRender(ctx, rp);
    }

    public prepareToRender(state: WorldState, ctx: RenderContext) {
        const rp = scratchRenderParams;
        rp.reset();
        rp.lighting = state.lighting;

        const viewFromAnimGroup = scratchMat4a;
        mat4.mul(viewFromAnimGroup, ctx.viewerInput.camera.viewMatrix, this.worldFromAg);
        mat4.copy(rp.viewFromModel, viewFromAnimGroup);

        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(ctx, rp);
        }
        for (let i = 0; i < this.bananas.length; i++) {
            this.bananas[i].prepareToRender(state, ctx, viewFromAnimGroup);
        }
        for (let i = 0; i < this.goals.length; i++) {
            this.goals[i].prepareToRender(state, ctx, viewFromAnimGroup);
        }
        for (let i = 0; i < this.bumpers.length; i++) {
            this.bumpers[i].prepareToRender(state, ctx, viewFromAnimGroup);
        }

        this.drawBlurBridgeAccordion(state, ctx);
    }
}


const scratchVec3c = vec3.create();
class Banana {
    private model: ModelInst;
    private yRotRadians: number = 0;

    constructor(modelCache: ModelCache, private bananaData: SD.Banana) {
        const modelId =
            bananaData.type === SD.BananaType.Single
                ? CommonModelID.OBJ_BANANA_01_LOD150
                : CommonModelID.OBJ_BANANA_02_LOD100;
        this.model = assertExists(modelCache.getModel(modelId, GmaSrc.Common));
    }

    public update(state: WorldState): void {
        const incRadians = S16_TO_RADIANS * (this.bananaData.type === SD.BananaType.Single ? 1024 : 768);
        this.yRotRadians += incRadians * state.time.getDeltaTimeFrames();
        this.yRotRadians %= 2 * Math.PI;
    }

    public prepareToRender(state: WorldState, ctx: RenderContext, viewFromAnimGroup: mat4): void {
        const rp = scratchRenderParams;
        rp.reset();
        rp.sort = RenderSort.None;
        rp.lighting = state.lighting;

        // Bananas' positions are parented to their anim group, but they have a global rotation in
        // world space
        mat4.rotateY(rp.viewFromModel, ctx.viewerInput.camera.viewMatrix, this.yRotRadians);
        const posViewSpace = scratchVec3c;
        transformVec3Mat4w1(posViewSpace, viewFromAnimGroup, this.bananaData.pos);
        setMatrixTranslation(rp.viewFromModel, posViewSpace);

        this.model.prepareToRender(ctx, rp);
    }
}

class Goal {
    private model: ModelInst;

    constructor(modelCache: ModelCache, private goalData: SD.Goal) {
        if (goalData.type === SD.GoalType.Blue) {
            this.model = assertExists(modelCache.getBlueGoalModel());
        } else if (goalData.type === SD.GoalType.Green) {
            this.model = assertExists(modelCache.getGreenGoalModel());
        } else {
            // Red goal
            this.model = assertExists(modelCache.getRedGoalModel());
        }
    }

    public prepareToRender(state: WorldState, ctx: RenderContext, viewFromAnimGroup: mat4): void {
        const rp = scratchRenderParams;
        rp.reset();
        rp.lighting = state.lighting;

        mat4.translate(rp.viewFromModel, viewFromAnimGroup, this.goalData.pos);
        mat4.rotateZ(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.goalData.rot[2]);
        mat4.rotateY(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.goalData.rot[1]);
        mat4.rotateX(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.goalData.rot[0]);

        this.model.prepareToRender(ctx, rp);
    }
}

class Bumper {
    private model: ModelInst;
    private yRotRadians: number = 0;

    constructor(modelCache: ModelCache, private bumperData: SD.Bumper) {
        this.model = assertExists(modelCache.getBumperModel());
    }

    public update(state: WorldState): void {
        const incRadians = S16_TO_RADIANS * 0x100;
        this.yRotRadians += incRadians * state.time.getDeltaTimeFrames();
        this.yRotRadians %= 2 * Math.PI;
    }

    public prepareToRender(state: WorldState, ctx: RenderContext, viewFromAnimGroup: mat4): void {
        const rp = scratchRenderParams;
        rp.reset();
        rp.lighting = state.lighting;

        mat4.translate(rp.viewFromModel, viewFromAnimGroup, this.bumperData.pos);
        mat4.rotateZ(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.bumperData.rot[2]);
        mat4.rotateY(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.bumperData.rot[1]);
        mat4.rotateX(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.bumperData.rot[0]);
        mat4.scale(rp.viewFromModel, rp.viewFromModel, this.bumperData.scale);
        mat4.rotateY(rp.viewFromModel, rp.viewFromModel, this.yRotRadians);

        this.model.prepareToRender(ctx, rp);
    }
}
