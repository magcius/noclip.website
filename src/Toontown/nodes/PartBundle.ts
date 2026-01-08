import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgNum, dbgRef, dbgStr } from "./debug";
import { PartGroup } from "./PartGroup";

/**
 * PartBundle - Animation bundle
 *
 * Extends PartGroup with blend settings.
 * In BAM 6.10+, has CData with blend type and root transform.
 * In BAM 6.17+, has anim_preload pointer.
 */
export class PartBundle extends PartGroup {
  public animPreloadRef: number = 0;
  public blendType: number = 0;
  public animBlendFlag: boolean = false;
  public frameBlendFlag: boolean = false;
  public rootXform: Float32Array = new Float32Array(16);

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // In BAM 6.17+, read anim_preload pointer
    if (this._version.compare(new AssetVersion(6, 17)) >= 0) {
      this.animPreloadRef = data.readObjectId();
    }

    // In BAM 6.10+, read CData
    if (this._version.compare(new AssetVersion(6, 10)) >= 0) {
      this.blendType = data.readUint8();
      this.animBlendFlag = data.readBool();
      this.frameBlendFlag = data.readBool();
      for (let i = 0; i < 16; i++) {
        this.rootXform[i] = data.readFloat32();
      }
    }

    // In BAM 6.11, skip modifies_anim_bundles flag
    if (
      this._version.compare(new AssetVersion(6, 11)) >= 0 &&
      this._version.compare(new AssetVersion(6, 12)) < 0
    ) {
      data.readBool();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 17)) >= 0) {
      info.set("animPreloadRef", dbgRef(this.animPreloadRef));
    }
    if (this._version.compare(new AssetVersion(6, 10)) >= 0) {
      info.set("blendType", dbgNum(this.blendType));
      info.set("animBlendFlag", dbgBool(this.animBlendFlag));
      info.set("frameBlendFlag", dbgBool(this.frameBlendFlag));
      info.set("rootXform", dbgStr(this.rootXform.toString()));
    }
    return info;
  }
}

registerBAMObject("PartBundle", PartBundle);
registerBAMObject("CharacterJointBundle", PartBundle);
