import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgRef } from "./debug";
import type { InternalName } from "./InternalName";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

export class VertexSlider extends TypedObject {
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

registerTypedObject("VertexSlider", VertexSlider);
