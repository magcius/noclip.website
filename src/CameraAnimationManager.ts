import { mat4 } from 'gl-matrix';
import { Viewer } from './viewer';
import { StudioCameraController } from './Camera';
import BezierEasing from 'bezier-easing';

const MAX_KEYFRAME_DURATION_SECONDS = 100.0;
const MIN_KEYFRAME_DURATION = 0;
const MILLISECONDS_IN_SECOND = 1000.0;

export enum InterpolationType {
    LINEAR = 'LINEAR',
    EASE_IN = 'EASE_IN',
    EASE_OUT = 'EASE_OUT',
    EASE_BOTH = 'EASE_BOTH'
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

    private _interpType: InterpolationType = InterpolationType.LINEAR;
    private bezier: BezierEasing.EasingFunction | null = null;

    constructor(public endPos: mat4) {
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

    get interpAmount(): number {
        if (this.bezier) {
            return this.bezier(this._interpProgress / this._interpDuration);
        } else {
            return this._interpProgress / this._interpDuration;
        }
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

    get interpType(): InterpolationType {
        return this._interpType;
    }

    set interpType(type: InterpolationType) {
        switch (type) {
            case InterpolationType.LINEAR:
                this.bezier = null;
                break;
            case InterpolationType.EASE_IN:
                this.bezier = BezierEasing(0.42, 0, 1, 1);
                break;
            case InterpolationType.EASE_OUT:
                this.bezier = BezierEasing(0, 0, 0.58, 1);
                break;
            case InterpolationType.EASE_BOTH:
                this.bezier = BezierEasing(0.42, 0, 0.58, 1);
                break;
        }
        this._interpType = type;
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
    keyframes: Keyframe[];

    /**
     * A counter used for default keyframe names. Because keyframes can be deleted and
     * inserted at arbitrary places, we can't simply rely on the current keyframe count 
     * for this. The starting position keyframe is named differently, so we start at -1.
     */
    private _totalKeyframesAdded: number = -1;

    constructor() {
        this.keyframes = [];
    }

    insertKeyframe(after: number, keyframeEndPos: mat4) {
        this.keyframes.splice(after + 1, 0, new Keyframe(keyframeEndPos));
        this._totalKeyframesAdded++;
    }

    appendKeyframe(keyframeEndPos: mat4) {
        this.insertKeyframe(this.keyframes.length - 1, keyframeEndPos);
    }

    removeKeyframe(index: number) {
        this.keyframes.splice(index, 1);
    }

    get totalKeyframesAdded(): number {
        return this._totalKeyframesAdded;
    }
}

export class CameraAnimationManager {
    private currentAnimation: CameraAnimation;
    private studioCameraController: StudioCameraController;
    private selectedKeyframeIndex: number = -1;
    private editingKeyframePosition: boolean = false;

    constructor(private uiKeyframeList: HTMLElement, private uiStudioControls: HTMLElement) {
        this.studioCameraController = new StudioCameraController(this);
        this.currentAnimation = new CameraAnimation();
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
            this.currentAnimation.keyframes[this.selectedKeyframeIndex] = new Keyframe(pos);
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
            [kf[index-1], kf[index]] = [kf[index], kf[index-1]];
            return true;
        }
        return false;
    }

    public moveKeyframeDown(): boolean {
        const kf: Keyframe[] = this.currentAnimation.keyframes;
        const index: number = this.selectedKeyframeIndex;
        if (index > 0 && index < kf.length - 1) {
            [kf[index], kf[index+1]] = [kf[index+1], kf[index]];
            return true;
        }
        return false;
    }
}
