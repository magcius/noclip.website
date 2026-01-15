import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import type { MaterialData } from "../geom";
import { type BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { RenderAttrib } from "./RenderAttrib";

export class MaterialAttrib extends RenderAttrib {
  public material: BAMObject | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.material = file.getObject(data.readObjectId());
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.material = ctx.clone(this.material);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("material", dbgRef(this.material));
    return info;
  }

  override applyToMaterial(_material: MaterialData): void {}
}

registerBAMObject("MaterialAttrib", MaterialAttrib);
