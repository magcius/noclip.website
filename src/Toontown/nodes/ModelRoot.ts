import { BAMFile } from "../bam";
import { AssetVersion, DataStream } from "../common";
import { registerBAMObject } from "./base";
import { dbgNum, DebugInfo } from "./debug";
import { ModelNode } from "./ModelNode";

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

registerBAMObject("ModelRoot", ModelRoot);
