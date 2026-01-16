import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { MaterialData } from "../Geom";
import { type DebugInfo, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export const ColorWriteChannels = {
  Off: 0x0,
  Red: 0x1,
  Green: 0x2,
  Blue: 0x4,
  RGB: 0x7,
  Alpha: 0x8,
  All: 0xf,
};

export class ColorWriteAttrib extends RenderAttrib {
  public channels = ColorWriteChannels.All;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.channels = data.readUint8();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.channels = this.channels;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("channels", dbgEnum(this.channels, ColorWriteChannels));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    material.colorWriteChannels = this.channels;
  }

  static create(channels: number = ColorWriteChannels.All): ColorWriteAttrib {
    const attrib = new ColorWriteAttrib();
    attrib.channels = channels;
    return attrib;
  }
}

registerTypedObject("ColorWriteAttrib", ColorWriteAttrib);
