import type { BAMFile } from "../BAMFile";
import type { MaterialData } from "../Geom";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgRef } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import {
  type CopyContext,
  registerTypedObject,
  type TypedObject,
} from "./TypedObject";

export class MaterialAttrib extends RenderAttrib {
  public material: TypedObject | null = null;

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

  override applyToMaterial(_material: MaterialData): void {
    console.warn("MaterialAttrib.applyToMaterial not implemented");
  }
}

registerTypedObject("MaterialAttrib", MaterialAttrib);
