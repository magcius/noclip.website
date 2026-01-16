import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import type { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgRefs, dbgStr } from "./debug";
import type { PartBundle } from "./PartBundle";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

/**
 * PartGroup - Base class for animation part hierarchy
 *
 * This is the base class for CharacterJointBundle, CharacterJoint, etc.
 * It stores a name and references to child PartGroups.
 *
 * In BAM 6.11, there's freeze-joint info that was later removed.
 */
export class PartGroup extends TypedObject {
  public name = "";
  public children: PartGroup[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.name = data.readString();

    // In BAM 6.11, skip freeze-joint info (no longer stored)
    if (this._version.compare(new AssetVersion(6, 11)) === 0) {
      data.readBool(); // freeze flag
      data.readMat4(); // LMatrix4f
    }

    const numChildren = data.readUint16();
    this.children = new Array(numChildren);
    for (let i = 0; i < numChildren; i++) {
      const ref = data.readObjectId();
      const obj = file.getTyped(ref, PartGroup);
      if (!obj) throw new Error(`PartGroup: Invalid child ref ${ref}`);
      this.children[i] = obj;
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.name = this.name;
    target.children = ctx.cloneArray(this.children);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("children", dbgRefs(this.children));
    return info;
  }

  protected bindHeirarchy(anim: AnimGroup | null, channelIndex: number): void {
    let partIdx = 0;
    let animIdx = 0;
    const numAnimChildren = anim ? anim.children.length : 0;
    if (anim !== null) {
      while (partIdx < this.children.length && animIdx < numAnimChildren) {
        const pc = this.children[partIdx];
        const ac = anim.children[animIdx];
        if (pc.name < ac.name) {
          // Part without associated animation
          pc.bindHeirarchy(null, channelIndex);
          partIdx++;
        } else if (pc.name > ac.name) {
          // Animation without associated part
          animIdx++;
        } else {
          // Bind part and animation
          pc.bindHeirarchy(ac, channelIndex);
          partIdx++;
          animIdx++;
        }
      }
    }
    // Bind remaining parts without animations
    while (partIdx < this.children.length) {
      const pc = this.children[partIdx];
      pc.bindHeirarchy(null, channelIndex);
      partIdx++;
    }
  }

  doUpdate(
    root: PartBundle,
    _parent: PartGroup | null,
    parentChanged: boolean,
    animChanged: boolean,
  ): boolean {
    let anyChanged = false;
    for (const child of this.children) {
      if (child.doUpdate(root, this, parentChanged, animChanged)) {
        anyChanged = true;
      }
    }
    return anyChanged;
  }
}

registerTypedObject("PartGroup", PartGroup);
