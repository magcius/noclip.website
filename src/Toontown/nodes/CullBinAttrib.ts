import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import type { MaterialData } from "../geom";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum, dbgStr } from "./debug";
import { RenderAttrib } from "./RenderAttrib";

export class CullBinAttrib extends RenderAttrib {
  public binName = "";
  public drawOrder = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.binName = data.readString();
    this.drawOrder = data.readInt32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.binName = this.binName;
    target.drawOrder = this.drawOrder;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("binName", dbgStr(this.binName));
    info.set("drawOrder", dbgNum(this.drawOrder));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    material.cullBinName = this.binName;
    material.drawOrder = this.drawOrder;
  }

  static create(binName: string, drawOrder: number = 0): CullBinAttrib {
    const attrib = new CullBinAttrib();
    attrib.binName = binName;
    attrib.drawOrder = drawOrder;
    return attrib;
  }
}

registerBAMObject("CullBinAttrib", CullBinAttrib);
