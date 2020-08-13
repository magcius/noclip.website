import { mat4, vec3 } from 'gl-matrix';
import { Viewer } from './viewer';
import { StudioCameraController } from './Camera';
import { getPointHermite, getPointBezier } from './Spline';
import { getMatrixAxisZ, computeEulerAngleRotationFromSRTMatrix, Vec3UnitY, Vec3Zero, lerp } from './MathHelpers';

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

export class InterpolationStep {
    pos: vec3 = vec3.create();
    lookAtPos: vec3 = vec3.create();
    bank: number = 0;
}

export interface Keyframe {
    /**
     * The length of time in seconds it should take to animate to this Keyframe's end position.
     */
    interpDuration: number;
    /**
     * The length of time in seconds to hold on this keyframe's end position before moving to the next keyframe.
     */
    holdDuration: number;
    usesLinearInterp: boolean;
    linearEaseType: LinearEaseType;
    posTangentIn: vec3;
    posTangentOut: vec3;
    lookAtPosTangentIn: vec3;
    lookAtPosTangentOut: vec3;
    bankTangentIn: number;
    bankTangentOut: number;
    endPos: mat4;
    bank: number;
    name?: string;
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
        this.totalKeyframesAdded++;
        const name = this.totalKeyframesAdded === 0 ? 'Starting Position' : 'Keyframe ' + this.totalKeyframesAdded;
        const newKeyframe: Keyframe = {
            interpDuration: 5,
            holdDuration: 0,
            usesLinearInterp: false,
            linearEaseType: LinearEaseType.EaseBoth,
            posTangentIn: vec3.create(),
            posTangentOut: vec3.create(),
            lookAtPosTangentIn: vec3.create(),
            lookAtPosTangentOut: vec3.create(),
            bankTangentIn: 0,
            bankTangentOut: 0,
            bank: 0,
            endPos: keyframeEndPos,
            name: name
        }
        this.keyframes.splice(after + 1, 0, newKeyframe);
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

    // The translation vector components of the keyframes following and preceding the current keyframe.
    // Used for calculating tangents.
    private prevPos: vec3 = vec3.create();
    private nextPos: vec3 = vec3.create();
    private prevLookAtPos: vec3 = vec3.create();
    private nextLookAtPos: vec3 = vec3.create();
    private scratchVec1: vec3 = vec3.create();
    private scratchVec2: vec3 = vec3.create();

    // Variables for animation playback.
    private currentKeyframeIndex: number;
    private currentKeyframe: Keyframe;
    private currentKeyframeProgressMs: number = 0;
    private pastDurationMs: number = 0;
    private currentKeyframeInterpDurationMs: number = 0;
    private currentKeyframeTotalDurationMs: number = 0;
    private loopAnimation: boolean = false;
    private previewingKeyframe: boolean = false;

    // Interpolation variables.
    private previousKeyframe: Keyframe;

    private posFrom: vec3 = vec3.create();
    private forwardVecFrom: vec3 = vec3.create();
    private lookAtPosFrom: vec3 = vec3.create();
    private bankRotFrom: number = 0;

    private posTo: vec3 = vec3.create();
    private forwardVecTo: vec3 = vec3.create();
    private lookAtPosTo: vec3 = vec3.create();
    private bankRotTo: number = 0;

    // Flags to indicate whether the position and bank position need to be interpolated for the current keyframe.
    private interpPos: boolean = true;
    private interpBank: boolean = false;

    constructor(private uiKeyframeList: HTMLElement, private uiStudioControls: HTMLElement) {
        this.studioCameraController = new StudioCameraController(this);
        this.animation = new CameraAnimation();
    }

    public enableStudioController(viewer: Viewer): void {
        viewer.setCameraController(this.studioCameraController);
    }

    public loadAnimation(keyframes: Keyframe[]) {
        if (keyframes.length === 0)
            return;
        for (let i = 0; i < keyframes.length; i++) {
            keyframes[i].posTangentIn = vec3.create();
            keyframes[i].posTangentOut = vec3.create();
            keyframes[i].lookAtPosTangentIn = vec3.create();
            keyframes[i].lookAtPosTangentOut = vec3.create();
        }
        this.animation = new CameraAnimation();
        this.animation.keyframes = keyframes;
        this.uiKeyframeList.dispatchEvent(new Event('startPositionSet'));
        for (let i = 1; i < keyframes.length; i++) {
            if (this.animation.keyframes[i].name === undefined)
                this.animation.keyframes[i].name = 'Keyframe ' + i;
            this.animation.totalKeyframesAdded = i;
            this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: i }));
        }
    }

    public newAnimation() {
        this.animation = new CameraAnimation();
    }

    public serializeAnimation(): string {
        const exclude = ['posTangentIn', 'posTangentOut', 'lookAtPosTangentIn', 'lookAtPosTangentOut, bankTangentIn, bankTangentOut, bank'];
        return JSON.stringify(this.animation.keyframes, (key, value) => {
            if (exclude.includes(key))
                return undefined;
            else
                return value;
        });
    }

    public getKeyframeByIndex(index: number): Keyframe {
        this.studioCameraController.setToPosition(this.animation.keyframes[index].endPos);
        return this.animation.keyframes[index];
    }

    public addNextKeyframe(pos: mat4) {
        const afterIndex: number = parseInt(this.uiKeyframeList.dataset.selectedIndex as string);
        if (this.uiKeyframeList.dataset.editingKeyframePosition) {
            this.editKeyframePosition(pos, afterIndex);
            return;
        }
        if (afterIndex > -1) {
            // Insert new keyframe after the specified index.
            this.animation.insertKeyframe(afterIndex, pos);
            this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: afterIndex + 1 }));
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

    public editKeyframePosition(pos: mat4, index: number) {
        if (index >= 0 && index < this.animation.keyframes.length)
            this.animation.keyframes[index].endPos = pos;
        this.endEditKeyframePosition();
    }

    public endEditKeyframePosition() {
        this.uiKeyframeList.dispatchEvent(new Event('keyframePositionEdited'));
    }

    public removeKeyframe(toRemove: number) {
        this.animation.removeKeyframe(toRemove);
    }

    public previewKeyframe(index: number, loopEnabled: boolean) {
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
        this.loopAnimation = loopEnabled;
        this.calculateAllTangents();
        this.previewingKeyframe = true;
        this.studioCameraController.playAnimation(startPos);
    }

    public playAnimation(loop: boolean) {
        if (this.animation.keyframes.length > 1) {
            this.loopAnimation = loop;
            this.currentKeyframeIndex = -1;
            this.playbackNextKeyframe();
            this.calculateAllTangents();
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
        if (this.currentKeyframeProgressMs < this.currentKeyframeInterpDurationMs) {
            this.currentKeyframeProgressMs += dt;
            if (this.currentKeyframeProgressMs > this.currentKeyframeInterpDurationMs)
                this.pastDurationMs = this.currentKeyframeProgressMs - this.currentKeyframeInterpDurationMs;
        } else {
            this.currentKeyframeProgressMs = Math.min(this.currentKeyframeProgressMs + dt, this.currentKeyframeTotalDurationMs);
        }
    }

    public interpFinished(): boolean {
        return this.currentKeyframeProgressMs >= this.currentKeyframeInterpDurationMs;
    }

    public isKeyframeFinished(): boolean {
        return this.currentKeyframeProgressMs >= this.currentKeyframeTotalDurationMs;
    }

    /**
     * Performs one interpolation step in the current animation, updating the provided 
     * object with the translation and lookAt focus point of the next animation frame.
     * 
     * @param outInterpStep the next interpolation step of the animation
     */
    public playbackInterpolationStep(outInterpStep: InterpolationStep) {
        let interpAmount = this.currentKeyframeProgressMs / this.currentKeyframeInterpDurationMs;
        if (this.currentKeyframe.usesLinearInterp) {
            const easeFunc = this.getEasingFuncForEaseType(this.currentKeyframe.linearEaseType);
            if (easeFunc)
                interpAmount = easeFunc(interpAmount);
            vec3.lerp(outInterpStep.pos, this.posFrom, this.posTo, interpAmount);
            vec3.lerp(outInterpStep.lookAtPos, this.lookAtPosFrom, this.lookAtPosTo, interpAmount);
            outInterpStep.bank = lerp(this.bankRotFrom, this.bankRotTo, interpAmount);
        } else {
            for (let i = 0; i < 3; i++) {
                if (this.interpPos)
                    outInterpStep.pos[i] = getPointHermite(this.posFrom[i], this.posTo[i], this.currentKeyframe.posTangentIn[i], this.currentKeyframe.posTangentOut[i], interpAmount);
                else
                    outInterpStep.pos[i] = this.posTo[i];
                outInterpStep.lookAtPos[i] = getPointHermite(this.lookAtPosFrom[i], this.lookAtPosTo[i], this.currentKeyframe.posTangentIn[i], this.currentKeyframe.posTangentOut[i], interpAmount);
            }
            if (this.interpBank)
                outInterpStep.bank = getPointHermite(this.bankRotFrom, this.bankRotTo, this.currentKeyframe.bankTangentIn, this.currentKeyframe.bankTangentOut, interpAmount);
            else
                outInterpStep.bank = this.bankRotTo;
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
        this.currentKeyframeProgressMs = 0 + this.pastDurationMs;
        this.pastDurationMs = 0;
        this.currentKeyframeInterpDurationMs = this.currentKeyframe.interpDuration * MILLISECONDS_IN_SECOND;
        this.currentKeyframeTotalDurationMs = (this.currentKeyframe.interpDuration + this.currentKeyframe.holdDuration) * MILLISECONDS_IN_SECOND;
        if (this.currentKeyframe.interpDuration === 0)
            this.studioCameraController.setToPosition(this.currentKeyframe.endPos);
        else
            this.setInterpolationVectors();
    }

    public stopAnimation() {
        this.studioCameraController.stopAnimation();
    }

    public fireStoppedEvent() {
        this.previewingKeyframe = false;
        this.uiStudioControls.dispatchEvent(new Event('animationStopped'));
    }

    public moveKeyframeUp(index: number): boolean {
        const kf: Keyframe[] = this.animation.keyframes;
        if (index > 1) {
            [kf[index - 1], kf[index]] = [kf[index], kf[index - 1]];
            return true;
        }
        return false;
    }

    public moveKeyframeDown(index: number): boolean {
        const kf: Keyframe[] = this.animation.keyframes;
        if (index > 0 && index < kf.length - 1) {
            [kf[index], kf[index + 1]] = [kf[index + 1], kf[index]];
            return true;
        }
        return false;
    }

    public getMatchedSpeedDuration(index: number, loopEnabled: boolean): number {
        let curKf = this.animation.keyframes[index];
        let duration = curKf.interpDuration;
        if (this.animation.keyframes.length < 3)
            return duration;
        let prevKf;
        let beforePrevKf;
        if (index > 1) {
            prevKf = this.animation.keyframes[index - 1];
            beforePrevKf = this.animation.keyframes[index - 2];
        } else if (index === 1) {
            prevKf = this.animation.keyframes[0];
            beforePrevKf = this.animation.keyframes[this.animation.keyframes.length - 1];
        } else {
            prevKf = this.animation.keyframes[this.animation.keyframes.length - 1];
            beforePrevKf = this.animation.keyframes[this.animation.keyframes.length - 2];
        }
        if (prevKf.interpDuration > 0) {
            this.loopAnimation = loopEnabled;
            this.calculateAllTangents();
            const prevLength = this.estimateHermiteCurveLength(beforePrevKf, prevKf);
            if (prevLength === 0)
                return 0;
            const ratio = prevKf.interpDuration / prevLength;
            const curLength = this.estimateHermiteCurveLength(prevKf, curKf);
            if (curLength > 0)
                duration = ratio * curLength;
        }
        return duration;
    }

    /**
     * Estimates the length of the hermite curve segment between two keyframes.
     *
     * @param fromKeyframe the keyframe describing the start position
     * @param toKeyframe the keyframe describing the end position
     */
    private estimateHermiteCurveLength(fromKeyframe: Keyframe, toKeyframe: Keyframe): number {
        mat4.getTranslation(this.prevPos, fromKeyframe.endPos);
        mat4.getTranslation(this.nextPos, toKeyframe.endPos);
        let length = 0;
        if (!vec3.exactEquals(this.prevPos, this.nextPos)) {
            vec3.copy(this.scratchVec1, this.prevPos);
            const numSteps = 10000;
            for (let i = 1; i <= numSteps; i++) {
                for (let j = 0; j < 3; j++) {
                    this.scratchVec2[j] = getPointHermite(this.prevPos[j], this.nextPos[j], toKeyframe.posTangentIn[j], toKeyframe.posTangentOut[j], i / numSteps);
                }
                length += vec3.distance(this.scratchVec1, this.scratchVec2);
                vec3.copy(this.scratchVec1, this.scratchVec2);
            }
        }
        return length;
    }

    public isAnimation(a: Keyframe[]): boolean {
        if (!Array.isArray(a))
            return false;
        try {
            for (let i = 0; i < a.length; i++) {
                for (let j = 0; j < 16; j++) {
                    if (typeof a[i].endPos[j] !== 'number')
                        return false;
                }
                if (typeof a[i].holdDuration !== 'number')
                    return false;
                if (typeof a[i].interpDuration !== 'number')
                    return false;
                if (typeof a[i].linearEaseType !== 'string')
                    return false;
                if (typeof a[i].usesLinearInterp !== 'boolean')
                    return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    private getEasingFuncForEaseType(easeType: LinearEaseType): Function | null {
        if (easeType === LinearEaseType.EaseIn)
            return easeInFunc;
        else if (easeType === LinearEaseType.EaseOut)
            return easeOutFunc;
        else if (easeType === LinearEaseType.EaseBoth)
            return easeBothFunc;
        else
            return null;
    }

    private setInterpolationVectors() {
        if (this.currentKeyframeIndex > 0)
            this.previousKeyframe = this.animation.keyframes[this.currentKeyframeIndex - 1];
        else
            this.previousKeyframe = this.animation.keyframes[this.animation.keyframes.length - 1];
        mat4.getTranslation(this.posFrom, this.previousKeyframe.endPos);
        mat4.getTranslation(this.posTo, this.currentKeyframe.endPos);
        getMatrixAxisZ(this.forwardVecFrom, this.previousKeyframe.endPos);
        getMatrixAxisZ(this.forwardVecTo, this.currentKeyframe.endPos);
        vec3.normalize(this.forwardVecFrom, this.forwardVecFrom);
        vec3.normalize(this.forwardVecTo, this.forwardVecTo);
        vec3.scaleAndAdd(this.lookAtPosFrom, this.posFrom, this.forwardVecFrom, -100);
        vec3.scaleAndAdd(this.lookAtPosTo, this.posTo, this.forwardVecTo, -100);
        this.interpPos = !vec3.exactEquals(this.posFrom, this.posTo);
        this.bankRotFrom = this.previousKeyframe.bank;
        this.bankRotTo = this.currentKeyframe.bank;
        this.interpBank = Math.round(this.bankRotFrom * 1000000) != Math.round(this.bankRotTo * 1000000);
    }

    private calculateBankRotationValues() {
        let previousBank = 0;
        let fullRotations = 0;
        let kf: Keyframe;
        for (let i = 0; i < this.animation.keyframes.length; i++) {
            kf = this.animation.keyframes[i];
            computeEulerAngleRotationFromSRTMatrix(this.scratchVec1, kf.endPos);
            vec3.copy(this.scratchVec2, Vec3UnitY);
            vec3.rotateZ(this.scratchVec2, this.scratchVec2, Vec3Zero, -this.scratchVec1[2]);
            vec3.rotateY(this.scratchVec2, this.scratchVec2, Vec3Zero, -this.scratchVec1[1]);
            vec3.rotateX(this.scratchVec2, this.scratchVec2, Vec3Zero, -this.scratchVec1[0]);
            this.scratchVec2[2] = 0;
            vec3.normalize(this.scratchVec2, this.scratchVec2);
            kf.bank = vec3.angle(this.scratchVec2, Vec3UnitY);
            if (this.scratchVec2[0] < 0) {
                kf.bank *= -1;
            }
            kf.bank += fullRotations * (2 * Math.PI);

            if (Math.abs(kf.bank - previousBank) > Math.PI) {
                // Closest rotation is in same direction, add or subtract a full rotation to the new bank
                if (previousBank < 0)
                    kf.bank -= 2 * Math.PI;
                else
                    kf.bank += 2 * Math.PI;
            }

            if (kf.bank > 0) {
                fullRotations = Math.floor(kf.bank / (2 * Math.PI));
            } else {
                fullRotations = Math.ceil(kf.bank / (2 * Math.PI));
            }
            previousBank = kf.bank;
        }
    }

    /**
     * Called before playing or previewing an animation, calculates and assigns tangent values for hermite interpolation.
     */
    private calculateAllTangents(): void {
        this.calculateBankRotationValues();
        const keyframes = this.animation.keyframes;

        if (keyframes.length < 4) {
            this.calculateTangents(keyframes[0], keyframes[0], keyframes[1]);
            if (keyframes.length === 2) {
                if (this.loopAnimation)
                    this.zeroEndpointTangents();
                else
                    this.calculateTangents(keyframes[0], keyframes[1], keyframes[1]);
                return;
            }
            this.calculateTangents(keyframes[0], keyframes[1], keyframes[2]);
            if (this.loopAnimation)
                this.calculateTangents(keyframes[1], keyframes[2], keyframes[0]);
            else 
                this.zeroEndpointTangents();
            return;
        }

        if (this.loopAnimation)
            this.calculateTangents(keyframes[keyframes.length - 1], keyframes[0], keyframes[1]);
        else
            this.calculateTangents(keyframes[0], keyframes[0], keyframes[1]);

        for (let i = 1; i < keyframes.length - 1; i++) {
            this.calculateTangents(keyframes[i - 1], keyframes[i], keyframes[i + 1]);
        }

        if (this.loopAnimation)
            this.calculateTangents(keyframes[keyframes.length - 2], keyframes[keyframes.length - 1], keyframes[0]);
        else
            this.zeroEndpointTangents();
    }

    private calculateTangents(prevKf: Keyframe, curKf: Keyframe, nextKf: Keyframe): void {
        mat4.getTranslation(this.prevPos, prevKf.endPos);
        mat4.getTranslation(this.nextPos, nextKf.endPos);
        vec3.sub(this.scratchVec1, this.nextPos, this.prevPos);
        vec3.scale(this.scratchVec1, this.scratchVec1, 0.5);
        vec3.copy(curKf.posTangentOut, this.scratchVec1);
        vec3.copy(nextKf.posTangentIn, this.scratchVec1);

        getMatrixAxisZ(this.forwardVecFrom, prevKf.endPos);
        getMatrixAxisZ(this.forwardVecTo, nextKf.endPos);
        vec3.normalize(this.forwardVecFrom, this.forwardVecFrom);
        vec3.normalize(this.forwardVecTo, this.forwardVecTo);
        vec3.scaleAndAdd(this.prevLookAtPos, this.prevPos, this.forwardVecFrom, -100);
        vec3.scaleAndAdd(this.nextLookAtPos, this.nextPos, this.forwardVecTo, -100);
        vec3.sub(this.scratchVec2, this.nextLookAtPos, this.prevLookAtPos);
        vec3.scale(this.scratchVec2, this.scratchVec2, 0.5);
        vec3.copy(curKf.lookAtPosTangentOut, this.scratchVec2);
        vec3.copy(nextKf.lookAtPosTangentIn, this.scratchVec2);

        curKf.bankTangentOut = (nextKf.bank - prevKf.bank) / 2;
        nextKf.bankTangentIn = (nextKf.bank - prevKf.bank) / 2;
    }

    private zeroEndpointTangents(): void {
        vec3.zero(this.animation.keyframes[this.animation.keyframes.length - 1].posTangentOut);
        vec3.zero(this.animation.keyframes[this.animation.keyframes.length - 1].lookAtPosTangentOut);
        this.animation.keyframes[this.animation.keyframes.length - 1].bankTangentOut = 0;
        vec3.zero(this.animation.keyframes[0].posTangentIn);
        vec3.zero(this.animation.keyframes[0].lookAtPosTangentIn);
        this.animation.keyframes[0].bankTangentIn = 0;
    }
}
