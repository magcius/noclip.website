import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";
import { PandaNode } from "./PandaNode";

export class ModelNode extends PandaNode {
  public preserveTransform = 0;
  public preserveAttributes = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    if (this._version.compare(new AssetVersion(3, 2)) >= 0) {
      this.preserveTransform = data.readUint8();
    }
    if (this._version.compare(new AssetVersion(5, 3)) >= 0) {
      this.preserveAttributes = data.readUint16();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.preserveTransform = this.preserveTransform;
    target.preserveAttributes = this.preserveAttributes;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(3, 2)) >= 0) {
      info.set("preserveTransform", dbgNum(this.preserveTransform));
    }
    if (this._version.compare(new AssetVersion(5, 3)) >= 0) {
      info.set("preserveAttributes", dbgNum(this.preserveAttributes));
    }
    return info;
  }
}

export class ModelRoot extends ModelNode {}

registerBAMObject("ModelNode", ModelNode);
registerBAMObject("ModelRoot", ModelRoot);
