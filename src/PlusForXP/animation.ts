import { SCX } from "./scx/types";

type Interpolation = (toKey: SCX.Keyframe, fromKey: SCX.Keyframe, now: number, duration: number) => number;

export type ChannelAnimation = {
    update: (delta: number, loop: boolean) => void;
    reset: () => void;
};

export class Animation {
    static interpolations: Record<SCX.Interpolation, Interpolation> = {
        [SCX.Interpolation.Linear]: (toKey, fromKey, now, duration) => {
            const percent = Math.max(0, Math.min(1, now / duration));
            return toKey.value * percent + fromKey.value * (1 - percent);
        },
        [SCX.Interpolation.Hermite]: (toKey, fromKey, now, duration) => {
            const p1 = Math.max(0, Math.min(1, now / duration));
            const p2 = p1 ** 2;
            const p3 = p1 ** 3;

            const [r1, r2, r3, r4] = [+(2 * p3 - 3 * p2) + 1, -(2 * p3 - 3 * p2), p3 - p2 - p2 + p1, p3 - p2];

            return r1 * fromKey.value + r2 * toKey.value + r3 * fromKey.tangentOut + r4 * toKey.tangentIn;
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
        const builder = new Animation();
        animations = animations.filter(({ channel }) => Animation.channelModifiers[channel] !== null);
        const durations = new Set<number>();
        for (const anim of animations) {
            for (const keyframe of anim.keyframes) {
                durations.add(keyframe.time / 1000);
            }
        }
        const fullAnimDuration = Math.max(...durations);
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
                const currentValue = interpolation(toKey, fromKey, now - fromTime, tweenDuration);
                channelModifier(transform, currentValue);
            };

            const reset = () => (now = 0);

            return { update, reset };
        });
    };
}
