import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { type BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { PandaNode } from "./PandaNode";

export class SheetNode extends PandaNode {
  public surface: BAMObject | null = null;

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

registerBAMObject("SheetNode", SheetNode);
