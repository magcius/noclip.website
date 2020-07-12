import { mat4, vec3, quat } from 'gl-matrix';
import { Viewer } from './viewer';
import { StudioCameraController } from './Camera';
import { getPointHermite, getPointBezier } from './Spline';

const MILLISECONDS_IN_SECOND = 1000.0;

export const enum LinearEaseType {
    NoEase = 'NoEase',
    EaseIn = 'EaseIn',
    EaseOut = 'EaseOut',
    EaseBoth = 'EaseBoth'
}

/** Premade constant Bezier easing functions. */
const easeInFunc: Function = (t: number) => {
    return getPointBezier(0, 0, 0.53, 1, t);
}
const easeOutFunc: Function = (t: number) => {
    return getPointBezier(0, 0.47, 1, 1, t);
}
const easeBothFunc: Function = (t: number) => {
    return getPointBezier(0, 0, 1, 1, t);
}

export class Keyframe {
    /**
     * The length of time in seconds it should take to animate to this Keyframe's end position.
     */
    public interpDuration: number = 5.0;
    /**
     * The length of time in seconds to hold on this keyframe's end position before moving to the next keyframe.
     */
    public holdDuration: number = 0.0;

    public usesLinearInterp: boolean = false;
    private _linearEaseType: LinearEaseType = LinearEaseType.EaseBoth;
    public easingFunction: Function | null = easeBothFunc;
    public trsTangentIn: vec3 = vec3.create();
    public trsTangentOut: vec3 = vec3.create();

    constructor(public endPos: mat4) {
    }

    get linearEaseType(): LinearEaseType {
        return this._linearEaseType;
    }

    set linearEaseType(type: LinearEaseType) {
        if (type === LinearEaseType.NoEase)
            this.easingFunction = null;
        else if (type === LinearEaseType.EaseIn)
            this.easingFunction = easeInFunc;
        else if (type === LinearEaseType.EaseOut)
            this.easingFunction = easeOutFunc;
        else if (type === LinearEaseType.EaseBoth)
            this.easingFunction = easeBothFunc;
        this._linearEaseType = type;
    }
}

export class CameraAnimation {
    /**
     * The list of keyframes that comprise this animation. Note that the `endPosition` 
     * of the keyframe at index 0 is the camera's starting position for the animation.
     */
    public keyframes: Keyframe[] = [];

    /**
     * A counter used for default keyframe names. Because keyframes can be deleted and
     * inserted at arbitrary places, we can't simply rely on the current keyframe count 
     * for this. The starting position keyframe is named differently, so we start at -1.
     */
    public totalKeyframesAdded: number = -1;

    public insertKeyframe(after: number, keyframeEndPos: mat4) {
        this.keyframes.splice(after + 1, 0, new Keyframe(keyframeEndPos));
        this.totalKeyframesAdded++;
    }

    public appendKeyframe(keyframeEndPos: mat4) {
        this.insertKeyframe(this.keyframes.length - 1, keyframeEndPos);
    }

    public removeKeyframe(index: number) {
        this.keyframes.splice(index, 1);
    }

}

export class CameraAnimationManager {
    private animation: CameraAnimation;
    private studioCameraController: StudioCameraController;
    private selectedKeyframeIndex: number = -1;
    private editingKeyframePosition: boolean = false;
    /**
     * The translation vector components of the keyframes following and preceding the current keyframe.
     * Used for calculating tangents.
     */
    private prevTrs: vec3 = vec3.create();
    private curTrs: vec3 = vec3.create();
    private curPlus1Trs: vec3 = vec3.create();
    private curPlus2Trs: vec3 = vec3.create();
    private trsTangentInScratch: vec3 = vec3.create();
    private trsTangentOutScratch: vec3 = vec3.create();

    /**
     * Variables for animation playback.
     */
    private currentKeyframeIndex: number;
    private currentKeyframe: Keyframe;
    private currentKeyframeProgressMs: number = 0;
    private currentKeyframeInterpDurationMs: number = 0;
    private currentKeyframeTotalDurationMs: number = 0;
    private loopAnimation: boolean = false;
    private previewingKeyframe: boolean = false;
    private interpolatingFrom: mat4 = mat4.create();
    private trsFrom: vec3 = vec3.create();
    private rotQFrom: quat = quat.create();
    private trsTo: vec3 = vec3.create();
    private rotQTo: quat = quat.create();

    constructor(private uiKeyframeList: HTMLElement, private uiStudioControls: HTMLElement) {
        this.studioCameraController = new StudioCameraController(this);
        this.animation = new CameraAnimation();
    }

    public enableStudioController(viewer: Viewer): void {
        viewer.setCameraController(this.studioCameraController);
    }

    public totalKeyframesAdded(): number {
        return this.animation.totalKeyframesAdded;
    }

    public getKeyframeByIndex(index: number): Keyframe {
        this.selectedKeyframeIndex = index;
        this.studioCameraController.setToPosition(this.animation.keyframes[index].endPos);
        return this.animation.keyframes[index];
    }

    public deselectKeyframe(): void {
        this.selectedKeyframeIndex = -1;
    }

    public addNextKeyframe(pos: mat4) {
        if (this.editingKeyframePosition) {
            this.animation.keyframes[this.selectedKeyframeIndex].endPos = pos;
            this.uiKeyframeList.dispatchEvent(new Event('keyframePositionEdited'));
            this.editingKeyframePosition = false;
        } else if (this.selectedKeyframeIndex > -1) {
            // Insert new keyframe after the currently-selected keyframe.
            this.animation.insertKeyframe(this.selectedKeyframeIndex, pos);
            this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: this.selectedKeyframeIndex }));
        } else {
            // No keyframe selected
            if (this.animation.keyframes.length === 0) {
                this.animation.appendKeyframe(pos);
                this.animation.keyframes[0].interpDuration = 0;
                this.uiKeyframeList.dispatchEvent(new Event('startPositionSet'));
            } else {
                this.animation.appendKeyframe(pos);
                this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: this.animation.keyframes.length - 1 }));
            }
        }
    }

    public removeKeyframe(toRemove: number) {
        this.animation.removeKeyframe(toRemove);
        if (toRemove < this.selectedKeyframeIndex) {
            this.selectedKeyframeIndex--;
        }
    }

    public enableEditKeyframePosition(): void {
        this.editingKeyframePosition = true;
    }

    public previewKeyframe() {
        const index = this.selectedKeyframeIndex;
        let startPos: mat4;
        if (index > 0) {
            startPos = this.animation.keyframes[index - 1].endPos;
        } else if (index === 0) {
            startPos = this.animation.keyframes[this.animation.keyframes.length - 1].endPos;
        } else {
            return;
        }
        this.currentKeyframeIndex = index - 1;
        this.playbackNextKeyframe();
        this.calculateTangents();
        this.previewingKeyframe = true;
        this.studioCameraController.playAnimation(startPos);
    }

    public playAnimation(loop: boolean) {
        if (this.animation.keyframes.length > 1) {
            this.loopAnimation = loop;
            this.currentKeyframeIndex = -1;
            this.playbackNextKeyframe();
            this.calculateTangents();
            // Skip interpolation for the first keyframe.
            this.currentKeyframeProgressMs = this.currentKeyframeInterpDurationMs;
            const startPos: mat4 = this.animation.keyframes[0].endPos;
            this.studioCameraController.playAnimation(startPos);
        }
    }

    /**
     * Updates the animation progress value for the current keyframe.
     * 
     * @param dt delta time since last update
     */
    public update(dt: number): void {
        if (this.currentKeyframeProgressMs < this.currentKeyframe.interpDuration)
            this.currentKeyframeProgressMs = Math.min(this.currentKeyframeProgressMs + dt, this.currentKeyframeInterpDurationMs);
        else
            this.currentKeyframeProgressMs = Math.min(this.currentKeyframeProgressMs + dt, this.currentKeyframeTotalDurationMs);
    }

    public interpFinished(): boolean {
        return this.currentKeyframeProgressMs >= this.currentKeyframeInterpDurationMs;
    }

    public isKeyframeFinished(): boolean {
        return this.currentKeyframeProgressMs >= this.currentKeyframeTotalDurationMs;
    }

    /**
     * Performs one interpolation step in the current animation, providing a quaternion and vector describing the rotation and translation of the next animation frame.
     * 
     * @param outRot the next frame's rotation quaternion
     * @param outTrs the next frame's translation vector
     */
    public playbackInterpolationStep(outRot: quat, outTrs: vec3) {
        let interpAmount = this.currentKeyframeProgressMs / this.currentKeyframeInterpDurationMs;
        if (this.currentKeyframe.usesLinearInterp) {
            if (this.currentKeyframe.easingFunction)
                interpAmount = this.currentKeyframe.easingFunction(interpAmount);
            vec3.lerp(outTrs, this.trsFrom, this.trsTo, interpAmount);
            quat.slerp(outRot, this.rotQFrom, this.rotQTo, interpAmount);
        } else {
            for (let i = 0; i < 3; i++) {
                outTrs[i] = getPointHermite(this.trsFrom[i], this.trsTo[i], this.currentKeyframe.trsTangentIn[i], this.currentKeyframe.trsTangentOut[i], interpAmount);
            }
            quat.slerp(outRot, this.rotQFrom, this.rotQTo, easeBothFunc(interpAmount));
        }
    }

    public playbackHasNextKeyframe(): boolean {
        if (this.previewingKeyframe)
            return false;
        else if (this.loopAnimation)
            return true;
        else
            return this.currentKeyframeIndex + 1 < this.animation.keyframes.length;
    }

    public playbackNextKeyframe() {
        if (this.currentKeyframeIndex + 1 === this.animation.keyframes.length) {
            if (this.loopAnimation)
                this.currentKeyframeIndex = 0;
            else
                return;
        } else {
            this.currentKeyframeIndex++;
        }
        this.currentKeyframe = this.animation.keyframes[this.currentKeyframeIndex];
        this.currentKeyframeProgressMs = 0;
        this.currentKeyframeInterpDurationMs = this.currentKeyframe.interpDuration * MILLISECONDS_IN_SECOND;
        this.currentKeyframeTotalDurationMs = (this.currentKeyframe.interpDuration + this.currentKeyframe.holdDuration) * MILLISECONDS_IN_SECOND;
        if (this.currentKeyframe.interpDuration === 0)
            this.studioCameraController.setToPosition(this.currentKeyframe.endPos);
        else
            this.setInterpolationVectors();
        return true;
    }

    public stopAnimation() {
        this.studioCameraController.stopAnimation();
    }

    public fireStoppedEvent() {
        this.previewingKeyframe = false;
        this.uiStudioControls.dispatchEvent(new Event('animationStopped'));
    }

    public moveKeyframeUp(): boolean {
        const kf: Keyframe[] = this.animation.keyframes;
        const index: number = this.selectedKeyframeIndex;
        if (index > 1) {
            [kf[index - 1], kf[index]] = [kf[index], kf[index - 1]];
            return true;
        }
        return false;
    }

    public moveKeyframeDown(): boolean {
        const kf: Keyframe[] = this.animation.keyframes;
        const index: number = this.selectedKeyframeIndex;
        if (index > 0 && index < kf.length - 1) {
            [kf[index], kf[index + 1]] = [kf[index + 1], kf[index]];
            return true;
        }
        return false;
    }

    private setInterpolationVectors() {
        if (this.currentKeyframeIndex > 0)
            mat4.copy(this.interpolatingFrom, this.animation.keyframes[this.currentKeyframeIndex - 1].endPos);
        else
            mat4.copy(this.interpolatingFrom, this.animation.keyframes[this.animation.keyframes.length - 1].endPos);
        mat4.getTranslation(this.trsFrom, this.interpolatingFrom);
        mat4.getRotation(this.rotQFrom, this.interpolatingFrom);
        mat4.getTranslation(this.trsTo, this.currentKeyframe.endPos);
        mat4.getRotation(this.rotQTo, this.currentKeyframe.endPos);
    }

    /**
     * Called before playing or previewing an animation, calculates and assigns tangent values for hermite interpolation.
     */
    private calculateTangents(): void {
        const keyframes = this.animation.keyframes;

        if (keyframes.length < 4) {
            mat4.getTranslation(this.prevTrs, keyframes[keyframes.length - 1].endPos);
            mat4.getTranslation(this.curTrs, keyframes[0].endPos);
            mat4.getTranslation(this.curPlus1Trs, keyframes[1].endPos);
            mat4.getTranslation(this.curPlus2Trs, keyframes[keyframes.length - 1].endPos);

            vec3.sub(this.trsTangentInScratch, this.curPlus1Trs, this.prevTrs);
            vec3.scale(this.trsTangentInScratch, this.trsTangentInScratch, 0.5);
            vec3.sub(this.trsTangentOutScratch, this.curPlus2Trs, this.curTrs);
            vec3.scale(this.trsTangentOutScratch, this.trsTangentOutScratch, 0.5);

            vec3.copy(keyframes[0].trsTangentIn, this.trsTangentInScratch);
            vec3.copy(keyframes[0].trsTangentOut, this.trsTangentOutScratch);
            vec3.copy(keyframes[1].trsTangentIn, this.trsTangentOutScratch);
            if (keyframes.length === 2) {
                vec3.copy(keyframes[1].trsTangentOut, this.trsTangentInScratch);
                return;
            }
            vec3.copy(this.prevTrs, this.curPlus1Trs);
            vec3.copy(this.curPlus1Trs, this.curTrs);
            vec3.copy(this.curTrs, this.curPlus2Trs);
            vec3.copy(this.curPlus2Trs, this.prevTrs);

            vec3.sub(this.trsTangentInScratch, this.curPlus1Trs, this.prevTrs);
            vec3.scale(this.trsTangentInScratch, this.trsTangentInScratch, 0.5);
            vec3.sub(this.trsTangentOutScratch, this.curPlus2Trs, this.curTrs);
            vec3.scale(this.trsTangentOutScratch, this.trsTangentOutScratch, 0.5);

            vec3.copy(keyframes[1].trsTangentOut, this.trsTangentInScratch);
            vec3.copy(keyframes[2].trsTangentIn, this.trsTangentInScratch);
            vec3.copy(keyframes[2].trsTangentOut, this.trsTangentOutScratch);
            return;
        }

        mat4.getTranslation(this.prevTrs, keyframes[keyframes.length - 1].endPos);
        mat4.getTranslation(this.curTrs, keyframes[0].endPos);
        mat4.getTranslation(this.curPlus1Trs, keyframes[1].endPos);
        mat4.getTranslation(this.curPlus2Trs, keyframes[2].endPos);

        vec3.sub(this.trsTangentInScratch, this.curPlus1Trs, this.prevTrs);
        vec3.scale(this.trsTangentInScratch, this.trsTangentInScratch, 0.5);
        vec3.sub(this.trsTangentOutScratch, this.curPlus2Trs, this.curTrs);
        vec3.scale(this.trsTangentOutScratch, this.trsTangentOutScratch, 0.5);

        vec3.copy(keyframes[0].trsTangentIn, this.trsTangentInScratch);
        vec3.copy(keyframes[0].trsTangentOut, this.trsTangentOutScratch);

        for (let i = 1; i < keyframes.length; i++) {
            vec3.copy(this.prevTrs, this.curTrs);
            vec3.copy(this.curTrs, this.curPlus1Trs);
            vec3.copy(this.curPlus1Trs, this.curPlus2Trs);
            mat4.getTranslation(this.curPlus2Trs, keyframes[(i + 2) % keyframes.length].endPos);

            vec3.sub(this.trsTangentInScratch, this.curPlus1Trs, this.prevTrs);
            vec3.scale(this.trsTangentInScratch, this.trsTangentInScratch, 0.5);
            vec3.sub(this.trsTangentOutScratch, this.curPlus2Trs, this.curTrs);
            vec3.scale(this.trsTangentOutScratch, this.trsTangentOutScratch, 0.5);

            vec3.copy(keyframes[i].trsTangentIn, this.trsTangentInScratch);
            vec3.copy(keyframes[i].trsTangentOut, this.trsTangentOutScratch);
        }
    }
}
