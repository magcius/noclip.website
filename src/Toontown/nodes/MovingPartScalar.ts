import type { AnimControl } from "../anim/AnimControl";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { AnimChannelBase } from "./AnimChannelBase";
import { type DebugInfo, dbgNum } from "./debug";
import { MovingPartBase } from "./MovingPartBase";
import type { PartBundle } from "./PartBundle";
import { type CopyContext, registerTypedObject } from "./TypedObject";

/**
 * Animated scalar part
 */
export class MovingPartScalar extends MovingPartBase<number> {
  public value = 0;
  public initialValue = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.value = data.readFloat32();
    this.initialValue = data.readFloat32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.value = this.value;
    target.initialValue = this.initialValue;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgNum(this.value));
    info.set("initialValue", dbgNum(this.initialValue));
    return info;
  }

  override getBlendValue(root: PartBundle): void {
    if (this.forcedChannel) {
      this.forcedChannel.getValue(this.value, 0);
    }

    const effectiveChannels: [AnimControl, AnimChannelBase<number>][] = [];
    for (const control of root.blend.keys()) {
      const channel = this._channels[control.channelIndex];
      if (channel) {
        effectiveChannels.push([control, channel]);
      }
    }
    if (effectiveChannels.length === 0) {
      this.value = this.initialValue;
    } else {
      if (effectiveChannels.length > 1 || root.frameBlendFlag) {
        throw new Error("Blended channels are not yet supported");
      }
      const [control, channel] = effectiveChannels[0];
      this.value = channel.getValue(0, control.frame);
    }
  }
}

registerTypedObject("MovingPartScalar", MovingPartScalar);
