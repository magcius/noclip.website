import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import type { AnimBundle } from "./AnimBundle";
import { type DebugInfo, dbgRefs, dbgStr } from "./debug";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

/**
 * Base class for animation hierarchy nodes
 *
 * Child classes:
 * - AnimBundle (extends AnimGroup with fps/frames)
 * - AnimChannelBase (extends AnimGroup with channel data)
 */
export class AnimGroup extends TypedObject {
  public name = "";
  public root: AnimBundle | null = null;
  public children: AnimGroup[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.name = data.readString();
    // Can't use getTyped because of circular dependency
    this.root = file.getObject(data.readObjectId()) as AnimBundle | null;

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

registerTypedObject("AnimGroup", AnimGroup);
