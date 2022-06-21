import { mat4, vec3 } from "gl-matrix";
import { ModelInst, RenderParams, RenderSort } from "./Model";
import * as SD from "./Stagedef";
import { loopWrap, interpolateKeyframes } from "./Anim";
import { MathConstants } from "../MathHelpers";
import { RenderContext } from "./Render";
import { EPSILON, MkbTime, S16_TO_RADIANS } from "./Utils";
import { colorCopy } from "../Color";
import { Lighting } from "./Lighting";
import { WorldState } from "./World";

const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchMat4a = mat4.create();
const scratchRenderParams = new RenderParams();

export class BgObjectInst {
    private worldFromModel: mat4 = mat4.create();
    private visible = true;
    private translucency = 0; // 1 - alpha

    constructor(private model: ModelInst, public bgObjectData: SD.BgObject) {
        this.translucency = bgObjectData.translucency;
        const rotRadians = scratchVec3c;
        vec3.scale(rotRadians, bgObjectData.rot, S16_TO_RADIANS);
        this.buildWorldFromModelMtx(bgObjectData.pos, rotRadians, bgObjectData.scale);
    }

    private buildWorldFromModelMtx(pos: vec3, rotRadians: vec3, scale: vec3): void {
        mat4.fromTranslation(this.worldFromModel, pos);
        mat4.rotateZ(this.worldFromModel, this.worldFromModel, rotRadians[2]);
        mat4.rotateY(this.worldFromModel, this.worldFromModel, rotRadians[1]);
        mat4.rotateX(this.worldFromModel, this.worldFromModel, rotRadians[0]);
        mat4.scale(this.worldFromModel, this.worldFromModel, scale);
    }

    public update(state: WorldState): void {
        const anim = this.bgObjectData.anim;
        if (anim === null) return;

        const loopedTimeSeconds = loopWrap(
            state.time.getAnimTimeSeconds(),
            anim.loopStartSeconds,
            anim.loopEndSeconds
        );

        if (anim.visibleKeyframes.length !== 0) {
            const visibleFloat = interpolateKeyframes(loopedTimeSeconds, anim.visibleKeyframes);
            this.visible = visibleFloat >= 0.5;
            if (!this.visible) return;
        }

        if (anim.translucencyKeyframes.length !== 0) {
            this.translucency = interpolateKeyframes(loopedTimeSeconds, anim.translucencyKeyframes);
            if (this.translucency >= 1) {
                this.visible = false;
                return;
            }
        }

        // Use initial values if there are no corresponding keyframes
        const pos = scratchVec3c;
        vec3.copy(pos, this.bgObjectData.pos);
        const rotRadians = scratchVec3e;
        vec3.scale(rotRadians, this.bgObjectData.rot, S16_TO_RADIANS);
        const scale = scratchVec3d;
        vec3.copy(scale, this.bgObjectData.scale);

        if (anim.posXKeyframes.length !== 0) {
            pos[0] = interpolateKeyframes(loopedTimeSeconds, anim.posXKeyframes);
        }
        if (anim.posYKeyframes.length !== 0) {
            pos[1] = interpolateKeyframes(loopedTimeSeconds, anim.posYKeyframes);
        }
        if (anim.posZKeyframes.length !== 0) {
            pos[2] = interpolateKeyframes(loopedTimeSeconds, anim.posZKeyframes);
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
        if (anim.scaleXKeyframes.length !== 0) {
            scale[0] = interpolateKeyframes(loopedTimeSeconds, anim.scaleXKeyframes);
        }
        if (anim.scaleYKeyframes.length !== 0) {
            scale[1] = interpolateKeyframes(loopedTimeSeconds, anim.scaleYKeyframes);
        }
        if (anim.scaleZKeyframes.length !== 0) {
            scale[2] = interpolateKeyframes(loopedTimeSeconds, anim.scaleZKeyframes);
        }

        this.buildWorldFromModelMtx(pos, rotRadians, scale);
    }

    public prepareToRender(state: WorldState, ctx: RenderContext, texMtx?: mat4) {
        if (!this.visible) return;

        const renderParams = scratchRenderParams;
        renderParams.reset();
        renderParams.alpha = 1 - this.translucency;
        renderParams.sort = this.translucency < EPSILON ? RenderSort.Translucent : RenderSort.All;
        if (texMtx !== undefined) {
            mat4.copy(renderParams.texMtx, texMtx);
        } 

        mat4.mul(renderParams.viewFromModel, ctx.viewerInput.camera.viewMatrix, this.worldFromModel);

        renderParams.lighting = state.lighting;
        renderParams.depthOffset = 400;

        this.model.prepareToRender(ctx, renderParams);
    }
}
