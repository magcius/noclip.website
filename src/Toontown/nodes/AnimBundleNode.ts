import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { AnimBundle } from "./AnimBundle";
import { type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { PandaNode } from "./PandaNode";

/**
 * Node that holds an AnimBundle.
 *
 * This is a PandaNode that contains a reference to an AnimBundle,
 * allowing animation data to be part of the scene graph.
 */
export class AnimBundleNode extends PandaNode {
  public animBundle: AnimBundle | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.animBundle = file.getTyped(data.readObjectId(), AnimBundle);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.animBundle = ctx.clone(this.animBundle);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("animBundle", dbgRef(this.animBundle));
    return info;
  }
}

registerBAMObject("AnimBundleNode", AnimBundleNode);
