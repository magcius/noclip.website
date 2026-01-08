import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum, dbgStr } from "./debug";

export class CullBinAttrib extends BAMObject {
  public binName: string;
  public drawOrder: number;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.binName = data.readString();
    this.drawOrder = data.readInt32();
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("binName", dbgStr(this.binName));
    info.set("drawOrder", dbgNum(this.drawOrder));
    return info;
  }
}

registerBAMObject("CullBinAttrib", CullBinAttrib);
