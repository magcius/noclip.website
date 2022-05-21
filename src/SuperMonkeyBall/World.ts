import { mat4, vec3 } from "gl-matrix";
import { Color, colorCopy, colorNewCopy } from "../Color";
import { AABB } from "../Geometry";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GX_Program } from "../gx/gx_material";
import {
    MathConstants,
    transformVec3Mat4w0,
    transformVec3Mat4w1,
    Vec3UnitX,
    Vec3UnitY,
    Vec3UnitZ,
    Vec3Zero,
} from "../MathHelpers";
import * as Viewer from "../viewer";
import { interpolateKeyframes, loopWrap } from "./Anim";
import { Background } from "./Background";
import { BgModelInst } from "./BgModel";
import * as Gma from "./Gma";
import { ModelInst, RenderParams, RenderSort } from "./Model";
import { GmaSrc, ModelCache } from "./ModelCache";
import { RenderContext } from "./Render";
import * as SD from "./Stagedef";
import { BgInfo, CommonGmaModelIDs, StageInfo } from "./StageInfo";
import { MkbTime, S16_TO_RADIANS, Sphere } from "./Utils";
import * as GX_Material from "../gx/gx_material";
import { SpotFunction } from "../gx/gx_enum";
import { assertExists } from "../util";

const scratchRenderParams = new RenderParams();

// Immutable parsed stage definition
export type StageData = {
    stageInfo: StageInfo;
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
    commonGma: Gma.Gma;
};

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchMat4a = mat4.create();
class AnimGroup {
    private models: ModelInst[];
    private worldFromAg: mat4;
    private originFromAg: mat4;
    private agData: SD.AnimGroup;
    private bananas: Banana[];
    private goals: Goal[];
    private bumpers: Bumper[];

    constructor(modelCache: ModelCache, private stageData: StageData, private animGroupIdx: number) {
        this.agData = stageData.stagedef.animGroups[animGroupIdx];
        this.models = [];
        for (let i = 0; i < this.agData.levelModels.length; i++) {
            const name = this.agData.levelModels[i].modelName;
            const modelInst = modelCache.getModel(name);
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
    }

    public update(t: MkbTime): void {
        // Check if this is the world space anim group
        if (this.animGroupIdx > 0) {
            const loopedTimeSeconds = loopWrap(
                t.getAnimTimeSeconds(),
                this.stageData.stagedef.loopStartSeconds,
                this.stageData.stagedef.loopEndSeconds
            );

            // Use initial values if there are no corresponding keyframes
            const translation = scratchVec3a;
            vec3.copy(translation, this.agData.originPos);
            const rotRadians = scratchVec3b;
            vec3.scale(rotRadians, this.agData.originRot, S16_TO_RADIANS);
            const anim = this.agData.anim;

            if (anim !== null) {
                if (anim.posXKeyframes.length !== 0) {
                    translation[0] = interpolateKeyframes(loopedTimeSeconds, anim.posXKeyframes);
                }
                if (anim.posYKeyframes.length !== 0) {
                    translation[1] = interpolateKeyframes(loopedTimeSeconds, anim.posYKeyframes);
                }
                if (anim.posZKeyframes.length !== 0) {
                    translation[2] = interpolateKeyframes(loopedTimeSeconds, anim.posZKeyframes);
                }
                if (anim.rotXKeyframes.length !== 0) {
                    rotRadians[0] =
                        interpolateKeyframes(loopedTimeSeconds, anim.rotXKeyframes) * MathConstants.DEG_TO_RAD;
                }
                if (anim.rotYKeyframes.length !== 0) {
                    rotRadians[1] =
                        interpolateKeyframes(loopedTimeSeconds, anim.rotYKeyframes) * MathConstants.DEG_TO_RAD;
                }
                if (anim.rotZKeyframes.length !== 0) {
                    rotRadians[2] =
                        interpolateKeyframes(loopedTimeSeconds, anim.rotZKeyframes) * MathConstants.DEG_TO_RAD;
                }
            }

            mat4.fromTranslation(this.worldFromAg, translation);
            mat4.rotateZ(this.worldFromAg, this.worldFromAg, rotRadians[2]);
            mat4.rotateY(this.worldFromAg, this.worldFromAg, rotRadians[1]);
            mat4.rotateX(this.worldFromAg, this.worldFromAg, rotRadians[0]);
            mat4.mul(this.worldFromAg, this.worldFromAg, this.originFromAg);
        }

        for (let i = 0; i < this.bananas.length; i++) {
            this.bananas[i].update(t);
        }
        for (let i = 0; i < this.bumpers.length; i++) {
            this.bumpers[i].update(t);
        }
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting) {
        const rp = scratchRenderParams;
        rp.alpha = 1.0;
        rp.sort = RenderSort.Translucent;
        rp.lighting = lighting;

        const viewFromAnimGroup = scratchMat4a;
        mat4.mul(viewFromAnimGroup, ctx.viewerInput.camera.viewMatrix, this.worldFromAg);
        mat4.copy(rp.viewFromModel, viewFromAnimGroup);

        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(ctx, rp);
        }
        for (let i = 0; i < this.bananas.length; i++) {
            this.bananas[i].prepareToRender(ctx, lighting, viewFromAnimGroup);
        }
        for (let i = 0; i < this.goals.length; i++) {
            this.goals[i].prepareToRender(ctx, lighting, viewFromAnimGroup);
        }
        for (let i = 0; i < this.bumpers.length; i++) {
            this.bumpers[i].prepareToRender(ctx, lighting, viewFromAnimGroup);
        }
    }
}

export class Lighting {
    public ambientColor: Color;
    public infLight_rt_view: GX_Material.Light;

    private infLight_rt_world: GX_Material.Light;

    constructor(bgInfo: BgInfo) {
        this.ambientColor = colorNewCopy(bgInfo.ambientColor);

        this.infLight_rt_world = new GX_Material.Light();
        this.infLight_rt_view = new GX_Material.Light();

        colorCopy(this.infLight_rt_world.Color, bgInfo.infLightColor);

        vec3.set(this.infLight_rt_world.Position, 0, 0, -1);
        vec3.rotateX(
            this.infLight_rt_world.Position,
            this.infLight_rt_world.Position,
            Vec3Zero,
            S16_TO_RADIANS * bgInfo.infLightRotX
        );
        vec3.rotateY(
            this.infLight_rt_world.Position,
            this.infLight_rt_world.Position,
            Vec3Zero,
            S16_TO_RADIANS * bgInfo.infLightRotY
        );
        // Move point light far away to emulate directional light
        vec3.scale(this.infLight_rt_world.Position, this.infLight_rt_world.Position, 10000);

        GX_Material.lightSetSpot(this.infLight_rt_world, 0, SpotFunction.OFF);

        this.infLight_rt_view.copy(this.infLight_rt_world);
    }

    public update(viewerInput: Viewer.ViewerRenderInput) {
        transformVec3Mat4w0(
            this.infLight_rt_view.Position,
            viewerInput.camera.viewMatrix,
            this.infLight_rt_world.Position
        );
    }
}

const scratchVec3c = vec3.create();
class Banana {
    private model: ModelInst;
    private yRotRadians: number = 0;

    constructor(modelCache: ModelCache, private bananaData: SD.Banana) {
        const modelId =
            bananaData.type === SD.BananaType.Single
                ? CommonGmaModelIDs.OBJ_BANANA_01_LOD150
                : CommonGmaModelIDs.OBJ_BANANA_02_LOD100;
        this.model = assertExists(modelCache.getModel(modelId, GmaSrc.Common));
    }

    public update(t: MkbTime): void {
        const incRadians = S16_TO_RADIANS * (this.bananaData.type === SD.BananaType.Single ? 1024 : 768);
        this.yRotRadians += incRadians * t.getDeltaTimeFrames();
        this.yRotRadians %= 2 * Math.PI;
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting, viewFromAnimGroup: mat4): void {
        const rp = scratchRenderParams;
        rp.alpha = 1.0;
        rp.sort = RenderSort.None;
        rp.lighting = lighting;

        // Bananas' positions are parented to their anim group, but they have a global rotation in
        // world space
        mat4.rotateY(rp.viewFromModel, ctx.viewerInput.camera.viewMatrix, this.yRotRadians);
        const pos_rt_view = scratchVec3c;
        transformVec3Mat4w1(pos_rt_view, viewFromAnimGroup, this.bananaData.pos);
        rp.viewFromModel[12] = pos_rt_view[0];
        rp.viewFromModel[13] = pos_rt_view[1];
        rp.viewFromModel[14] = pos_rt_view[2];

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

    public prepareToRender(ctx: RenderContext, lighting: Lighting, viewFromAnimGroup: mat4): void {
        const rp = scratchRenderParams;
        rp.alpha = 1.0;
        rp.sort = RenderSort.Translucent;
        rp.lighting = lighting;

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

    public update(t: MkbTime): void {
        const incRadians = S16_TO_RADIANS * 0x100;
        this.yRotRadians += incRadians * t.getDeltaTimeFrames();
        this.yRotRadians %= 2 * Math.PI;
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting, viewFromAnimGroup: mat4): void {
        const rp = scratchRenderParams;
        rp.alpha = 1.0;
        rp.sort = RenderSort.Translucent;
        rp.lighting = lighting;

        mat4.translate(rp.viewFromModel, viewFromAnimGroup, this.bumperData.pos);
        mat4.rotateZ(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.bumperData.rot[2]);
        mat4.rotateY(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.bumperData.rot[1]);
        mat4.rotateX(rp.viewFromModel, rp.viewFromModel, S16_TO_RADIANS * this.bumperData.rot[0]);
        mat4.scale(rp.viewFromModel, rp.viewFromModel, this.bumperData.scale);
        mat4.rotateY(rp.viewFromModel, rp.viewFromModel, this.yRotRadians);

        this.model.prepareToRender(ctx, rp);
    }
}

export class World {
    private mkbTime: MkbTime;
    private animGroups: AnimGroup[];
    private background: Background;
    private lighting: Lighting;

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private modelCache: ModelCache, stageData: StageData) {
        this.mkbTime = new MkbTime(60); // TODO(complexplane): Per-stage time limit
        this.animGroups = stageData.stagedef.animGroups.map((_, i) => new AnimGroup(modelCache, stageData, i));

        const bgModels: BgModelInst[] = [];
        for (const bgModel of stageData.stagedef.bgModels.concat(stageData.stagedef.fgModels)) {
            if (!(bgModel.flags & SD.BgModelFlags.Visible)) continue;
            const model = modelCache.getModel(bgModel.modelName);
            if (model === null) continue;
            bgModels.push(new BgModelInst(model, bgModel));
        }
        this.background = new stageData.stageInfo.bgInfo.bgConstructor(bgModels);

        this.lighting = new Lighting(stageData.stageInfo.bgInfo);
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.mkbTime.updateDeltaTimeSeconds(viewerInput.deltaTime / 1000);
        for (let i = 0; i < this.animGroups.length; i++) {
            this.animGroups[i].update(this.mkbTime);
        }
        this.background.update(this.mkbTime);
        this.lighting.update(viewerInput);
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.animGroups.length; i++) {
            this.animGroups[i].prepareToRender(ctx, this.lighting);
        }
        this.background.prepareToRender(ctx, this.lighting);
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}
