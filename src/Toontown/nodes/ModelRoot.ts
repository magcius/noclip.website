import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import { type DebugInfo, dbgNum } from "./debug";
import { ModelNode } from "./ModelNode";
import { registerTypedObject } from "./TypedObject";

export class ModelRoot extends ModelNode {
  public typeHandle: number | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    if (this._version.compare(new AssetVersion(6, 46)) >= 0) {
      this.typeHandle = data.readTypeHandle();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this.typeHandle !== null) {
      info.set("typeHandle", dbgNum(this.typeHandle));
    }
    return info;
  }
}

registerTypedObject("ModelRoot", ModelRoot);
