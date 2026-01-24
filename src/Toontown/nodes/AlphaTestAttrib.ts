import type { BAMFile } from "../BAMFile";
import type { MaterialData } from "../Geom";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgEnum, dbgNum } from "./debug";
import { PandaCompareFunc, RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export class AlphaTestAttrib extends RenderAttrib {
  public mode = PandaCompareFunc.Always;
  public referenceAlpha = 1;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as PandaCompareFunc;
    this.referenceAlpha = data.readFloat32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.mode = this.mode;
    target.referenceAlpha = this.referenceAlpha;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, PandaCompareFunc));
    info.set("referenceAlpha", dbgNum(this.referenceAlpha));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    material.alphaTestMode = this.mode;
    material.alphaTestThreshold = this.referenceAlpha;
  }

  static create(
    mode: PandaCompareFunc = PandaCompareFunc.Always,
    referenceAlpha: number = 1,
  ): AlphaTestAttrib {
    const attrib = new AlphaTestAttrib();
    attrib.mode = mode;
    attrib.referenceAlpha = referenceAlpha;
    return attrib;
  }
}

registerTypedObject("AlphaTestAttrib", AlphaTestAttrib);
