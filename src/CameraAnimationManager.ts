import { vec3 } from 'gl-matrix';
import { getPointHermite } from './Spline';

const MILLISECONDS_IN_SECOND = 1000.0;

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

class KeyframeTrack {
    keyframes: Keyframe[];
    currentKeyframeIndex: number;

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

    private setCatmullRomTangent(speedScale: boolean, previous: Keyframe, current: Keyframe, next: Keyframe) {
        let val = (next.value - previous.value) * 0.5;
        if (speedScale) {
            const thisDuration = current.time - previous.time;
            const nextDuration = next.time - current.time;
            val *= (2 * thisDuration) / (thisDuration + nextDuration);
        }
        current.tangentOut = val;
        next.tangentIn = val;
    }

    // t is total time elapsed in milliseconds
    public getAnimFrameValue(t: number): number {
        while (t > this.keyframes[this.currentKeyframeIndex].time) {
            if (this.currentKeyframeIndex === this.keyframes.length - 1) {
                return this.keyframes[this.currentKeyframeIndex].value;
            }
            this.currentKeyframeIndex++;
        }
        const prevKf = this.keyframes[this.currentKeyframeIndex - 1];
        const curKf = this.keyframes[this.currentKeyframeIndex];
        return getPointHermite(prevKf.value, curKf.value, curKf.tangentIn, curKf.tangentOut, (t - prevKf.time) / (curKf.time - prevKf.time));
    }
}

export interface Timeline {
    posXTrack: KeyframeTrack;
    posYTrack: KeyframeTrack;
    posZTrack: KeyframeTrack;
    lookatXTrack: KeyframeTrack;
    lookatYTrack: KeyframeTrack;
    lookatZTrack: KeyframeTrack;
    bankTrack: KeyframeTrack;
}

export class CameraAnimation {
    public timeline: Timeline;
    public lengthMs: number = 30 * MILLISECONDS_IN_SECOND;

    public getAnimFrame(t: number, outInterpStep: InterpolationStep) {
        vec3.set(outInterpStep.pos, this.timeline.posXTrack.getAnimFrameValue(t), this.timeline.posYTrack.getAnimFrameValue(t), this.timeline.posZTrack.getAnimFrameValue(t));
        vec3.set(outInterpStep.lookAtPos, this.timeline.lookatXTrack.getAnimFrameValue(t), this.timeline.lookatYTrack.getAnimFrameValue(t), this.timeline.lookatZTrack.getAnimFrameValue(t));
        outInterpStep.bank = this.timeline.bankTrack.getAnimFrameValue(t);
    }
}

export class CameraAnimationManager {
    // The animation to play back.
    private animation: Readonly<CameraAnimation>;
    // Variables for animation playback.
    private elapsedTimeMs: number;
    private loopAnimation: boolean = false;

    public playAnimation(animation: CameraAnimation, loop: boolean, startTimeMs: number) {
        this.animation = animation;
        this.loopAnimation = loop;
        this.elapsedTimeMs = startTimeMs;
    }

    public updateElapsedTime(dt: number): void {
        this.elapsedTimeMs += dt;
    }

    public isAnimationFinished(): boolean {
        return this.elapsedTimeMs >= this.animation.lengthMs;
    }

}
