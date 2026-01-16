import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { MaterialData } from "../Geom";
import { type DebugInfo, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export enum DepthWriteMode {
  Off = 0,
  On = 1,
}

export class DepthWriteAttrib extends RenderAttrib {
  public mode = DepthWriteMode.On;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as DepthWriteMode;
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.mode = this.mode;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, DepthWriteMode));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    material.depthWrite = this.mode;
  }

  static create(mode: DepthWriteMode = DepthWriteMode.On): DepthWriteAttrib {
    const attrib = new DepthWriteAttrib();
    attrib.mode = mode;
    return attrib;
  }
}

registerTypedObject("DepthWriteAttrib", DepthWriteAttrib);
