import { vec3 } from 'gl-matrix';
import { getPointHermite } from './Spline';

export class InterpolationStep {
    pos: vec3 = vec3.create();
    lookAtPos: vec3 = vec3.create();
    bank: number = 0;
}

export interface Keyframe {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

export class KeyframeTrack {
    constructor(public keyframes: Keyframe[]) {

    }

    /**
     * Adds a new keyframe to this keyframe track. If the keyframe to be added is at the same time as an existing keyframe, the existing keyframe will be overwritten.
     * 
     * @param kf The Keyframe to add
     */
    public addKeyframe(kf: Keyframe) {
        const nextKfIndex = this.getNextKeyframeIndexAtTime(kf.time);
        if (nextKfIndex === -1)
            this.keyframes.push(kf);
        else if (this.keyframes[nextKfIndex].time === kf.time)
            this.keyframes.splice(nextKfIndex, 1, kf);
        else
            this.keyframes.splice(nextKfIndex - 1, 0, kf);
    }

    public getNextKeyframeIndexAtTime(t: number) {
        let nextKfIndex = -1;
        for (let i = this.keyframes.length - 1; i > -1; i--) {
            if (t <= this.keyframes[i].time) {
                nextKfIndex = i;
                break;
            }
        }
        return nextKfIndex;
    }

    public setAllCatmullRomTangents(speedScale: boolean, loop: boolean) {
        this.setCatmullRomTangent(speedScale, this.keyframes[0], this.keyframes[0], this.keyframes[1]);

        for (let i = 1; i < this.keyframes.length - 1; i++)
            this.setCatmullRomTangent(speedScale, this.keyframes[i - 1], this.keyframes[i], this.keyframes[i + 1]);

        if (loop) {
            this.setCatmullRomTangent(speedScale, this.keyframes[this.keyframes.length - 2], this.keyframes[this.keyframes.length - 1], this.keyframes[0]);
        } else {
            this.keyframes[this.keyframes.length - 1].tangentOut = 0;
            this.keyframes[0].tangentIn = 0;
        }
    };

    public setCatmullRomTangent(speedScale: boolean, previous: Keyframe, current: Keyframe, next: Keyframe) {
        let val = (next.value - previous.value) * 0.5;
        if (speedScale) {
            const thisDuration = current.time - previous.time;
            const nextDuration = next.time - current.time;
            val *= (2 * thisDuration) / (thisDuration + nextDuration);
        }
        current.tangentOut = val;
        next.tangentIn = val;
    }

}

export interface CameraAnimation {
    posXTrack: KeyframeTrack;
    posYTrack: KeyframeTrack;
    posZTrack: KeyframeTrack;
    lookAtXTrack: KeyframeTrack;
    lookAtYTrack: KeyframeTrack;
    lookAtZTrack: KeyframeTrack;
    bankTrack: KeyframeTrack;
}

export class CameraAnimationManager {
    // The animation to play back.
    private animation: Readonly<CameraAnimation>;
    // A map to store and retrieve the current keyframe index for each animation track.
    private currentKeyframeIndices: Map<KeyframeTrack, number>;
    private elapsedTimeMs: number;
    private lastKeyframeTimeMs: number;
    private loopAnimation: boolean = false;

    public playAnimation(animation: Readonly<CameraAnimation>, loop: boolean, startTimeMs: number) {
        this.animation = animation;
        this.loopAnimation = loop;
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
    }

    public updateElapsedTime(dt: number): void {
        this.elapsedTimeMs += dt;
        if (this.loopAnimation && this.elapsedTimeMs >= this.lastKeyframeTimeMs) {
            this.currentKeyframeIndices.set(this.animation.posXTrack, 0);
            this.currentKeyframeIndices.set(this.animation.posYTrack, 0);
            this.currentKeyframeIndices.set(this.animation.posZTrack, 0);
            this.currentKeyframeIndices.set(this.animation.lookAtXTrack, 0);
            this.currentKeyframeIndices.set(this.animation.lookAtYTrack, 0);
            this.currentKeyframeIndices.set(this.animation.lookAtZTrack, 0);
            this.currentKeyframeIndices.set(this.animation.bankTrack, 0);
            const diff = this.elapsedTimeMs - this.lastKeyframeTimeMs;
            this.elapsedTimeMs = 0 + diff;
        }
    }

    public getAnimFrame(outInterpStep: InterpolationStep) {
        vec3.set(outInterpStep.pos, this.getCurrentTrackValue(this.animation.posXTrack), this.getCurrentTrackValue(this.animation.posYTrack), this.getCurrentTrackValue(this.animation.posZTrack));
        vec3.set(outInterpStep.lookAtPos, this.getCurrentTrackValue(this.animation.lookAtXTrack), this.getCurrentTrackValue(this.animation.lookAtYTrack), this.getCurrentTrackValue(this.animation.lookAtZTrack));
        outInterpStep.bank = this.getCurrentTrackValue(this.animation.bankTrack);

    }

    public getCurrentTrackValue(track: Readonly<KeyframeTrack>): number {
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
            }
        }
        const prevKf = track.keyframes[kfIndex - 1];
        const curKf = track.keyframes[kfIndex];
        if (prevKf.value === curKf.value)
            return curKf.value;

        return getPointHermite(prevKf.value, curKf.value, curKf.tangentIn, curKf.tangentOut, (this.elapsedTimeMs - prevKf.time) / (curKf.time - prevKf.time));
    }

    public isAnimationFinished(): boolean {
        return !this.loopAnimation && this.elapsedTimeMs >= this.lastKeyframeTimeMs;
    }

}
