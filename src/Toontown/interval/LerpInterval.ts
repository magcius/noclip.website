import { Interval } from "./Interval";

export enum BlendType {
  Linear,
  EaseIn,
  EaseOut,
  EaseInOut,
}

export class LerpInterval extends Interval {
  private _blendType: BlendType;

  constructor(name: string, duration: number, blendType: BlendType) {
    super(name, duration, true);
    this._blendType = blendType;
  }

  get blendType(): BlendType {
    return this._blendType;
  }

  protected computeDelta(t: number): number {
    const duration = this._duration;
    if (duration === 0.0) return 1.0;
    t /= duration;
    t = Math.min(Math.max(t, 0.0), 1.0);
    switch (this.blendType) {
      case BlendType.EaseIn: {
        const t2 = t * t;
        return (3.0 * t2 - t2 * t) * 0.5;
      }
      case BlendType.EaseOut: {
        const t2 = t * t;
        return (3.0 * t - t2 * t) * 0.5;
      }
      case BlendType.EaseInOut: {
        const t2 = t * t;
        return 3.0 * t2 - 2.0 * t * t2;
      }
      default:
        return t;
    }
  }
}
