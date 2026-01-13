import { vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import type { MaterialData } from "../geom";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgColor, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";

export enum ColorType {
  Vertex = 0,
  Flat = 1,
  Off = 2,
}

export class ColorAttrib extends RenderAttrib {
  public colorType = ColorType.Vertex;
  public color = vec4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.colorType = data.readUint8() as ColorType;
    this.color = data.readVec4();
    this.quantizeColor();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.colorType = this.colorType;
    vec4.copy(target.color, this.color);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("colorType", dbgEnum(this.colorType, ColorType));
    info.set("color", dbgColor(this.color));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    material.colorType = this.colorType;
    if (material.colorType === ColorType.Flat) material.flatColor = this.color;
  }

  private quantizeColor(): void {
    if (this.colorType === ColorType.Flat) {
      const SCALE = 1024.0;
      this.color = [
        Math.floor(this.color[0] * SCALE + 0.5) / SCALE,
        Math.floor(this.color[1] * SCALE + 0.5) / SCALE,
        Math.floor(this.color[2] * SCALE + 0.5) / SCALE,
        Math.floor(this.color[3] * SCALE + 0.5) / SCALE,
      ];
    }
  }

  static flat(color: vec4): ColorAttrib {
    const attrib = new ColorAttrib();
    attrib.colorType = ColorType.Flat;
    vec4.copy(attrib.color, color);
    return attrib;
  }
}

registerBAMObject("ColorAttrib", ColorAttrib);
