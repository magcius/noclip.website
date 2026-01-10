import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { readTypedRefs, registerBAMObject } from "./base";
import { type DebugInfo, dbgRefs } from "./debug";
import { PandaNode } from "./PandaNode";
import { PartBundle } from "./PartBundle";

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

  override copyTo(target: this): void {
    super.copyTo(target);
    target.partBundles = this.partBundles; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("partBundles", dbgRefs(this.partBundles));
    return info;
  }
}

registerBAMObject("PartBundleNode", PartBundleNode);
