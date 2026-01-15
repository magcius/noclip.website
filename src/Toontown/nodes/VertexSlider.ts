import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { InternalName } from "./InternalName";

export class VertexSlider extends BAMObject {
  public name: InternalName | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.name = ctx.clone(this.name);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgRef(this.name));
    return info;
  }

  getSlider(): number {
    return 0;
  }
}

registerBAMObject("VertexSlider", VertexSlider);
