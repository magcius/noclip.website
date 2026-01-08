import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { PartGroup } from "./PartGroup";

/**
 * MovingPartBase - Base class for animated parts
 *
 * Extends PartGroup with forced channel support (6.20+).
 * Hierarchy: MovingPartBase -> PartGroup
 */
export class MovingPartBase extends PartGroup {
  // MovingPartBase fields (6.20+)
  public forcedChannelRef: number = 0;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // MovingPartBase::fillin - in BAM 6.20+, read forced_channel pointer
    if (this._version.compare(new AssetVersion(6, 20)) >= 0) {
      this.forcedChannelRef = data.readObjectId();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 20)) >= 0) {
      info.set("forcedChannelRef", dbgRef(this.forcedChannelRef));
    }
    return info;
  }
}

registerBAMObject("MovingPartBase", MovingPartBase);
