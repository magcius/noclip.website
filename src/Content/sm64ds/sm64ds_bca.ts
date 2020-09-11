
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { mat4 } from "gl-matrix";
import { computeModelMatrixSRT, lerp, lerpAngle } from "../../MathHelpers";
import AnimationController from "../../AnimationController";

export const enum LoopMode {
    ONCE = 0,
    REPEAT = 1,
}

interface AnimationTrack {
    interpolate: boolean;
    hasAnimation: boolean;
    values: Float32Array;
}

interface AnimationEntry {
    scaleX: AnimationTrack;
    scaleY: AnimationTrack;
    scaleZ: AnimationTrack;
    rotationX: AnimationTrack;
    rotationY: AnimationTrack;
    rotationZ: AnimationTrack;
    translationX: AnimationTrack;
    translationY: AnimationTrack;
    translationZ: AnimationTrack;
}

export interface BCA {
    duration: number;
    loopMode: LoopMode;
    jointAnimationEntries: AnimationEntry[];
}

export function parse(buffer: ArrayBufferSlice): BCA {
    const view = buffer.createDataView();

    const boneCount = view.getUint16(0x00, true);
    const duration = view.getUint16(0x02, true);
    const loopMode = view.getUint32(0x04, true);
    const scaleTableOffs = view.getUint32(0x08, true);
    const rotationTableOffs = view.getUint32(0x0C, true);
    const translationTableOffs = view.getUint32(0x10, true);
    const animationEntryTableOffs = view.getUint32(0x14, true);

    function readAnimationTrackRotation(offs: number, tableOffs: number): AnimationTrack {
        const interpolate = !!view.getUint8(offs + 0x00);
        const hasAnimation = !!view.getUint8(offs + 0x01);
        const firstIndex = view.getUint16(offs + 0x02, true);
        const animCount = hasAnimation ? (interpolate ? duration / 2 + 1 : duration) : 1;
        const values = new Float32Array(animCount);

        let tableIdx = tableOffs + firstIndex * 0x02;
        for (let i = 0; i < animCount; i++) {
            values[i] = view.getInt16(tableIdx + 0x00, true) / 0x0800;
            tableIdx += 0x02;
        }

        return { interpolate, hasAnimation, values };
    }

    function readAnimationTrack(offs: number, tableOffs: number): AnimationTrack {
        const interpolate = !!view.getUint8(offs + 0x00);
        const hasAnimation = !!view.getUint8(offs + 0x01);
        const firstIndex = view.getUint16(offs + 0x02, true);
        const animCount = hasAnimation ? (interpolate ? duration / 2 + 1 : duration) : 1;
        const values = new Float32Array(animCount);

        let tableIdx = tableOffs + firstIndex * 0x04;
        for (let i = 0; i < animCount; i++) {
            values[i] = view.getInt32(tableIdx + 0x00, true) / 0x1000;
            tableIdx += 0x04;
        }

        return { interpolate, hasAnimation, values };
    }

    const entries: AnimationEntry[] = [];
    let animationEntryTableIdx = animationEntryTableOffs;
    for (let i = 0; i < boneCount; i++) {
        const scaleX = readAnimationTrack(animationEntryTableIdx + 0x00, scaleTableOffs);
        const scaleY = readAnimationTrack(animationEntryTableIdx + 0x04, scaleTableOffs);
        const scaleZ = readAnimationTrack(animationEntryTableIdx + 0x08, scaleTableOffs);
        const rotationX = readAnimationTrackRotation(animationEntryTableIdx + 0x0C, rotationTableOffs);
        const rotationY = readAnimationTrackRotation(animationEntryTableIdx + 0x10, rotationTableOffs);
        const rotationZ = readAnimationTrackRotation(animationEntryTableIdx + 0x14, rotationTableOffs);
        const translationX = readAnimationTrack(animationEntryTableIdx + 0x18, translationTableOffs);
        const translationY = readAnimationTrack(animationEntryTableIdx + 0x1C, translationTableOffs);
        const translationZ = readAnimationTrack(animationEntryTableIdx + 0x20, translationTableOffs);
        entries.push({ scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ });
        animationEntryTableIdx += 0x24;
    }

    return { duration, loopMode, jointAnimationEntries: entries };
}

function sampleAnimationData(animationTrack: AnimationTrack, animFrame: number): number {
    if (!animationTrack.hasAnimation)
        return animationTrack.values[0];

    // If interpolate is turned on, then animFrame is halved.
    // In the original, the game didn't have partial frame animation.
    if (animationTrack.interpolate)
        animFrame *= 0.5;

    const v0 = animationTrack.values[animFrame | 0];
    const v1 = animationTrack.values[((animFrame + 1) | 0) % (animationTrack.values.length - 1)];
    return lerp(v0, v1, animFrame - (animFrame | 0));
}

function sampleAnimationDataRotation(animationTrack: AnimationTrack, animFrame: number): number {
    if (!animationTrack.hasAnimation)
        return animationTrack.values[0];

    // If interpolate is turned on, then animFrame is halved.
    // In the original, the game didn't have partial frame animation.
    if (animationTrack.interpolate)
        animFrame *= 0.5;

    if (animFrame >= animationTrack.values.length - 1)
        return animationTrack.values[animationTrack.values.length - 1];

    const v0 = animationTrack.values[animFrame | 0];
    const v1 = animationTrack.values[((animFrame + 1) | 0) % (animationTrack.values.length - 1)];
    return lerpAngle(v0, v1, animFrame - (animFrame | 0), 1.0);
}

function getAnimFrame(anim: BCA, frame: number): number {
    // Be careful of floating point precision.
    const lastFrame = anim.duration - 1;
    if (anim.loopMode === LoopMode.ONCE) {
        if (frame > lastFrame)
            frame = lastFrame;
        return frame;
    } else if (anim.loopMode === LoopMode.REPEAT) {
        while (frame > lastFrame)
            frame -= lastFrame;
        return frame;
    } else {
        throw "whoops";
    }
}

export class BCAAnimator { 
    constructor(public animationController: AnimationController, public bca: BCA) {}

    public calcJointMatrix(dst: mat4, jointIndex: number): boolean {
        const entry = this.bca.jointAnimationEntries[jointIndex];
        if (!entry)
            return false;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.bca, frame);

        const scaleX = sampleAnimationData(entry.scaleX, animFrame);
        const scaleY = sampleAnimationData(entry.scaleY, animFrame);
        const scaleZ = sampleAnimationData(entry.scaleZ, animFrame);
        const rotationX = sampleAnimationDataRotation(entry.rotationX, animFrame) * Math.PI;
        const rotationY = sampleAnimationDataRotation(entry.rotationY, animFrame) * Math.PI;
        const rotationZ = sampleAnimationDataRotation(entry.rotationZ, animFrame) * Math.PI;
        const translationX = sampleAnimationData(entry.translationX, animFrame);
        const translationY = sampleAnimationData(entry.translationY, animFrame);
        const translationZ = sampleAnimationData(entry.translationZ, animFrame);
        computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        return true;
    }
}

export function bindBCAAnimator(animationController: AnimationController, bca: BCA): BCAAnimator {
    return new BCAAnimator(animationController, bca);
}
