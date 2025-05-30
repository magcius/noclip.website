import { lerp, saturate } from "../MathHelpers";
import { getPointHermite } from "../Spline";
import { SCX } from "./scx/types";

type Interpolation = (toKey: SCX.Keyframe, fromKey: SCX.Keyframe, time: number) => number;

export type ChannelAnimation = {
    update: (delta: number, loop: boolean) => void;
    reset: () => void;
};

export class Animation {
    static interpolations: Record<SCX.Interpolation, Interpolation> = {
        [SCX.Interpolation.Linear]: (toKey, fromKey, time) => {
            return lerp(fromKey.value, toKey.value, time)
        },
        [SCX.Interpolation.Hermite]: (toKey, fromKey, time) => {
            return getPointHermite(fromKey.value, toKey.value, fromKey.tangentOut, toKey.tangentIn, time);
        },
    } as const;

    static channelModifiers: Record<SCX.KeyframeAnimationChannel, (transform: SCX.Transform, value: number) => void> = {
        [SCX.KeyframeAnimationChannel.TransX]: (transform, value) => (transform.trans[0] = value),
        [SCX.KeyframeAnimationChannel.TransY]: (transform, value) => (transform.trans[1] = value),
        [SCX.KeyframeAnimationChannel.TransZ]: (transform, value) => (transform.trans[2] = value),
        [SCX.KeyframeAnimationChannel.RotX]: (transform, value) => (transform.rot[0] = value),
        [SCX.KeyframeAnimationChannel.RotY]: (transform, value) => (transform.rot[1] = value),
        [SCX.KeyframeAnimationChannel.RotZ]: (transform, value) => (transform.rot[2] = value),
        [SCX.KeyframeAnimationChannel.ScaleX]: (transform, value) => (transform.scale[0] = value),
        [SCX.KeyframeAnimationChannel.ScaleY]: (transform, value) => (transform.scale[1] = value),
        [SCX.KeyframeAnimationChannel.ScaleZ]: (transform, value) => (transform.scale[2] = value),
    } as const;

    public static build = (transform: SCX.Transform, animations: SCX.KeyframeAnimation[]): ChannelAnimation[] => {
        animations = animations.filter(({ channel }) => Animation.channelModifiers[channel] !== null);
        
        let fullAnimDuration = 0;
        for (const anim of animations) {
            for (const keyframe of anim.keyframes) {
                fullAnimDuration = Math.max(fullAnimDuration, keyframe.time / 1000);
            }
        }
        
        return animations.map((animation) => {
            const channelModifier = Animation.channelModifiers[animation.channel];
            const interpolation = Animation.interpolations[animation.interp];
            const times = animation.keyframes.map(({ time }) => time / 1000);
            const animDuration = times.at(-1)!;
            const keyframes = animation.keyframes;
            let now = 0;

            const update = (delta: number, loop: boolean) => {
                if (delta <= 0) {
                    return;
                }

                now += delta;
                if (loop) {
                    now %= fullAnimDuration;
                }

                const index = times.findIndex((time) => time > now);
                const [toKey, fromKey] = [keyframes.at(index)!, keyframes.at(index - 1)!];
                const [toTime, fromTime] = [times.at(index)!, times.at(index - 1)! + (index === 0 ? -animDuration : 0)];
                const tweenDuration = toTime - fromTime;
                const currentValue = interpolation(toKey, fromKey, saturate((now - fromTime) / tweenDuration));
                channelModifier(transform, currentValue);
            };

            const reset = () => (now = 0);

            return { update, reset };
        });
    };
}
