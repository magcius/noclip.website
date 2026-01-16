import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { MaterialData } from "../Geom";
import { type DebugInfo, dbgEnum } from "./debug";
import { PandaCompareFunc, RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export class DepthTestAttrib extends RenderAttrib {
  public mode = PandaCompareFunc.Less;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as PandaCompareFunc;
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.mode = this.mode;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, PandaCompareFunc));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    material.depthTestMode = this.mode;
  }

  static create(
    mode: PandaCompareFunc = PandaCompareFunc.Less,
  ): DepthTestAttrib {
    const attrib = new DepthTestAttrib();
    attrib.mode = mode;
    return attrib;
  }
}

registerTypedObject("DepthTestAttrib", DepthTestAttrib);
