import { vec3 } from 'gl-matrix';
import { invlerp } from './MathHelpers';
import { getPointHermite } from './Spline';
import { CameraAnimation, KeyframeTrack, Keyframe, MILLISECONDS_IN_SECOND } from './Studio';

// TODO(jstpierre): Merge this file into Studio

export class InterpolationStep {
    pos: vec3 = vec3.create();
    lookAtPos: vec3 = vec3.create();
    bank: number = 0;
}

function findKeyframe(frames: Readonly<Keyframe[]>, time: number): number {
    for (let i = 0; i < frames.length; i++)
        if (time < frames[i].time)
            return i;
    return -1;
}

function calcTrackDuration(track: Readonly<KeyframeTrack>): number {
    // Assume it's sorted.
    if (track.keyframes.length > 0)
        return track.keyframes[track.keyframes.length - 1].time;
    else
        return 0;
}

function calcAnimationDuration(animation: Readonly<CameraAnimation>): number {
    let duration = 0;
    duration = Math.max(calcTrackDuration(animation.posXTrack));
    duration = Math.max(calcTrackDuration(animation.posYTrack));
    duration = Math.max(calcTrackDuration(animation.posZTrack));
    duration = Math.max(calcTrackDuration(animation.lookAtXTrack));
    duration = Math.max(calcTrackDuration(animation.lookAtYTrack));
    duration = Math.max(calcTrackDuration(animation.lookAtZTrack));
    duration = Math.max(calcTrackDuration(animation.bankTrack));
    return duration;
}

function getCurrentTrackValue(track: KeyframeTrack, time: number): number {
    const idx1 = findKeyframe(track.keyframes, time);
    if (idx1 === 0)
        return track.keyframes[0].value;
    if (idx1 < 0)
        return track.keyframes[track.keyframes.length - 1].value;

    const idx0 = idx1 - 1;
    const k0 = track.keyframes[idx0], k1 = track.keyframes[idx1];

    const t = invlerp(k0.time, k1.time, time);
    return getPointHermite(k0.value, k1.value, k0.tangentOut, k1.tangentIn, t);
}

function calcAnimationPose(dst: InterpolationStep, animation: Readonly<CameraAnimation>, time: number): void {
    const posX = getCurrentTrackValue(animation.posXTrack, time);
    const posY = getCurrentTrackValue(animation.posYTrack, time);
    const posZ = getCurrentTrackValue(animation.posZTrack, time);
    const lookAtX = getCurrentTrackValue(animation.lookAtXTrack, time);
    const lookAtY = getCurrentTrackValue(animation.lookAtYTrack, time);
    const lookAtZ = getCurrentTrackValue(animation.lookAtZTrack, time);
    vec3.set(dst.pos, posX, posY, posZ);
    vec3.set(dst.lookAtPos, lookAtX, lookAtY, lookAtZ);
    dst.bank = getCurrentTrackValue(animation.bankTrack, time);
}

export class CameraAnimationManager {
    // The animation to play back.
    private animation: Readonly<CameraAnimation>;
    // A map to store and retrieve the current keyframe index for each animation track.
    private elapsedTimeMs: number;

    // The animation's duration.
    public durationMs: number;

    public initAnimationPlayback(animation: Readonly<CameraAnimation>, startTimeMs: number) {
        this.animation = animation;
        this.elapsedTimeMs = startTimeMs;
        this.durationMs = calcAnimationDuration(animation);
    }

    public setElapsedTime(t: number): void {
        this.elapsedTimeMs = t;

        if (this.animation.loop)
            this.elapsedTimeMs = this.elapsedTimeMs % this.durationMs;
    }

    public updateElapsedTime(dt: number): void {
        this.setElapsedTime(this.elapsedTimeMs + dt);
    }

    public getAnimFrame(outInterpStep: InterpolationStep, time: number = this.elapsedTimeMs) {
        calcAnimationPose(outInterpStep, this.animation, time);
    }

    public isAnimationFinished(): boolean {
        return !this.animation.loop && this.elapsedTimeMs >= this.durationMs;
    }

    public getElapsedTimeSeconds(): number {
        return this.elapsedTimeMs / MILLISECONDS_IN_SECOND;
    }

}
