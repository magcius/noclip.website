import { mat4, vec3 } from "gl-matrix";
import { invlerp, lerp, MathConstants, smoothstep } from "../MathHelpers";
import { assert } from "../util";
import * as SD from "./Stagedef";

function searchKeyframes(timeSeconds: number, keyframes: SD.Keyframe[]): number {
    assert(keyframes.length > 0);

    if (timeSeconds < keyframes[0].timeSeconds) {
        return 0;
    }
    if (timeSeconds >= keyframes[keyframes.length - 1].timeSeconds) {
        return keyframes.length - 1;
    }

    let start = 0;
    let end = keyframes.length;
    while (end > start) {
        const mid = Math.floor((end - start) / 2) + start;
        if (timeSeconds < keyframes[mid].timeSeconds) {
            end = mid;
        } else {
            start = mid + 1;
        }
    }
    return start;
}

export function interpolateKeyframes(timeSeconds: number, keyframes: SD.Keyframe[]): number {
    if (keyframes.length === 0) {
        throw new Error("Cannot interpolate empty keyframe list");
    }
    if (timeSeconds <= keyframes[0].timeSeconds) {
        return keyframes[0].value;
    }
    if (timeSeconds >= keyframes[keyframes.length - 1].timeSeconds) {
        return keyframes[keyframes.length - 1].value;
    }

    const nextIdx = searchKeyframes(timeSeconds, keyframes);
    if (nextIdx === 0) {
        return keyframes[nextIdx].value;
    }
    const prev = keyframes[nextIdx - 1];
    const next = keyframes[nextIdx];
    if (prev.easeType === SD.EaseType.Constant) {
        return prev.value;
    }
    const t = invlerp(prev.timeSeconds, next.timeSeconds, timeSeconds);
    if (prev.easeType === SD.EaseType.Linear) {
        return lerp(prev.value, next.value, t);
    }
    // Any other ease value means smoothstep
    const deltaSeconds = next.timeSeconds - prev.timeSeconds;
    const baseValue = lerp(prev.value, next.value, smoothstep(t));
    const t2 = t * t;
    const t3 = t2 * t;
    const inAdjust = next.tangentIn * (t3 - t2);
    const outAdjust = prev.tangentOut * (t + (t3 - 2 * t2));
    return baseValue + deltaSeconds * (inAdjust + outAdjust);
}

export function loopWrap(timeSeconds: number, loopStartSeconds: number, loopEndSeconds: number): number {
    const loopDuration = loopEndSeconds - loopStartSeconds;
    // Game does this but adding loop start time just seems weird...
    return ((timeSeconds + loopStartSeconds) % loopDuration) + loopStartSeconds;
}
