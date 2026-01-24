import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgNum } from "./debug";
import { PandaNode } from "./PandaNode";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export enum PreserveTransform {
  None,
  Local,
  Net,
  DropNode,
  NoTouch,
}

export class ModelNode extends PandaNode {
  public preserveTransform = PreserveTransform.None;
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

  static override create(name: string): ModelNode {
    const node = new ModelNode();
    node.name = name;
    return node;
  }
}

registerTypedObject("ModelNode", ModelNode);
