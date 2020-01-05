
import { J3DFrameCtrl, J3DFrameCtrl__UpdateFlags, entryTexMtxAnimator, entryTevRegAnimator, entryTexNoAnimator, VAF1_getVisibility } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { TTK1, LoopMode, TRK1, AnimationBase, TPT1, VAF1 } from "../Common/JSYSTEM/J3D/J3DLoader";
import { J3DModelInstance, J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { dGlobals, dDlst_list_Set } from "./zww_scenes";

abstract class mDoExt_baseAnm<T extends AnimationBase> {
    public frameCtrl = new J3DFrameCtrl(0);
    public anm: T;

    protected initPlay(duration: number, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        if (!i_modify) {
            this.frameCtrl.init(0);
        }

        // Logic bug in Wind Waker: startFrame is assigned before calling init, so this doesn't do anything.
        // this.frameCtrl.startFrame = startFrame;

        this.frameCtrl.init(endFrame >= 0 ? endFrame : duration);
        this.frameCtrl.loopMode = loopMode;
        this.frameCtrl.speedInFrames = speed;
        if (speed > 0.0)
            this.frameCtrl.currentTimeInFrames = startFrame;
        else
            this.frameCtrl.currentTimeInFrames = this.frameCtrl.endFrame;
        this.frameCtrl.repeatStartFrame = this.frameCtrl.currentTimeInFrames;
    }

    public init(modelData: J3DModelData, anm: T, doInit: boolean = true, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        this.anm = anm;

        if (doInit)
            this.initPlay(this.anm.duration, loopMode, speed, startFrame, endFrame, i_modify);
    }

    public play(deltaTimeFrames: number): boolean {
        this.frameCtrl.update(deltaTimeFrames);
        const hasStopped = !!(this.frameCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped) && this.frameCtrl.speedInFrames !== 0;
        return hasStopped;
    }

    public abstract entry(modelInstance: J3DModelInstance): void;
}

export class mDoExt_btkAnm extends mDoExt_baseAnm<TTK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTexMtxAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_brkAnm extends mDoExt_baseAnm<TRK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTevRegAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export type mDoExt_bpkAnm = mDoExt_brkAnm;

export class mDoExt_btpAnm extends mDoExt_baseAnm<TPT1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTexNoAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_bvaAnm extends mDoExt_baseAnm<VAF1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        // TODO(jstpierre): J3DVisibilityManager?
        for (let i = 0; i < modelInstance.shapeInstances.length; i++)
            modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.anm, i, this.frameCtrl.currentTimeInFrames);
    }
}

export function mDoExt_modelUpdateDL(globals: dGlobals, modelInstance: J3DModelInstance, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, drawListSet: dDlst_list_Set | null = null): void {
    const device = globals.modelCache.device;

    if (drawListSet === null)
        drawListSet = globals.dlst.main;

    // NOTE(jstpierre): This is custom to noclip, normally the toon textures are set in setToonTex during res loading.
    globals.renderer.extraTextures.fillExtraTextures(modelInstance);

    if (globals.renderHacks.renderHacksChanged) {
        modelInstance.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
        modelInstance.setTexturesEnabled(globals.renderHacks.texturesEnabled);
    }

    modelInstance.calcAnim(viewerInput.camera);
    modelInstance.calcView(viewerInput.camera);

    renderInstManager.setCurrentRenderInstList(drawListSet[0]);
    modelInstance.drawOpa(device, renderInstManager, viewerInput.camera, viewerInput.viewport);
    renderInstManager.setCurrentRenderInstList(drawListSet[1]);
    modelInstance.drawXlu(device, renderInstManager, viewerInput.camera, viewerInput.viewport);
}
