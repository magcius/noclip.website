import { type ReadonlyVec4, vec4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { MaterialData } from "../Geom";
import { type DebugInfo, dbgBool, dbgColor } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

const whiteColor = vec4.fromValues(1, 1, 1, 1);

export class ColorScaleAttrib extends RenderAttrib {
  public off = false;
  public scale: ReadonlyVec4 = whiteColor;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.off = data.readBool();
    this.scale = data.readVec4();
    this.quantizeScale();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.off = this.off;
    target.scale = this.scale;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("off", dbgBool(this.off));
    info.set("scale", dbgColor(this.scale));
    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    if (!this.off) material.colorScale = this.scale;
  }

  private quantizeScale(): void {
    const SCALE = 1000.0;
    this.scale = vec4.fromValues(
      Math.floor(this.scale[0] * SCALE + 0.5) / SCALE,
      Math.floor(this.scale[1] * SCALE + 0.5) / SCALE,
      Math.floor(this.scale[2] * SCALE + 0.5) / SCALE,
      Math.floor(this.scale[3] * SCALE + 0.5) / SCALE,
    );
  }

  override compose(other: this): this {
    if (other.off) return other;
    const attrib = new ColorScaleAttrib();
    attrib.off = this.off;
    const scale = vec4.create();
    vec4.multiply(scale, this.scale, other.scale);
    attrib.scale = scale;
    attrib.quantizeScale();
    return attrib as this;
  }

  override lowerAttribCanOverride(): boolean {
    return true;
  }

  hasScale(): boolean {
    return !this.isIdentity();
  }

  hasRgbScale(): boolean {
    const EPS = 0.0001;
    return (
      Math.abs(this.scale[0] - 1) > EPS ||
      Math.abs(this.scale[1] - 1) > EPS ||
      Math.abs(this.scale[2] - 1) > EPS
    );
  }

  hasAlphaScale(): boolean {
    const EPS = 0.0001;
    return Math.abs(this.scale[3] - 1) > EPS;
  }

  isIdentity(): boolean {
    const EPS = 0.0001;
    return (
      Math.abs(this.scale[0] - 1) < EPS &&
      Math.abs(this.scale[1] - 1) < EPS &&
      Math.abs(this.scale[2] - 1) < EPS &&
      Math.abs(this.scale[3] - 1) < EPS
    );
  }

  static identity(): ColorScaleAttrib {
    return new ColorScaleAttrib();
  }

  static make(scale: ReadonlyVec4): ColorScaleAttrib {
    const attrib = new ColorScaleAttrib();
    attrib.off = false;
    attrib.scale = scale;
    attrib.quantizeScale();
    return attrib;
  }

  static makeOff(): ColorScaleAttrib {
    const attrib = new ColorScaleAttrib();
    attrib.off = true;
    return attrib;
  }
}

registerTypedObject("ColorScaleAttrib", ColorScaleAttrib);
