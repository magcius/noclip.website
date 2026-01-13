import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import type { AnimBundle } from "./AnimBundle";
import { BAMObject, CopyContext, readTypedRefs, registerBAMObject } from "./base";
import { type DebugInfo, dbgRefs, dbgStr } from "./debug";

/**
 * Base class for animation hierarchy nodes
 *
 * Child classes:
 * - AnimBundle (extends AnimGroup with fps/frames)
 * - AnimChannelBase (extends AnimGroup with channel data)
 */
export class AnimGroup extends BAMObject {
  public name = "";
  public root: AnimBundle | null = null; // Reference to containing AnimBundle
  public children: AnimGroup[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.name = data.readString();
    data.readObjectId(); // rootRef; parent will set root on load

    const numChildren = data.readUint16();
    this.children = readTypedRefs(file, data, numChildren, AnimGroup);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.name = this.name;
    target.root = ctx.clone(this.root);
    target.children = ctx.cloneArray(this.children);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("children", dbgRefs(this.children));
    return info;
  }
}

registerBAMObject("AnimGroup", AnimGroup);
