import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import { AnimChannelBase } from "./AnimChannelBase";
import type { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgRef } from "./debug";
import type { PartBundle } from "./PartBundle";
import { PartGroup } from "./PartGroup";
import type { CopyContext } from "./TypedObject";

/**
 * Base class for animated parts
 */
export abstract class MovingPartBase<T> extends PartGroup {
  public forcedChannel: AnimChannelBase<T> | null = null; // 6.20+

  protected _channels: (AnimChannelBase<T> | null)[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    if (this._version.compare(new AssetVersion(6, 20)) >= 0) {
      this.forcedChannel = file.getTyped(
        data.readObjectId(),
        AnimChannelBase<T>,
      );
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.forcedChannel = ctx.clone(this.forcedChannel);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 20)) >= 0) {
      info.set("forcedChannel", dbgRef(this.forcedChannel));
    }
    return info;
  }

  protected override bindHeirarchy(
    anim: AnimGroup | null,
    channelIndex: number,
  ): void {
    if (anim !== null && !(anim instanceof AnimChannelBase)) {
      throw new Error(`Invalid animation type for channel ${channelIndex}`);
    }
    this._channels[channelIndex] = anim;
    super.bindHeirarchy(anim, channelIndex);
  }

  abstract getBlendValue(root: PartBundle): void;

  override doUpdate(
    root: PartBundle,
    parent: PartGroup,
    parentChanged: boolean,
    animChanged: boolean,
  ): boolean {
    let anyChanged = false;
    let needsUpdate = animChanged;
    if (!needsUpdate) {
      if (this.forcedChannel) {
        needsUpdate = this.forcedChannel.hasChanged(0, 0, 0, 0);
      } else {
        for (const control of root.blend.keys()) {
          const channel = this._channels[control.channelIndex];
          if (channel) {
            needsUpdate = control.channelHasChanged(
              channel,
              root.frameBlendFlag,
            );
          }
        }
      }
    }
    if (needsUpdate) {
      this.getBlendValue(root);
    }
    if (parentChanged || needsUpdate) {
      anyChanged = this.updateInternals(
        root,
        parent,
        needsUpdate,
        parentChanged,
      );
    }
    for (const child of this.children) {
      if (child.doUpdate(root, this, anyChanged, needsUpdate)) {
        anyChanged = true;
      }
    }
    return anyChanged;
  }

  protected updateInternals(
    _root: PartBundle,
    _parent: PartGroup,
    _selfChanged: boolean,
    _parentChanged: boolean,
  ): boolean {
    return true;
  }
}
