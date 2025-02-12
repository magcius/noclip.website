import { SCX } from "./scx/types.js";
import { Transform } from "./types.js";

type Interpolation = (toKey: SCX.Keyframe, fromKey: SCX.Keyframe, now: number, duration: number) => number;

const interpolations: Record<string, Interpolation> = {
  "linear": (toKey, fromKey, now, duration) => {
    const percent = now / duration;
    return toKey.value * percent + fromKey.value * (1 - percent);
  },
  "hermite": (toKey, fromKey, now, duration) => {
    const p1 = now / duration;
    const p2 = p1 ** 2;
    const p3 = p1 ** 3;

    const [r1, r2, r3, r4] = [
      +(2 * p3 - 3 * p2) + 1,
      -(2 * p3 - 3 * p2),
       (p3 - p2) - p2 + p1,
       (p3 - p2),
    ];

    return (
      r1 * fromKey.value +
      r2 * toKey.value +
      r3 * (fromKey.tangentOut ?? 0) +
      r4 * (toKey.tangentIn ?? 0)
    );
  }
};

const channelModifiers: Record<SCX.KeyframeAnimationChannel, (transform: Transform, value: number) => void> = {
  xtrans: (transform, value) => transform.trans[0] = value,
  ytrans: (transform, value) => transform.trans[1] = value,
  ztrans: (transform, value) => transform.trans[2] = value,
  xrot: (transform, value) => transform.rot[0] = value,
  yrot: (transform, value) => transform.rot[1] = value,
  zrot: (transform, value) => transform.rot[2] = value,
  xscale: (transform, value) => transform.scale[0] = value,
  yscale: (transform, value) => transform.scale[1] = value,
  zscale: (transform, value) => transform.scale[2] = value
};

export type ChannelAnimation = (delta: number) => void;

export const buildNodeAnimations = (transform: Transform, animations: SCX.KeyframeAnimation[]): ChannelAnimation[] => 
  animations
    .filter(({channel}) => channelModifiers[channel] != null)
    .map(animation => {
      const channelModifier = channelModifiers[animation.channel]!;
      const interpolation = interpolations[animation.interp] ?? interpolations.linear;
      const times = animation.keyframes.map(({time}) => time / 1000);
      const animDuration = times.at(-1)!;
      const keyframes = animation.keyframes;
      let now = 0;

      return (delta: number) => {
        if (delta <= 0) {
          return;
        }
        now = (now + delta) % animDuration;
        const index = times.findIndex(time => time > now);
        const [toKey, fromKey] = [keyframes.at(index)!, keyframes.at(index - 1)!];
        const [toTime, fromTime] = [times.at(index)!, times.at(index - 1)! + (index === 0 ? -animDuration : 0)];
        const tweenDuration = toTime - fromTime;
        const currentValue = interpolation(toKey, fromKey, now - fromTime, tweenDuration);
        channelModifier(transform, currentValue);
      }
    });