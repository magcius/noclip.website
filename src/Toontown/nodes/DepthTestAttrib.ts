import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum } from "./debug";
import { PandaCompareFunc, RenderAttrib } from "./RenderAttrib";

export class DepthTestAttrib extends RenderAttrib {
  public mode = PandaCompareFunc.Less;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as PandaCompareFunc;
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.mode = this.mode;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, PandaCompareFunc));
    return info;
  }

  static create(
    mode: PandaCompareFunc = PandaCompareFunc.Less,
  ): DepthTestAttrib {
    const attrib = new DepthTestAttrib();
    attrib.mode = mode;
    return attrib;
  }
}

registerBAMObject("DepthTestAttrib", DepthTestAttrib);
