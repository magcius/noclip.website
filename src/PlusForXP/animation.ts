import { SCX } from "./scx/types.js";
import { Transform } from "./types.js";

type Interpolation = (toKey: SCX.Keyframe, fromKey: SCX.Keyframe, now: number, duration: number) => number;

export type ChannelAnimation = {
    update: (delta: number, loop: boolean) => void;
    reset: () => void;
};

export class AnimationBuilder {
    interpolations: Record<string, Interpolation> = {
        linear: (toKey, fromKey, now, duration) => {
            const percent = Math.max(0, Math.min(1, now / duration));
            return toKey.value * percent + fromKey.value * (1 - percent);
        },
        hermite: (toKey, fromKey, now, duration) => {
            const p1 = Math.max(0, Math.min(1, now / duration));
            const p2 = p1 ** 2;
            const p3 = p1 ** 3;

            const [r1, r2, r3, r4] = [+(2 * p3 - 3 * p2) + 1, -(2 * p3 - 3 * p2), p3 - p2 - p2 + p1, p3 - p2];

            return r1 * fromKey.value + r2 * toKey.value + r3 * (fromKey.tangentOut ?? 0) + r4 * (toKey.tangentIn ?? 0);
        },
    } as const;

    channelModifiers: Record<SCX.KeyframeAnimationChannel, (transform: Transform, value: number) => void> = {
        xtrans: (transform, value) => (transform.trans[0] = value),
        ytrans: (transform, value) => (transform.trans[1] = value),
        ztrans: (transform, value) => (transform.trans[2] = value),
        xrot: (transform, value) => (transform.rot[0] = value),
        yrot: (transform, value) => (transform.rot[1] = value),
        zrot: (transform, value) => (transform.rot[2] = value),
        xscale: (transform, value) => (transform.scale[0] = value),
        yscale: (transform, value) => (transform.scale[1] = value),
        zscale: (transform, value) => (transform.scale[2] = value),
    } as const;

    public build = (transform: Transform, animations: SCX.KeyframeAnimation[]): ChannelAnimation[] => {
        animations = animations.filter(({ channel }) => this.channelModifiers[channel] !== null);
        const fullAnimDuration = Math.max(...animations.flatMap((anim) => anim.keyframes).map((keyframe) => keyframe.time / 1000));
        return animations.map((animation) => {
            const channelModifier = this.channelModifiers[animation.channel]!;
            const interpolation = this.interpolations[animation.interp] ?? this.interpolations.linear;
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
