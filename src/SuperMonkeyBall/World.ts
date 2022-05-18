import { mat4, vec3 } from "gl-matrix";
import { Color, colorCopy, colorNewCopy } from "../Color";
import { AABB } from "../Geometry";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { MathConstants, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero } from "../MathHelpers";
import * as Viewer from "../viewer";
import { interpolateKeyframes, loopWrap } from "./Anim";
import { Background } from "./Background";
import { BgModelInst } from "./BgModel";
import * as Gma from "./Gma";
import { ModelInst, RenderParams, RenderSort } from "./Model";
import { ModelCache } from "./ModelCache";
import { RenderContext } from "./Render";
import * as SD from "./Stagedef";
import { BgInfo, StageInfo } from "./StageInfo";
import { MkbTime, S16_TO_RADIANS, Sphere, transformVec } from "./Utils";

const scratchRenderParams = new RenderParams();

// Immutable parsed stage definition
export type StageData = {
    stageInfo: StageInfo;
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
};

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
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

    public update(t: MkbTime): void {
        // Check if this is the world space itemgroup
        if (this.itemgroupIdx === 0) return;

        const loopedTimeSeconds = loopWrap(
            t.getAnimTimeSeconds(),
            this.stagedef.loopStartSeconds,
            this.stagedef.loopEndSeconds
        );

        // Use initial values if there are no corresponding keyframes
        const translation = scratchVec3a;
        vec3.copy(translation, this.igData.originPos);
        const rotRadians = scratchVec3b;
        vec3.scale(rotRadians, this.igData.originRot, S16_TO_RADIANS);
        const anim = this.igData.anim;

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
            rotRadians[0] = interpolateKeyframes(loopedTimeSeconds, anim.rotXKeyframes) * MathConstants.DEG_TO_RAD;
        }
        if (anim.rotYKeyframes.length !== 0) {
            rotRadians[1] = interpolateKeyframes(loopedTimeSeconds, anim.rotYKeyframes) * MathConstants.DEG_TO_RAD;
        }
        if (anim.rotZKeyframes.length !== 0) {
            rotRadians[2] = interpolateKeyframes(loopedTimeSeconds, anim.rotZKeyframes) * MathConstants.DEG_TO_RAD;
        }

        mat4.fromTranslation(this.worldFromIg, translation);
        mat4.rotateZ(this.worldFromIg, this.worldFromIg, rotRadians[2]);
        mat4.rotateY(this.worldFromIg, this.worldFromIg, rotRadians[1]);
        mat4.rotateX(this.worldFromIg, this.worldFromIg, rotRadians[0]);
        mat4.mul(this.worldFromIg, this.worldFromIg, this.originFromIg);
    }

    public prepareToRender(ctx: RenderContext, lighting: Lighting) {
        const rp = scratchRenderParams;
        rp.alpha = 1.0;
        rp.sort = RenderSort.Translucent;
        rp.worldFromModel = this.worldFromIg;
        rp.lighting = lighting;

        mat4.mul(rp.viewFromModel, ctx.viewerInput.camera.viewMatrix, this.worldFromIg);

        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(ctx, rp);
        }
    }

    public computeAABB(outAABB: AABB): void {
        const pt = scratchVec3a;
        for (let i = 0; i < this.models.length; i++) {
            const center = this.models[i].modelData.boundSphereCenter;
            const radius = this.models[i].modelData.boundSphereRadius;

            vec3.scaleAndAdd(pt, center, Vec3UnitX, -radius);
            outAABB.unionPoint(pt);
            vec3.scaleAndAdd(pt, center, Vec3UnitX, radius);
            outAABB.unionPoint(pt);
            vec3.scaleAndAdd(pt, center, Vec3UnitY, -radius);
            outAABB.unionPoint(pt);
            vec3.scaleAndAdd(pt, center, Vec3UnitY, radius);
            outAABB.unionPoint(pt);
            vec3.scaleAndAdd(pt, center, Vec3UnitZ, -radius);
            outAABB.unionPoint(pt);
            vec3.scaleAndAdd(pt, center, Vec3UnitZ, radius);
            outAABB.unionPoint(pt);
        }
    }
}

export class Lighting {
    public ambientColor: Color;
    public infLightColor: Color;
    public infLightDir_rt_view: vec3;

    private infLightDir_rt_world: vec3;

    constructor(bgInfo: BgInfo) {
        this.ambientColor = colorNewCopy(bgInfo.ambientColor);
        this.infLightColor = colorNewCopy(bgInfo.infLightColor);
        this.infLightDir_rt_view = vec3.create();
        this.infLightDir_rt_world = vec3.create();

        vec3.set(this.infLightDir_rt_world, 0, 0, -1);
        vec3.rotateX(
            this.infLightDir_rt_world,
            this.infLightDir_rt_world,
            Vec3Zero,
            S16_TO_RADIANS * bgInfo.infLightRotX
        );
        vec3.rotateY(
            this.infLightDir_rt_world,
            this.infLightDir_rt_world,
            Vec3Zero,
            S16_TO_RADIANS * bgInfo.infLightRotY
        );
        vec3.scale(this.infLightDir_rt_world, this.infLightDir_rt_world, 10000); // Game does this, not sure why it changes anything
    }

    public update(viewerInput: Viewer.ViewerRenderInput) {
        transformVec(this.infLightDir_rt_view, this.infLightDir_rt_world, viewerInput.camera.viewMatrix);
    }
}

export class World {
    private mkbTime: MkbTime;
    private itemgroups: Itemgroup[];
    private background: Background;
    private lighting: Lighting;
    private infLightDir_rt_world = vec3.create();

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private modelCache: ModelCache, stageData: StageData) {
        this.mkbTime = new MkbTime(60); // TODO(complexplane): Per-stage time limit
        this.itemgroups = stageData.stagedef.itemgroups.map(
            (_, i) => new Itemgroup(device, renderCache, modelCache, stageData.stagedef, i)
        );

        const bgModels: BgModelInst[] = [];
        for (const bgModel of stageData.stagedef.bgModels.concat(stageData.stagedef.fgModels)) {
            if (!(bgModel.flags & SD.BgModelFlags.Visible)) continue;
            const model = modelCache.getModel(device, renderCache, bgModel.modelName);
            if (model === null) continue;
            bgModels.push(new BgModelInst(model, bgModel));
        }
        this.background = new stageData.stageInfo.bgInfo.bgConstructor(bgModels);

        this.lighting = new Lighting(stageData.stageInfo.bgInfo);
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.mkbTime.updateDeltaTimeSeconds(viewerInput.deltaTime / 1000);
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].update(this.mkbTime);
        }
        this.background.update(this.mkbTime);
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].prepareToRender(ctx, this.lighting);
        }
        this.background.prepareToRender(ctx, this.lighting);
    }

    // Should only be called once so OK to make new object
    public computeBoundSphere(): Sphere {
        const aabb = new AABB();
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].computeAABB(aabb);
        }
        const center = vec3.create();
        aabb.centerPoint(center);
        return { center, radius: aabb.boundingSphereRadius() };
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}
