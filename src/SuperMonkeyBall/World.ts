import { mat4, vec3 } from "gl-matrix";
import AnimationController from "../AnimationController";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { invlerp, lerp, MathConstants } from "../MathHelpers";
import { assert, bisectRight } from "../util";
import * as Viewer from "../viewer";
import * as Gma from "./Gma";
import { ModelCache } from "./ModelCache";
import { ModelInst } from "./ModelInst";
import * as SD from "./Stagedef";

const S16_TO_RADIANS = Math.PI / 0x8000;

// Immutable parsed stage definition
export type StageData = {
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
};

function searchKeyframes(timeSeconds: number, keyframes: SD.Keyframe[]): number {
    assert(keyframes.length > 0);

    if (timeSeconds < keyframes[0].timeSeconds) {
        return 0;
    }
    if (timeSeconds >= keyframes[keyframes.length - 1].timeSeconds) {
        return keyframes.length - 1;
    }

    let start = 0;
    let end = keyframes.length;
    while (end > start) {
        const mid = Math.floor((end - start) / 2) + start;
        if (timeSeconds < keyframes[mid].timeSeconds) {
            end = mid;
        } else {
            start = mid + 1;
        }
    }
    return start;
}

function interpolateKeyframes(timeSeconds: number, keyframes: SD.Keyframe[]): number {
    if (keyframes.length === 0) return 0;
    if (timeSeconds <= keyframes[0].timeSeconds) {
        return keyframes[0].value;
    }
    if (timeSeconds >= keyframes[keyframes.length - 1].timeSeconds) {
        return keyframes[keyframes.length - 1].value;
    }

    const nextIdx = searchKeyframes(timeSeconds, keyframes);
    if (nextIdx === 0) {
        return keyframes[nextIdx].value;
    }
    const prev = keyframes[nextIdx - 1];
    const next = keyframes[nextIdx];
    if (prev.easeType === SD.EaseType.Constant) {
        return prev.value;
    }
    const t = invlerp(prev.timeSeconds, next.timeSeconds, timeSeconds);
    if (prev.easeType === SD.EaseType.Linear) {
        return lerp(prev.value, next.value, t);
    }
    // TODO(complexplane): Smooth ease
    return lerp(prev.value, next.value, t);
}

const scratchVec3b = vec3.create();
function interpolateAnimPose(
    outPose: mat4,
    timeSeconds: number,
    posXKeyframes: SD.Keyframe[],
    posYKeyframes: SD.Keyframe[],
    posZKeyframes: SD.Keyframe[],
    rotXKeyframes: SD.Keyframe[],
    rotYKeyframes: SD.Keyframe[],
    rotZKeyframes: SD.Keyframe[]
): void {
    const translation = scratchVec3b;
    translation[0] = interpolateKeyframes(timeSeconds, posXKeyframes);
    translation[1] = interpolateKeyframes(timeSeconds, posYKeyframes);
    translation[2] = interpolateKeyframes(timeSeconds, posZKeyframes);
    const rotX = interpolateKeyframes(timeSeconds, rotXKeyframes);
    const rotY = interpolateKeyframes(timeSeconds, rotYKeyframes);
    const rotZ = interpolateKeyframes(timeSeconds, rotZKeyframes);

    mat4.fromTranslation(outPose, translation);
    mat4.rotateZ(outPose, outPose, rotZ * MathConstants.DEG_TO_RAD);
    mat4.rotateY(outPose, outPose, rotY * MathConstants.DEG_TO_RAD);
    mat4.rotateX(outPose, outPose, rotX * MathConstants.DEG_TO_RAD);
}

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
            mat4.rotateY(
                this.originFromIg,
                this.originFromIg,
                -this.igData.originRot[1] * S16_TO_RADIANS
            );
            mat4.rotateZ(
                this.originFromIg,
                this.originFromIg,
                -this.igData.originRot[2] * S16_TO_RADIANS
            );
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

        const rawTimeSeconds = animController.getTimeInSeconds();
        const loopDuration = this.stagedef.loopEndSeconds - this.stagedef.loopStartSeconds;
        // Game does this but adding loop start time before mod just seems wrong...
        const loopedTimeSeconds =
            ((rawTimeSeconds + this.stagedef.loopStartSeconds) % loopDuration) +
            this.stagedef.loopStartSeconds;

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

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput
    ) {
        const viewFromIg = scratchMat4a;
        mat4.mul(viewFromIg, viewerInput.camera.viewMatrix, this.worldFromIg);
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(device, renderInstManager, viewerInput, viewFromIg);
        }
    }
}

export class World {
    private animTime: number;
    private animController: AnimationController;
    private itemgroups: Itemgroup[];

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        private modelCache: ModelCache,
        private stageData: StageData
    ) {
        this.animController = new AnimationController();
        this.itemgroups = stageData.stagedef.itemgroups.map(
            (_, i) => new Itemgroup(device, renderCache, modelCache, stageData.stagedef, i)
        );
        this.animTime = 0;
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.animTime += viewerInput.deltaTime;
        this.animController.setTimeInMilliseconds(this.animTime);
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].update(this.animController);
        }
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput
    ): void {
        for (let i = 0; i < this.itemgroups.length; i++) {
            this.itemgroups[i].prepareToRender(device, renderInstManager, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}
