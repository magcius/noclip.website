import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgRefs } from "./debug";
import { PandaNode } from "./PandaNode";
import { PartBundle } from "./PartBundle";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
} from "./TypedObject";

export class PartBundleNode extends PandaNode {
  public partBundles: PartBundle[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    let numBundles = 1;
    // In BAM 6.5+, there can be multiple bundles
    if (this._version.compare(new AssetVersion(6, 5)) >= 0) {
      numBundles = data.readUint16();
    }
    this.partBundles = readTypedRefs(file, data, numBundles, PartBundle);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.partBundles = ctx.cloneArray(this.partBundles);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("partBundles", dbgRefs(this.partBundles));
    return info;
  }
}

registerTypedObject("PartBundleNode", PartBundleNode);
