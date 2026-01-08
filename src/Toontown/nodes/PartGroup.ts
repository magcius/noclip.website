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
  public name: string = "";
  public childRefs: number[] = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.name = data.readString();

    // In BAM 6.11, skip freeze-joint info (no longer stored)
    if (
      this._version.compare(new AssetVersion(6, 11)) >= 0 &&
      this._version.compare(new AssetVersion(6, 12)) < 0
    ) {
      data.readBool(); // freeze flag
      // Skip LMatrix4f (16 floats)
      for (let i = 0; i < 16; i++) {
        data.readFloat32();
      }
    }

    const numChildren = data.readUint16();
    this.childRefs = [];
    for (let i = 0; i < numChildren; i++) {
      this.childRefs.push(data.readObjectId());
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("children", dbgRefs(this.childRefs));
    return info;
  }
}

registerBAMObject("PartGroup", PartGroup);
