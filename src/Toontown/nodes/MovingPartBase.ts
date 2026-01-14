import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { AnimChannelBase } from "./AnimChannelBase";
import { type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { PartGroup } from "./PartGroup";

/**
 * Base class for animated parts
 */
export class MovingPartBase extends PartGroup {
  public forcedChannel: AnimChannelBase | null = null; // 6.20+

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    if (this._version.compare(new AssetVersion(6, 20)) >= 0) {
      this.forcedChannel = file.getTyped(data.readObjectId(), AnimChannelBase);
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
}

registerBAMObject("MovingPartBase", MovingPartBase);
