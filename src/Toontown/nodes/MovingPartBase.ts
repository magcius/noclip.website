import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { PartGroup } from "./PartGroup";

/**
 * Base class for animated parts
 */
export class MovingPartBase extends PartGroup {
  public forcedChannel: BAMObject | null = null; // 6.20+

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    if (this._version.compare(new AssetVersion(6, 20)) >= 0) {
      this.forcedChannel = file.getObject(data.readObjectId());
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.forcedChannel = this.forcedChannel; // Shared
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
