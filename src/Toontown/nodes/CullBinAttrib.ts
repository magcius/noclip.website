import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgNum, dbgStr } from "./debug";
import { RenderAttrib } from "./RenderState";

export class CullBinAttrib extends RenderAttrib {
  public binName = "";
  public drawOrder = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.binName = data.readString();
    this.drawOrder = data.readInt32();
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.binName = this.binName;
    target.drawOrder = this.drawOrder;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("binName", dbgStr(this.binName));
    info.set("drawOrder", dbgNum(this.drawOrder));
    return info;
  }
}

registerBAMObject("CullBinAttrib", CullBinAttrib);
