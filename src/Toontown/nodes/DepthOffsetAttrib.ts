import type { BAMFile } from "../BAMFile";
import type { MaterialData } from "../Geom";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgNum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export class DepthOffsetAttrib extends RenderAttrib {
  public offset = 1;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.offset = data.readInt32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.offset = this.offset;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("offset", dbgNum(this.offset));
    return info;
  }

  override compose(other: this): this {
    return DepthOffsetAttrib.create(this.offset + other.offset) as this;
  }

  override applyToMaterial(material: MaterialData): void {
    material.depthOffset = this.offset;
  }

  static create(offset: number = 1): DepthOffsetAttrib {
    const attrib = new DepthOffsetAttrib();
    attrib.offset = offset;
    return attrib;
  }
}

registerTypedObject("DepthOffsetAttrib", DepthOffsetAttrib);
