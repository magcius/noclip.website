import { mat4 } from "gl-matrix";
import type { AnimControl } from "../anim/AnimControl";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { AnimChannelBase } from "./AnimChannelBase";
import { type DebugInfo, dbgMat4 } from "./debug";
import { MovingPartBase } from "./MovingPartBase";
import type { PartBundle } from "./PartBundle";
import { type CopyContext, registerTypedObject } from "./TypedObject";

/**
 * Animated matrix part
 */
export class MovingPartMatrix extends MovingPartBase<mat4> {
  public value = mat4.create();
  public initialValue = mat4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.value = data.readMat4();
    this.initialValue = data.readMat4();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    mat4.copy(target.value, this.value);
    mat4.copy(target.initialValue, this.initialValue);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgMat4(this.value));
    info.set("initialValue", dbgMat4(this.initialValue));
    return info;
  }

  override getBlendValue(root: PartBundle): void {
    if (this.forcedChannel) {
      this.forcedChannel.getValue(this.value, 0);
    }

    const effectiveChannels: [AnimControl, AnimChannelBase<mat4>][] = [];
    for (const control of root.blend.keys()) {
      const channel = this._channels[control.channelIndex];
      if (channel) {
        effectiveChannels.push([control, channel]);
      }
    }
    if (effectiveChannels.length === 0) {
      mat4.copy(this.value, this.initialValue);
    } else {
      if (effectiveChannels.length > 1 || root.frameBlendFlag) {
        throw new Error("Blended channels are not yet supported");
      }
      const [control, channel] = effectiveChannels[0];
      channel.getValue(this.value, control.frame);
    }
  }
}

registerTypedObject("MovingPartMatrix", MovingPartMatrix);
