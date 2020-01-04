
import { J3DFrameCtrl, J3DFrameCtrl__UpdateFlags, entryTexMtxAnimator, entryTevRegAnimator, entryTexNoAnimator, VAF1_getVisibility } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { TTK1, LoopMode, TRK1, AnimationBase, TPT1, VAF1 } from "../Common/JSYSTEM/J3D/J3DLoader";
import { J3DModelInstance, J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";

abstract class mDoExt_baseAnm<T extends AnimationBase> {
    public frameCtrl: J3DFrameCtrl;
    public anm: T;

    public initPlay(duration: number, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        if (!i_modify) {
            this.frameCtrl = new J3DFrameCtrl(0);
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
    public entry(modelInstance: J3DModelInstance): void {
        entryTexMtxAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_brkAnm extends mDoExt_baseAnm<TRK1> {
    public entry(modelInstance: J3DModelInstance): void {
        entryTevRegAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export type mDoExt_bpkAnm = mDoExt_brkAnm;

export class mDoExt_btpAnm extends mDoExt_baseAnm<TPT1> {
    public entry(modelInstance: J3DModelInstance): void {
        entryTexNoAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_bvaAnm extends mDoExt_baseAnm<VAF1> {
    public entry(modelInstance: J3DModelInstance): void {
        // TODO(jstpierre): J3DVisibilityManager?
        for (let i = 0; i < modelInstance.shapeInstances.length; i++)
            modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.anm, i, this.frameCtrl.currentTimeInFrames);
    }
}
