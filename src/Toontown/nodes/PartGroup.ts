import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgRefs, dbgStr } from "./debug";

/**
 * PartGroup - Base class for animation part hierarchy
 *
 * This is the base class for CharacterJointBundle, CharacterJoint, etc.
 * It stores a name and references to child PartGroups.
 *
 * In BAM 6.11, there's freeze-joint info that was later removed.
 */
export class PartGroup extends BAMObject {
  public name = "";
  public children: BAMObject[] = [];

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
      const obj = file.getObject(ref);
      if (!obj) throw new Error(`PartGroup: Invalid child ref ${ref}`);
      this.children[i] = obj;
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.name = this.name;
    target.children = this.children; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("children", dbgRefs(this.children));
    return info;
  }
}

registerBAMObject("PartGroup", PartGroup);
