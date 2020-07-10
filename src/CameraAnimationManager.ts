import { mat4, vec3 } from 'gl-matrix';
import { Viewer } from './viewer';
import { StudioCameraController } from './Camera';
import { getPointBezier } from './Spline';

const MAX_KEYFRAME_DURATION_SECONDS = 100.0;
const MIN_KEYFRAME_DURATION = 0;
const MILLISECONDS_IN_SECOND = 1000.0;

export const enum LinearEaseType {
    NoEase = 'NoEase',
    EaseIn = 'EaseIn',
    EaseOut = 'EaseOut',
    EaseBoth = 'EaseBoth'
}

/** Premade constant Bezier easing functions. */
const easeBothFunc: Function = (t: number) => {
    return getPointBezier(0, 0, 1, 1, t);
}
const easeInFunc: Function = (t: number) => {
    return getPointBezier(0, 0, 0.53, 1, t);
}
const easeOutFunc: Function = (t: number) => {
    return getPointBezier(0, 0.47, 1, 1, t);
}

export class Keyframe {
    /**
     * The length of time in milliseconds it should take to animate to this Keyframe's end position.
     */
    private _interpDuration: number = 5000.0;
    /**
     * The length of time in milliseconds to hold on this keyframe's end position before moving to the next keyframe.
     */
    private _holdDuration: number = 0.0;

    private _interpProgress: number = 0;
    private _holdProgress: number = 0;

    public usesLinearInterp: boolean = false;
    private _linearEaseType: LinearEaseType = LinearEaseType.EaseBoth;
    private easingFunction: Function | null = easeBothFunc;
    public trsTangentIn: vec3;
    public trsTangentOut: vec3;

    constructor(public endPos: mat4) {
        this.trsTangentIn = vec3.create();
        this.trsTangentOut = vec3.create();
    }

    /**
     * Updates the current state of this Keyframe.
     * 
     * @param dt delta time since last update
     */
    public update(dt: number): void {
        if (this._interpProgress < this._interpDuration) {
            this._interpProgress = Math.min(this._interpProgress + dt, this._interpDuration);
        } else {
            this._holdProgress = Math.min(this._holdProgress + dt, this._holdDuration);
        }
    }

    public interpFinished(): boolean {
        return this._interpProgress === this._interpDuration;
    }

    public isFinished(): boolean {
        return this._interpProgress === this._interpDuration && this._holdProgress === this._holdDuration;
    }

    /**
     * Returns a bezier-eased time interpolation value. The easeBoth function is used by default.
     * If this keyframe uses linear interpolation, the currently-selected easing function is used
     * instead, if any.
     */
    public bezierInterpAmount(): number {
        if (this.usesLinearInterp) {
            return this.interpAmount;
        } else
            return easeBothFunc(this._interpProgress / this._interpDuration);
    }

    get interpAmount(): number {
        if (this.usesLinearInterp && this.easingFunction)
            return this.easingFunction(this._interpProgress / this._interpDuration);
        else
            return this._interpProgress / this._interpDuration;
    }

    get durationInSeconds(): number {
        return this._interpDuration / MILLISECONDS_IN_SECOND;
    }

    set durationInSeconds(newDurationSeconds: number) {
        if (newDurationSeconds <= MIN_KEYFRAME_DURATION) {
            this._interpDuration = MIN_KEYFRAME_DURATION;
        } else if (newDurationSeconds >= MAX_KEYFRAME_DURATION_SECONDS) {
            this._interpDuration = MAX_KEYFRAME_DURATION_SECONDS * MILLISECONDS_IN_SECOND;
        } else {
            this._interpDuration = newDurationSeconds * MILLISECONDS_IN_SECOND;
        }
    }

    get holdDurationInSeconds(): number {
        return this._holdDuration / MILLISECONDS_IN_SECOND;
    }

    set holdDurationInSeconds(newHoldDurationSeconds: number) {
        if (newHoldDurationSeconds <= MIN_KEYFRAME_DURATION) {
            this._holdDuration = MIN_KEYFRAME_DURATION;
        } else if (newHoldDurationSeconds >= MAX_KEYFRAME_DURATION_SECONDS) {
            this._holdDuration = MAX_KEYFRAME_DURATION_SECONDS * MILLISECONDS_IN_SECOND;
        } else {
            this._holdDuration = newHoldDurationSeconds * MILLISECONDS_IN_SECOND;
        }
    }

    get linearEaseType(): LinearEaseType {
        return this._linearEaseType;
    }

    set linearEaseType(type: LinearEaseType) {
        switch (type) {
            case LinearEaseType.NoEase:
                this.easingFunction = null;
                break;
            case LinearEaseType.EaseIn:
                this.easingFunction = easeInFunc;
                break;
            case LinearEaseType.EaseOut:
                this.easingFunction = easeOutFunc;
                break;
            case LinearEaseType.EaseBoth:
                this.easingFunction = easeBothFunc;
                break;
        }
        this._linearEaseType = type;
    }

    public reset() {
        this._interpProgress = 0;
        this._holdProgress = 0;
    }

    public skipInterpolation() {
        this._interpProgress = this._interpDuration;
    }

}

export class CameraAnimation {
    /**
     * The list of keyframes that comprise this animation. Note that the `endPosition` 
     * of the keyframe at index 0 is the camera's starting position for the animation.
     */
    keyframes: Keyframe[] = [];

    /**
     * A counter used for default keyframe names. Because keyframes can be deleted and
     * inserted at arbitrary places, we can't simply rely on the current keyframe count 
     * for this. The starting position keyframe is named differently, so we start at -1.
     */
    public totalKeyframesAdded: number = -1;

    insertKeyframe(after: number, keyframeEndPos: mat4) {
        this.keyframes.splice(after + 1, 0, new Keyframe(keyframeEndPos));
        this.totalKeyframesAdded++;
    }

    appendKeyframe(keyframeEndPos: mat4) {
        this.insertKeyframe(this.keyframes.length - 1, keyframeEndPos);
    }

    removeKeyframe(index: number) {
        this.keyframes.splice(index, 1);
    }

}

export class CameraAnimationManager {
    private currentAnimation: CameraAnimation;
    private studioCameraController: StudioCameraController;
    private selectedKeyframeIndex: number = -1;
    private editingKeyframePosition: boolean = false;
    /**
     * The translation vector components of the keyframes following the current keyframe. Used for calculating tangents.
     */
    private prevTrs: vec3;
    private curTrs: vec3;
    private curPlus1Trs: vec3;
    private curPlus2Trs: vec3;
    private trsTangentInScratch: vec3;
    private trsTangentOutScratch: vec3;

    constructor(private uiKeyframeList: HTMLElement, private uiStudioControls: HTMLElement) {
        this.studioCameraController = new StudioCameraController(this);
        this.currentAnimation = new CameraAnimation();
        this.prevTrs = vec3.create();
        this.curTrs = vec3.create();
        this.curPlus1Trs = vec3.create();
        this.curPlus2Trs = vec3.create();
        this.trsTangentInScratch = vec3.create();
        this.trsTangentOutScratch = vec3.create();
    }

    public enableStudioController(viewer: Viewer): void {
        viewer.setCameraController(this.studioCameraController);
    }

    public totalKeyframesAdded(): number {
        return this.currentAnimation.totalKeyframesAdded;
    }

    public getKeyframeByIndex(index: number): Keyframe {
        this.selectedKeyframeIndex = index;
        this.studioCameraController.setToPosition(this.currentAnimation.keyframes[index].endPos);
        return this.currentAnimation.keyframes[index];
    }

    public deselectKeyframe(): void {
        this.selectedKeyframeIndex = -1;
    }

    public addNextKeyframe(pos: mat4) {
        if (this.editingKeyframePosition) {
            this.currentAnimation.keyframes[this.selectedKeyframeIndex].endPos = pos;
            this.uiKeyframeList.dispatchEvent(new Event('keyframePositionEdited'));
            this.editingKeyframePosition = false;
        } else if (this.selectedKeyframeIndex > -1) {
            // Insert new keyframe after the currently-selected keyframe.
            this.currentAnimation.insertKeyframe(this.selectedKeyframeIndex, pos);
            this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: this.selectedKeyframeIndex }));
        } else {
            // No keyframe selected
            if (this.currentAnimation.keyframes.length === 0) {
                this.currentAnimation.appendKeyframe(pos);
                this.currentAnimation.keyframes[0].durationInSeconds = 0;
                this.uiKeyframeList.dispatchEvent(new Event('startPositionSet'));
            } else {
                this.currentAnimation.appendKeyframe(pos);
                this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: this.currentAnimation.keyframes.length - 1 }));
            }
        }
    }

    public removeKeyframe(toRemove: number) {
        this.currentAnimation.removeKeyframe(toRemove);
        if (toRemove < this.selectedKeyframeIndex) {
            this.selectedKeyframeIndex--;
        }
    }

    public enableEditKeyframePosition(): void {
        this.editingKeyframePosition = true;
    }

    public playAnimation(loop: boolean) {
        if (this.currentAnimation.keyframes.length > 1) {
            this.calculateTangents();
            const startPos: mat4 = this.currentAnimation.keyframes[0].endPos;
            this.studioCameraController.playAnimation(this.currentAnimation.keyframes, startPos, loop);
        }
    }

    public previewKeyframe() {
        const index = this.selectedKeyframeIndex;
        let startPos: mat4;
        if (index > 0) {
            startPos = this.currentAnimation.keyframes[index - 1].endPos;
        } else if (index === 0) {
            startPos = this.currentAnimation.keyframes[this.currentAnimation.keyframes.length - 1].endPos;
        } else {
            return;
        }
        this.calculateTangents();
        this.studioCameraController.playAnimation(new Array(this.currentAnimation.keyframes[index]), startPos, false);
    }

    public stopAnimation() {
        this.studioCameraController.stopAnimation();
    }

    public fireStoppedEvent() {
        this.uiStudioControls.dispatchEvent(new Event('animationStopped'));
    }

    public moveKeyframeUp(): boolean {
        const kf: Keyframe[] = this.currentAnimation.keyframes;
        const index: number = this.selectedKeyframeIndex;
        if (index > 1) {
            [kf[index - 1], kf[index]] = [kf[index], kf[index - 1]];
            return true;
        }
        return false;
    }

    public moveKeyframeDown(): boolean {
        const kf: Keyframe[] = this.currentAnimation.keyframes;
        const index: number = this.selectedKeyframeIndex;
        if (index > 0 && index < kf.length - 1) {
            [kf[index], kf[index + 1]] = [kf[index + 1], kf[index]];
            return true;
        }
        return false;
    }

    /**
     * Called before playing or previewing an animation, calculates and assigns tangent values for hermite interpolation.
     */
    private calculateTangents(): void {
        const keyframes = this.currentAnimation.keyframes;

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
