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

interface KeyframeTrack {
    value: number;
    tangentIn: number;
    tangentOut: number;
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
    targetPositionX: KeyframeTrack;
    targetPositionY: KeyframeTrack;
    targetPositionZ: KeyframeTrack;
    lookAtPositionX: KeyframeTrack;
    lookAtPositionY: KeyframeTrack;
    lookAtPositionZ: KeyframeTrack;
    bank: KeyframeTrack;
    relativeBank: number;
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

    public insertKeyframe(after: number, keyframe: Keyframe) {
        this.totalKeyframesAdded++;
        if (!keyframe.name || keyframe.name.trim() === '')
            keyframe.name = this.totalKeyframesAdded === 0 ? 'Starting Position' : 'Keyframe ' + this.totalKeyframesAdded;
        this.keyframes.splice(after + 1, 0, keyframe);
    }

    public appendKeyframe(keyframe: Keyframe) {
        this.insertKeyframe(this.keyframes.length - 1, keyframe);
    }

    public removeKeyframe(index: number) {
        this.keyframes.splice(index, 1);
    }

}

export class CameraAnimationManager {
    private animation: CameraAnimation;
    private studioCameraController: StudioCameraController;
    private scratchVec1: vec3 = vec3.create();
    private scratchVec2: vec3 = vec3.create();

    // The translation vector components of the keyframes following and preceding the current keyframe.
    // Used for calculating tangents.
    private prevPos: vec3 = vec3.create();
    private nextPos: vec3 = vec3.create();
    private prevLookAtPos: vec3 = vec3.create();
    private nextLookAtPos: vec3 = vec3.create();
    private scaleFactor: number = 0.5;

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
    private targetPosFrom: vec3 = vec3.create();
    private lookAtPosFrom: vec3 = vec3.create();
    private bankRotFrom: number = 0;

    private targetPosTo: vec3 = vec3.create();
    private targetPosToTangentIn: vec3 = vec3.create();
    private targetPosToTangentOut: vec3 = vec3.create();
    private forwardVecTo: vec3 = vec3.create();
    private lookAtPosTo: vec3 = vec3.create();
    private lookAtPosToTangentIn: vec3 = vec3.create();
    private lookAtPosToTangentOut: vec3 = vec3.create();
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

    public loadAnimation(loadObj: any) {
        let loadedKeyframes: Keyframe[];
        if (!loadObj.version && Array.isArray(loadObj))
            loadedKeyframes = this.deserializeVersion0(loadObj);
        else if (!loadObj.keyframes || !Array.isArray(loadObj.keyframes) || loadObj.keyframes.length === 0)
            return;
        else
            loadedKeyframes = loadObj.keyframes;

        this.animation = new CameraAnimation();
        this.animation.keyframes = loadedKeyframes;
        this.uiKeyframeList.dispatchEvent(new Event('startPositionSet'));
        for (let i = 1; i < this.animation.keyframes.length; i++) {
            if (this.animation.keyframes[i].name === undefined)
                this.animation.keyframes[i].name = 'Keyframe ' + i;
            this.animation.totalKeyframesAdded = i;
            this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: i }));
        }
    }

    private deserializeVersion0(kfArray: any[]): Keyframe[] {
        const kfs: Keyframe[] = [];
        for (let i = 0; i < kfArray.length; i++) {
            const newKeyframe = this.decomposeKeyframeFromMat4(kfArray[i].endPos);
            newKeyframe.interpDuration = kfArray[i].interpDuration;
            newKeyframe.holdDuration = kfArray[i].holdDuration;
            newKeyframe.usesLinearInterp = kfArray[i].usesLinearInterp;
            newKeyframe.linearEaseType = kfArray[i].linearEaseType as LinearEaseType;
            if (kfArray[i].name)
                newKeyframe.name = kfArray[i].name;
            kfs.push(newKeyframe);
        }
        return kfs;
    }

    public newAnimation() {
        this.animation = new CameraAnimation();
    }

    public serializeAnimation(): string {
        const dataObj = { version: 1, keyframes: this.animation.keyframes };
        return JSON.stringify(dataObj);
    }

    public getKeyframeByIndex(index: number): Keyframe {
        this.studioCameraController.setToPosition(this.getStepFromKeyframe(this.animation.keyframes[index]));
        return this.animation.keyframes[index];
    }

    public addNextKeyframe(pos: mat4) {
        const afterIndex: number = parseInt(this.uiKeyframeList.dataset.selectedIndex as string);
        if (this.uiKeyframeList.dataset.editingKeyframePosition) {
            this.editKeyframePosition(pos, afterIndex);
            return;
        }
        const kf = this.decomposeKeyframeFromMat4(pos);
        if (afterIndex > -1) {
            // Insert new keyframe after the specified index.
            this.animation.insertKeyframe(afterIndex, kf);
            this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: afterIndex + 1 }));
        } else {
            // No keyframe selected
            if (this.animation.keyframes.length === 0) {
                this.animation.appendKeyframe(kf);
                this.animation.keyframes[0].interpDuration = 0;
                this.uiKeyframeList.dispatchEvent(new Event('startPositionSet'));
            } else {
                this.animation.appendKeyframe(kf);
                this.uiKeyframeList.dispatchEvent(new CustomEvent('newKeyframe', { detail: this.animation.keyframes.length - 1 }));
            }
        }
    }

    public editKeyframePosition(pos: mat4, index: number) {
        if (index >= 0 && index < this.animation.keyframes.length) {
            const kf = this.decomposeKeyframeFromMat4(pos);
            this.animation.keyframes[index].targetPositionX = kf.targetPositionX;
            this.animation.keyframes[index].targetPositionY = kf.targetPositionY;
            this.animation.keyframes[index].targetPositionZ = kf.targetPositionZ;
            this.animation.keyframes[index].lookAtPositionX = kf.lookAtPositionX;
            this.animation.keyframes[index].lookAtPositionY = kf.lookAtPositionY;
            this.animation.keyframes[index].lookAtPositionZ = kf.lookAtPositionZ;
            this.animation.keyframes[index].bank = kf.bank;
        }
        this.endEditKeyframePosition();
    }

    public endEditKeyframePosition() {
        this.uiKeyframeList.dispatchEvent(new Event('keyframePositionEdited'));
    }

    public removeKeyframe(toRemove: number) {
        this.animation.removeKeyframe(toRemove);
    }

    public previewKeyframe(index: number, loop: boolean) {
        if (index < 0)
            return;
        this.prepareAnimation(index, loop);
        this.previewingKeyframe = true;
        this.studioCameraController.playAnimation(this.getStepFromKeyframe(this.currentKeyframe));
    }

    public playAnimation(loop: boolean) {
        if (this.animation.keyframes.length > 1) {
            this.prepareAnimation(0, loop);
            // Skip interpolation for the first keyframe.
            this.currentKeyframeProgressMs = this.currentKeyframeInterpDurationMs;
            this.studioCameraController.playAnimation(this.getStepFromKeyframe(this.currentKeyframe));
        }
    }

    private prepareAnimation(startIndex: number, loop: boolean) {
        this.currentKeyframeIndex = startIndex;
        this.loopAnimation = loop;
        this.calculateAllTangents();
        this.setKeyframeVars();
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
     * object with the translation, lookAt focus point, and bank rotation of the next
     * animation frame.
     * 
     * @param outInterpStep the next interpolation step of the animation
     */
    public playbackInterpolationStep(outInterpStep: InterpolationStep) {
        let interpAmount = this.currentKeyframeProgressMs / this.currentKeyframeInterpDurationMs;
        if (this.currentKeyframe.usesLinearInterp) {
            const easeFunc = this.getEasingFuncForEaseType(this.currentKeyframe.linearEaseType);
            if (easeFunc)
                interpAmount = easeFunc(interpAmount);
            vec3.lerp(outInterpStep.pos, this.targetPosFrom, this.targetPosTo, interpAmount);
            vec3.lerp(outInterpStep.lookAtPos, this.lookAtPosFrom, this.lookAtPosTo, interpAmount);
            outInterpStep.bank = lerp(this.bankRotFrom, this.bankRotTo, interpAmount);
        } else {
            for (let i = 0; i < 3; i++) {
                if (this.interpPos)
                    outInterpStep.pos[i] = getPointHermite(this.targetPosFrom[i], this.targetPosTo[i], this.targetPosToTangentIn[i], this.targetPosToTangentOut[i], interpAmount);
                else
                    outInterpStep.pos[i] = this.targetPosTo[i];
                outInterpStep.lookAtPos[i] = getPointHermite(this.lookAtPosFrom[i], this.lookAtPosTo[i], this.lookAtPosToTangentIn[i], this.lookAtPosToTangentOut[i], interpAmount);
            }
            if (this.interpBank)
                outInterpStep.bank = getPointHermite(this.bankRotFrom, this.bankRotTo, this.currentKeyframe.bank.tangentIn, this.currentKeyframe.bank.tangentOut, interpAmount);
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

    public playbackAdvanceKeyframe() {
        if (this.currentKeyframeIndex + 1 === this.animation.keyframes.length) {
            if (this.loopAnimation)
                this.currentKeyframeIndex = 0;
            else
                return;
        } else {
            this.currentKeyframeIndex++;
        }
        this.setKeyframeVars();
    }

    private setKeyframeVars() {
        this.currentKeyframe = this.animation.keyframes[this.currentKeyframeIndex];
        this.currentKeyframeProgressMs = 0 + this.pastDurationMs;
        this.pastDurationMs = 0;
        this.currentKeyframeInterpDurationMs = this.currentKeyframe.interpDuration * MILLISECONDS_IN_SECOND;
        this.currentKeyframeTotalDurationMs = (this.currentKeyframe.interpDuration + this.currentKeyframe.holdDuration) * MILLISECONDS_IN_SECOND;
        if (this.currentKeyframe.interpDuration === 0) {
            this.studioCameraController.setToPosition(this.getStepFromKeyframe(this.currentKeyframe));
        } else {
            const prevKfIndex = this.currentKeyframeIndex === 0 ? this.animation.keyframes.length - 1 : this.currentKeyframeIndex - 1;
            this.setInterpolationVectors(this.animation.keyframes[prevKfIndex]);
        }
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
        vec3.set(this.prevPos, fromKeyframe.targetPositionX.value, fromKeyframe.targetPositionY.value, fromKeyframe.targetPositionZ.value);
        vec3.set(this.nextPos, toKeyframe.targetPositionX.value, toKeyframe.targetPositionY.value, toKeyframe.targetPositionZ.value);
        vec3.set(this.targetPosToTangentIn, toKeyframe.targetPositionX.tangentIn, toKeyframe.targetPositionY.tangentIn, toKeyframe.targetPositionZ.tangentIn);
        vec3.set(this.targetPosToTangentOut, toKeyframe.targetPositionX.tangentOut, toKeyframe.targetPositionY.tangentOut, toKeyframe.targetPositionZ.tangentOut);
        let length = 0;
        if (!vec3.exactEquals(this.prevPos, this.nextPos)) {
            vec3.copy(this.scratchVec1, this.prevPos);
            const numSteps = 10000;
            for (let i = 1; i <= numSteps; i++) {
                for (let j = 0; j < 3; j++) {
                    this.scratchVec2[j] = getPointHermite(this.prevPos[j], this.nextPos[j], this.targetPosToTangentIn[j], this.targetPosToTangentOut[j], i / numSteps);
                }
                length += vec3.distance(this.scratchVec1, this.scratchVec2);
                vec3.copy(this.scratchVec1, this.scratchVec2);
            }
        }
        return length;
    }

    public isAnimation(a: Object): boolean {
        return true;
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

    private decomposeKeyframeFromMat4(pos: mat4): Keyframe {
        mat4.getTranslation(this.scratchVec1, pos);
        getMatrixAxisZ(this.forwardVecTo, pos);
        vec3.normalize(this.forwardVecTo, this.forwardVecTo);
        vec3.scaleAndAdd(this.scratchVec2, this.scratchVec1, this.forwardVecTo, -100);

        const newKeyframe: Keyframe = {
            interpDuration: 5,
            holdDuration: 0,
            usesLinearInterp: false,
            linearEaseType: LinearEaseType.EaseBoth,
            targetPositionX: { value: this.scratchVec1[0], tangentIn: 0, tangentOut: 0 },
            targetPositionY: { value: this.scratchVec1[1], tangentIn: 0, tangentOut: 0 },
            targetPositionZ: { value: this.scratchVec1[2], tangentIn: 0, tangentOut: 0 },
            lookAtPositionX: { value: this.scratchVec2[0], tangentIn: 0, tangentOut: 0 },
            lookAtPositionY: { value: this.scratchVec2[1], tangentIn: 0, tangentOut: 0 },
            lookAtPositionZ: { value: this.scratchVec2[2], tangentIn: 0, tangentOut: 0 },
            bank: { value: 0, tangentIn: 0, tangentOut: 0 },
            relativeBank: 0,
            name: undefined
        }

        computeEulerAngleRotationFromSRTMatrix(this.scratchVec1, pos);
        vec3.copy(this.scratchVec2, Vec3UnitY);
        vec3.rotateZ(this.scratchVec2, this.scratchVec2, Vec3Zero, -this.scratchVec1[2]);
        vec3.rotateY(this.scratchVec2, this.scratchVec2, Vec3Zero, -this.scratchVec1[1]);
        vec3.rotateX(this.scratchVec2, this.scratchVec2, Vec3Zero, -this.scratchVec1[0]);
        this.scratchVec2[2] = 0;
        vec3.normalize(this.scratchVec2, this.scratchVec2);
        newKeyframe.bank.value = vec3.angle(this.scratchVec2, Vec3UnitY);
        if (this.scratchVec2[0] < 0) {
            newKeyframe.bank.value *= -1;
        }

        return newKeyframe;
    }

    private setInterpolationVectors(prevKf: Keyframe) {
        vec3.set(this.targetPosFrom, prevKf.targetPositionX.value, prevKf.targetPositionY.value, prevKf.targetPositionZ.value);
        vec3.set(this.lookAtPosFrom, prevKf.lookAtPositionX.value, prevKf.lookAtPositionY.value, prevKf.lookAtPositionZ.value);

        vec3.set(this.targetPosTo, this.currentKeyframe.targetPositionX.value, this.currentKeyframe.targetPositionY.value, this.currentKeyframe.targetPositionZ.value);
        vec3.set(this.targetPosToTangentIn, this.currentKeyframe.targetPositionX.tangentIn, this.currentKeyframe.targetPositionY.tangentIn, this.currentKeyframe.targetPositionZ.tangentIn);
        vec3.set(this.targetPosToTangentOut, this.currentKeyframe.targetPositionX.tangentOut, this.currentKeyframe.targetPositionY.tangentOut, this.currentKeyframe.targetPositionZ.tangentOut);
        vec3.set(this.lookAtPosTo, this.currentKeyframe.lookAtPositionX.value, this.currentKeyframe.lookAtPositionY.value, this.currentKeyframe.lookAtPositionZ.value);
        vec3.set(this.lookAtPosToTangentIn, this.currentKeyframe.lookAtPositionX.tangentIn, this.currentKeyframe.lookAtPositionY.tangentIn, this.currentKeyframe.lookAtPositionZ.tangentIn);
        vec3.set(this.lookAtPosToTangentOut, this.currentKeyframe.lookAtPositionX.tangentOut, this.currentKeyframe.lookAtPositionY.tangentOut, this.currentKeyframe.lookAtPositionZ.tangentOut);

        this.interpPos = !vec3.exactEquals(this.targetPosFrom, this.targetPosTo);

        this.bankRotFrom = prevKf.relativeBank;
        this.bankRotTo = this.currentKeyframe.relativeBank;

        if (this.loopAnimation
            && this.currentKeyframeIndex === 0
            && Math.abs(this.bankRotTo - this.bankRotFrom) > Math.PI) {
            if (this.bankRotFrom > 0)
                this.bankRotFrom %= Math.PI;
            else
                this.bankRotFrom %= -Math.PI;

            let prevBank = this.animation.keyframes[this.animation.keyframes.length - 2].relativeBank;
            if (prevBank > 0)
                prevBank %= Math.PI;
            else
                prevBank %= -Math.PI

            this.currentKeyframe.bank.tangentIn = (this.bankRotTo - prevBank) * this.scaleFactor;
            this.currentKeyframe.bank.tangentOut = (this.bankRotTo - prevBank) * this.scaleFactor;
        }
        this.interpBank = Math.round(this.bankRotFrom * 1000000) != Math.round(this.bankRotTo * 1000000);
    }

    private calculateRelativeBankRotationValues() {
        let previousBank = 0;
        let fullRotations = 0;
        let kf: Keyframe;
        for (let i = 0; i < this.animation.keyframes.length; i++) {
            kf = this.animation.keyframes[i];
            kf.relativeBank = kf.bank.value;
            kf.relativeBank += fullRotations * (2 * Math.PI);

            if (Math.abs(kf.relativeBank - previousBank) > Math.PI) {
                // Closest rotation is in same direction, add or subtract a full rotation to the new bank
                if (previousBank < 0)
                    kf.relativeBank -= 2 * Math.PI;
                else
                    kf.relativeBank += 2 * Math.PI;
            }

            if (kf.relativeBank > 0) {
                fullRotations = Math.floor(kf.relativeBank / (2 * Math.PI));
            } else {
                fullRotations = Math.ceil(kf.relativeBank / (2 * Math.PI));
            }
            previousBank = kf.relativeBank;
        }
    }

    /**
     * Called before playing or previewing an animation, calculates and assigns tangent values for hermite interpolation.
     */
    private calculateAllTangents(): void {
        this.calculateRelativeBankRotationValues();
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
        if (curKf.interpDuration === 0) {
            this.zeroTangents(curKf, nextKf);
            return;
        }

        // Speed scales calculated as per Nils Pipenbrinck:
        // https://www.cubic.org/docs/hermite.htm - section "Speed Control".
        const outScale =  (2 * curKf.interpDuration) / (curKf.interpDuration + nextKf.interpDuration);
        const inScale = (2 * nextKf.interpDuration) / (curKf.interpDuration + nextKf.interpDuration);

        vec3.set(this.prevPos, prevKf.targetPositionX.value, prevKf.targetPositionY.value, prevKf.targetPositionZ.value);
        vec3.set(this.nextPos, nextKf.targetPositionX.value, nextKf.targetPositionY.value, nextKf.targetPositionZ.value);
        vec3.sub(this.scratchVec1, this.nextPos, this.prevPos);
        vec3.scale(this.scratchVec1, this.scratchVec1, this.scaleFactor);
        vec3.copy(this.scratchVec2, this.scratchVec1);
        vec3.scale(this.scratchVec1, this.scratchVec1, outScale);
        vec3.scale(this.scratchVec2, this.scratchVec2, inScale);
        curKf.targetPositionX.tangentOut = this.scratchVec1[0];
        curKf.targetPositionY.tangentOut = this.scratchVec1[1];
        curKf.targetPositionZ.tangentOut = this.scratchVec1[2];
        nextKf.targetPositionX.tangentIn = this.scratchVec2[0];
        nextKf.targetPositionY.tangentIn = this.scratchVec2[1];
        nextKf.targetPositionZ.tangentIn = this.scratchVec2[2];

        vec3.set(this.prevLookAtPos, prevKf.lookAtPositionX.value, prevKf.lookAtPositionY.value, prevKf.lookAtPositionZ.value);
        vec3.set(this.nextLookAtPos, nextKf.lookAtPositionX.value, nextKf.lookAtPositionY.value, nextKf.lookAtPositionZ.value);
        vec3.sub(this.scratchVec1, this.nextLookAtPos, this.prevLookAtPos);
        vec3.scale(this.scratchVec1, this.scratchVec1, this.scaleFactor);
        vec3.copy(this.scratchVec2, this.scratchVec1);
        vec3.scale(this.scratchVec1, this.scratchVec1, outScale);
        vec3.scale(this.scratchVec2, this.scratchVec2, inScale);
        curKf.lookAtPositionX.tangentOut = this.scratchVec1[0];
        curKf.lookAtPositionY.tangentOut = this.scratchVec1[1];
        curKf.lookAtPositionZ.tangentOut = this.scratchVec1[2];
        nextKf.lookAtPositionX.tangentIn = this.scratchVec2[0];
        nextKf.lookAtPositionY.tangentIn = this.scratchVec2[1];
        nextKf.lookAtPositionZ.tangentIn = this.scratchVec2[2];

        curKf.bank.tangentOut = (nextKf.relativeBank - prevKf.relativeBank) * this.scaleFactor * outScale;
        nextKf.bank.tangentIn = (nextKf.relativeBank - prevKf.relativeBank) * this.scaleFactor * inScale;
    }

    private zeroEndpointTangents(): void {
        this.zeroTangents(this.animation.keyframes[this.animation.keyframes.length - 1], this.animation.keyframes[0]);
    }

    private zeroTangents(fromKf: Keyframe, toKf: Keyframe) {
        fromKf.targetPositionX.tangentOut = 0;
        fromKf.targetPositionY.tangentOut = 0;
        fromKf.targetPositionZ.tangentOut = 0;
        fromKf.lookAtPositionX.tangentOut = 0;
        fromKf.lookAtPositionY.tangentOut = 0;
        fromKf.lookAtPositionZ.tangentOut = 0;
        fromKf.bank.tangentOut = 0;
        toKf.targetPositionX.tangentIn = 0;
        toKf.targetPositionY.tangentIn = 0;
        toKf.targetPositionZ.tangentIn = 0;
        toKf.lookAtPositionX.tangentIn = 0;
        toKf.lookAtPositionY.tangentIn = 0;
        toKf.lookAtPositionZ.tangentIn = 0;
        toKf.bank.tangentIn = 0;
    }

    private getStepFromKeyframe(kf: Keyframe): InterpolationStep {
        const step = new InterpolationStep();
        vec3.set(step.pos, kf.targetPositionX.value, kf.targetPositionY.value, kf.targetPositionZ.value);
        vec3.set(step.lookAtPos, kf.lookAtPositionX.value, kf.lookAtPositionY.value, kf.lookAtPositionZ.value);
        step.bank = kf.bank.value;
        return step;
    }
}
