
// Animation support.

import { LoopMode, VAF1, TRK1, sampleAnimationData, TRK1AnimationEntry, calcTexMtx_Maya, calcTexMtx_Basic, TTK1, TTK1AnimationEntry, TPT1AnimationEntry, TPT1, ANK1, Joint } from './J3DLoader';
import { assertExists } from '../../../util';
import { Color } from '../../../Color';
import { J3DModelInstance, JointMatrixCalcNoAnm, MaterialInstance } from './J3DGraphBase';
import { mat4 } from 'gl-matrix';
import { computeModelMatrixSRT } from '../../../MathHelpers';

export const enum J3DFrameCtrl__UpdateFlags {
    HasStopped  = 0b0001,
    HasRepeated = 0b0010,
}

export class J3DFrameCtrl {
    public loopMode: LoopMode;
    public startFrame: number;
    public endFrame: number;
    public repeatStartFrame: number;
    public speedInFrames: number;
    public currentTimeInFrames: number;
    public updateFlags: J3DFrameCtrl__UpdateFlags = 0;

    constructor(endFrame: number) {
        this.init(endFrame);
    }

    public init(endFrame: number): void {
        this.loopMode = LoopMode.REPEAT;
        this.updateFlags = 0;
        this.startFrame = 0;
        this.endFrame = endFrame;
        this.repeatStartFrame = 0;
        this.speedInFrames = 1.0;
        this.currentTimeInFrames = 0.0;
    }

    public update(deltaTimeFrames: number): void {
        // TODO(jstpierre): Figure out why SurfingRaceSubGate is broken in Loopdeswoop Galaxy...
        // This isn't correct.
        if (this.speedInFrames === 0)
            return;

        // TODO(jstpierre): Handle negative speeds.

        this.updateFlags = 0;
        this.currentTimeInFrames += (this.speedInFrames * deltaTimeFrames);

        if (this.loopMode === LoopMode.ONCE) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasStopped;
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.endFrame - 0.001;
            }
        } else if (this.loopMode === LoopMode.ONCE_AND_RESET) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasStopped;
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.startFrame;
            }
        } else if (this.loopMode === LoopMode.REPEAT) {
            while (this.currentTimeInFrames >= this.endFrame) {
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasRepeated;
                this.currentTimeInFrames -= (this.endFrame - this.repeatStartFrame);
            }
        } else if (this.loopMode === LoopMode.MIRRORED_ONCE) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.endFrame - (this.currentTimeInFrames - this.endFrame);
            }

            if (this.currentTimeInFrames < this.startFrame) {
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.startFrame - (this.currentTimeInFrames - this.startFrame);
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasStopped;
            }
        } else if (this.loopMode === LoopMode.MIRRORED_REPEAT) {
            if (this.currentTimeInFrames >= this.endFrame - 1.0) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.endFrame - (this.currentTimeInFrames - this.endFrame);
            }

            if (this.currentTimeInFrames < this.startFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.startFrame - (this.currentTimeInFrames - this.startFrame);
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasRepeated;
            }
        }
    }

    public checkPass(frame: number, deltaTimeFrames: number, currentTimeInFrames = this.currentTimeInFrames, speedInFrames = this.speedInFrames): boolean {
        if (this.loopMode === LoopMode.ONCE || this.loopMode === LoopMode.ONCE_AND_RESET) {
            const oldTime = currentTimeInFrames, newTime = currentTimeInFrames + (speedInFrames * deltaTimeFrames);
            return oldTime < frame && newTime >= frame;
        } else {
            // TODO(jstpierre): RE this.
            return false;
        }
    }
}

export function VAF1_getVisibility(vaf1: VAF1, shapeIndex: number, animFrame: number): boolean {
    const entry = assertExists(vaf1.visibilityAnimationTracks[shapeIndex]);

    // animFrame can return a partial keyframe, but visibility information is frame-specific.
    // Resolve this by treating this as a stepped track, rounded. e.g. 15.9 is keyframe 16.
    const animFrameInt = (animFrame + 0.5) | 0;

    if (animFrameInt < 0) {
        return entry.shapeVisibility.getBit(0);
    } else if (animFrameInt >= entry.shapeVisibility.numBits) {
        // If we're past the end, use the last frame.
        return entry.shapeVisibility.getBit(entry.shapeVisibility.numBits - 1);
    } else {
        return entry.shapeVisibility.getBit(animFrameInt);
    }
}

export class J3DTexRegAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private animationEntry: TRK1AnimationEntry) {
    }

    public set(frameCtrl: J3DFrameCtrl, entry: TRK1AnimationEntry): void {
        this.frameCtrl = frameCtrl;
        this.animationEntry = entry;
    }

    public calcColor(dst: Color): void {
        const animFrame = this.frameCtrl.currentTimeInFrames;

        dst.r = sampleAnimationData(this.animationEntry.r, animFrame, false);
        dst.g = sampleAnimationData(this.animationEntry.g, animFrame, false);
        dst.b = sampleAnimationData(this.animationEntry.b, animFrame, false);
        dst.a = sampleAnimationData(this.animationEntry.a, animFrame, false);
    }
}

function findMaterialInstance(modelInstance: J3DModelInstance, name: string): MaterialInstance | null {
    for (let i = 0; i < modelInstance.materialInstances.length; i++)
        if (modelInstance.materialInstances[i].name === name)
            return modelInstance.materialInstances[i];
    return null;
}

export function entryTevRegAnimator(modelInstance: J3DModelInstance, trk1: TRK1, frameCtrl: J3DFrameCtrl): void {
    for (let i = 0; i < trk1.animationEntries.length; i++) {
        const entry = trk1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, trk1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        if (materialInstance.colorCalc[entry.colorKind])
            (materialInstance.colorCalc[entry.colorKind] as J3DTexRegAnm).set(frameCtrl, entry);
        else
            materialInstance.colorCalc[entry.colorKind] = new J3DTexRegAnm(frameCtrl, entry);
    }
}

export function removeTevRegAnimator(modelInstance: J3DModelInstance, trk1: TRK1): void {
    for (let i = 0; i < trk1.animationEntries.length; i++) {
        const entry = trk1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, trk1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        materialInstance.colorCalc[entry.colorKind] = null;
    }
}

export class J3DTexMtxAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private ttk1: TTK1, private animationEntry: TTK1AnimationEntry) {}

    public set(frameCtrl: J3DFrameCtrl, ttk1: TTK1, animationEntry: TTK1AnimationEntry): void {
        this.frameCtrl = frameCtrl;
        this.ttk1 = ttk1;
        this.animationEntry = animationEntry;
    }

    public calcTexMtx(dst: mat4): void {
        const animFrame = this.frameCtrl.currentTimeInFrames;

        const scaleS = sampleAnimationData(this.animationEntry.scaleS, animFrame, false);
        const scaleT = sampleAnimationData(this.animationEntry.scaleT, animFrame, false);
        const rotation = sampleAnimationData(this.animationEntry.rotationQ, animFrame, false);
        const translationS = sampleAnimationData(this.animationEntry.translationS, animFrame, false);
        const translationT = sampleAnimationData(this.animationEntry.translationT, animFrame, false);

        if (this.ttk1.isMaya) {
            calcTexMtx_Maya(dst, scaleS, scaleT, rotation, translationS, translationT);
        } else {
            const centerS = this.animationEntry.centerS;
            const centerT = this.animationEntry.centerT;
            const centerQ = this.animationEntry.centerQ;
            calcTexMtx_Basic(dst, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);
        }
    }
}

export function entryTexMtxAnimator(modelInstance: J3DModelInstance, ttk1: TTK1, frameCtrl: J3DFrameCtrl): void {
    for (let i = 0; i < ttk1.uvAnimationEntries.length; i++) {
        const entry = ttk1.uvAnimationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, ttk1.uvAnimationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        if (materialInstance.texMtxCalc[entry.texGenIndex])
            (materialInstance.texMtxCalc[entry.texGenIndex] as J3DTexMtxAnm).set(frameCtrl, ttk1, entry);
        else
            materialInstance.texMtxCalc[entry.texGenIndex] = new J3DTexMtxAnm(frameCtrl, ttk1, entry);
    }
}

export function removeTexMtxAnimator(modelInstance: J3DModelInstance, ttk1: TTK1): void {
    for (let i = 0; i < ttk1.uvAnimationEntries.length; i++) {
        const entry = ttk1.uvAnimationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, ttk1.uvAnimationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        materialInstance.texMtxCalc[entry.texGenIndex] = null;
    }
}

export class J3DTexNoAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private animationEntry: TPT1AnimationEntry) {}

    public set(frameCtrl: J3DFrameCtrl, animationEntry: TPT1AnimationEntry): void {
        this.frameCtrl = frameCtrl;
        this.animationEntry = animationEntry;
    }

    public calcTextureIndex(): number {
        const animFrame = this.frameCtrl.currentTimeInFrames;
        return this.animationEntry.textureIndices[(animFrame | 0)];
    }
}

export function entryTexNoAnimator(modelInstance: J3DModelInstance, tpt1: TPT1, frameCtrl: J3DFrameCtrl): void {
    for (let i = 0; i < tpt1.animationEntries.length; i++) {
        const entry = tpt1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, tpt1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        if (materialInstance.texNoCalc[entry.texMapIndex])
            (materialInstance.texNoCalc[entry.texMapIndex] as J3DTexNoAnm).set(frameCtrl, entry);
        else
            materialInstance.texNoCalc[entry.texMapIndex] = new J3DTexNoAnm(frameCtrl, entry);
    }
}

export function removeTexNoAnimator(modelInstance: J3DModelInstance, tpt1: TPT1): void {
    for (let i = 0; i < tpt1.animationEntries.length; i++) {
        const entry = tpt1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, tpt1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        materialInstance.texMtxCalc[entry.texMapIndex] = null;
    }
}

export class J3DJointMatrixAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private ank1: ANK1) {}

    public set(frameCtrl: J3DFrameCtrl, ank1: ANK1): void {
        this.frameCtrl = frameCtrl;
    }

    public calcJointMatrix(dst: mat4, i: number, jnt1: Joint): void {
        const animFrame = this.frameCtrl.currentTimeInFrames;
        const entry = this.ank1.jointAnimationEntries[i];

        if (entry !== undefined) {
            const scaleX = sampleAnimationData(entry.scaleX, animFrame, false);
            const scaleY = sampleAnimationData(entry.scaleY, animFrame, false);
            const scaleZ = sampleAnimationData(entry.scaleZ, animFrame, false);
            const rotationX = sampleAnimationData(entry.rotationX, animFrame, false) * Math.PI;
            const rotationY = sampleAnimationData(entry.rotationY, animFrame, false) * Math.PI;
            const rotationZ = sampleAnimationData(entry.rotationZ, animFrame, false) * Math.PI;
            const translationX = sampleAnimationData(entry.translationX, animFrame, false);
            const translationY = sampleAnimationData(entry.translationY, animFrame, false);
            const translationZ = sampleAnimationData(entry.translationZ, animFrame, false);
            computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        } else {
            const scaleX = jnt1.scaleX;
            const scaleY = jnt1.scaleY;
            const scaleZ = jnt1.scaleZ;
            const rotationX = jnt1.rotationX;
            const rotationY = jnt1.rotationY;
            const rotationZ = jnt1.rotationZ;
            const translationX = jnt1.translationX;
            const translationY = jnt1.translationY;
            const translationZ = jnt1.translationZ;
            computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        }
    }
}

export function entryJointAnimator(modelInstance: J3DModelInstance, ank1: ANK1, frameCtrl: J3DFrameCtrl): void {
    if (modelInstance.jointMatrixCalc instanceof J3DJointMatrixAnm)
        modelInstance.jointMatrixCalc.set(frameCtrl, ank1);
    else
        modelInstance.jointMatrixCalc = new J3DJointMatrixAnm(frameCtrl, ank1);
}

export function removeJointAnimator(modelInstance: J3DModelInstance, ank1: ANK1): void {
    modelInstance.jointMatrixCalc = new JointMatrixCalcNoAnm();
}
