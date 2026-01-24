import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgRef } from "./debug";
import { PandaNode } from "./PandaNode";
import {
  type CopyContext,
  registerTypedObject,
  type TypedObject,
} from "./TypedObject";

export class SheetNode extends PandaNode {
  public surface: TypedObject | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.surface = file.getObject(data.readObjectId());
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.surface = ctx.clone(this.surface);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("surface", dbgRef(this.surface));
    return info;
  }
}

registerTypedObject("SheetNode", SheetNode);
