import { vec3 } from 'gl-matrix';
import { angleDist } from './MathHelpers';
import { getPointHermite } from './Spline';
import { CameraAnimation, KeyframeTrack, MILLISECONDS_IN_SECOND } from './Studio';

export const PREVIEW_STEP_TIME_MS = 16;

export class InterpolationStep {
    pos: vec3 = vec3.create();
    lookAtPos: vec3 = vec3.create();
    bank: number = 0;
}

export class CameraAnimationManager {
    // The animation to play back.
    private animation: Readonly<CameraAnimation>;
    // A map to store and retrieve the current keyframe index for each animation track.
    private currentKeyframeIndices: Map<KeyframeTrack, number>;
    private elapsedTimeMs: number;
    private lastKeyframeTimeMs: number;

    // Normalized bank rotation values, calculated at runtime to keep the logic of the animations simpler
    private bankFrom: number;
    private bankTo: number;

    public initAnimationPlayback(animation: Readonly<CameraAnimation>, startTimeMs: number) {
        this.animation = animation;
        this.elapsedTimeMs = startTimeMs;
        this.currentKeyframeIndices = new Map();
        this.currentKeyframeIndices.set(animation.posXTrack, animation.posXTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.currentKeyframeIndices.set(animation.posYTrack, animation.posYTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.currentKeyframeIndices.set(animation.posZTrack, animation.posZTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.currentKeyframeIndices.set(animation.lookAtXTrack, animation.lookAtXTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.currentKeyframeIndices.set(animation.lookAtYTrack, animation.lookAtYTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.currentKeyframeIndices.set(animation.lookAtZTrack, animation.lookAtZTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.currentKeyframeIndices.set(animation.bankTrack, animation.bankTrack.getNextKeyframeIndexAtTime(startTimeMs));
        this.lastKeyframeTimeMs = Math.max(animation.posXTrack.keyframes[animation.posXTrack.keyframes.length - 1].time,
            animation.posYTrack.keyframes[animation.posYTrack.keyframes.length - 1].time,
            animation.posZTrack.keyframes[animation.posZTrack.keyframes.length - 1].time,
            animation.lookAtXTrack.keyframes[animation.lookAtXTrack.keyframes.length - 1].time,
            animation.lookAtYTrack.keyframes[animation.lookAtYTrack.keyframes.length - 1].time,
            animation.lookAtZTrack.keyframes[animation.lookAtZTrack.keyframes.length - 1].time,
            animation.bankTrack.keyframes[animation.bankTrack.keyframes.length - 1].time);
        this.bankFrom = this.animation.bankTrack.keyframes[0].value;
        this.bankTo = this.bankFrom;
        const bankTrackStartIndex = this.currentKeyframeIndices.get(animation.bankTrack);
        for (let i = 1; bankTrackStartIndex && i <= bankTrackStartIndex; i++) {
            this.bankFrom = this.bankTo;
            this.bankTo = this.bankTo + angleDist(this.bankTo, this.animation.bankTrack.keyframes[i].value);
        }
    }

    public updateElapsedTime(dt: number): void {
        this.elapsedTimeMs += dt;
        if (this.animation.loop && this.elapsedTimeMs >= this.lastKeyframeTimeMs) {
            this.currentKeyframeIndices.set(this.animation.posXTrack, 0);
            this.currentKeyframeIndices.set(this.animation.posYTrack, 0);
            this.currentKeyframeIndices.set(this.animation.posZTrack, 0);
            this.currentKeyframeIndices.set(this.animation.lookAtXTrack, 0);
            this.currentKeyframeIndices.set(this.animation.lookAtYTrack, 0);
            this.currentKeyframeIndices.set(this.animation.lookAtZTrack, 0);
            this.currentKeyframeIndices.set(this.animation.bankTrack, 0);
            this.elapsedTimeMs -= this.lastKeyframeTimeMs;
        }
    }

    public getAnimFrame(outInterpStep: InterpolationStep) {
        vec3.set(outInterpStep.pos, this.getCurrentTrackValue(this.animation.posXTrack), this.getCurrentTrackValue(this.animation.posYTrack), this.getCurrentTrackValue(this.animation.posZTrack));
        vec3.set(outInterpStep.lookAtPos, this.getCurrentTrackValue(this.animation.lookAtXTrack), this.getCurrentTrackValue(this.animation.lookAtYTrack), this.getCurrentTrackValue(this.animation.lookAtZTrack));
        outInterpStep.bank = this.getCurrentTrackValue(this.animation.bankTrack);
    }

    public getPreviewSteps(animation: CameraAnimation): InterpolationStep[] {
        const steps: InterpolationStep[] = [];
        this.initAnimationPlayback(animation, 0);
        for (let t = 0; t <= this.lastKeyframeTimeMs; t += PREVIEW_STEP_TIME_MS) {
            const step = new InterpolationStep();
            this.getAnimFrame(step);
            steps.push(step);
            this.updateElapsedTime(PREVIEW_STEP_TIME_MS);
        }
        return steps;
    }

    public getCurrentTrackValue(track: KeyframeTrack): number {
        let kfIndex = this.currentKeyframeIndices.get(track);
        if (kfIndex === undefined || kfIndex === -1)
            return track.keyframes[track.keyframes.length - 1].value;
        else if (this.elapsedTimeMs >= track.keyframes[kfIndex].time) {
            if (kfIndex === track.keyframes.length - 1) {
                kfIndex = -1;
                this.currentKeyframeIndices.set(track, kfIndex);
                return track.keyframes[track.keyframes.length - 1].value;
            } else {
                kfIndex++;
                this.currentKeyframeIndices.set(track, kfIndex);
                if (track === this.animation.bankTrack) {
                    this.bankFrom = this.bankTo;
                    this.bankTo = this.bankTo + angleDist(this.bankTo, track.keyframes[kfIndex].value);
                }
            }
        }
        const prevKf = track.keyframes[kfIndex - 1];
        const curKf = track.keyframes[kfIndex];
        if (prevKf.value === curKf.value)
            return curKf.value;

        if (track !== this.animation.bankTrack) {
            return getPointHermite(prevKf.value, curKf.value, curKf.tangentIn, curKf.tangentOut, (this.elapsedTimeMs - prevKf.time) / (curKf.time - prevKf.time));
        } else {
            return getPointHermite(this.bankFrom, this.bankTo, curKf.tangentIn, curKf.tangentOut, (this.elapsedTimeMs - prevKf.time) / (curKf.time - prevKf.time));
        }
    }

    public isAnimationFinished(): boolean {
        return !this.animation.loop && this.elapsedTimeMs >= this.lastKeyframeTimeMs;
    }

    public getElapsedTimeSeconds(): number {
        return this.elapsedTimeMs / MILLISECONDS_IN_SECOND;
    }

}
