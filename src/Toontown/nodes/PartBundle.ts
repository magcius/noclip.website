import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type BAMObject, CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgMat4, dbgNum, dbgRef, dbgStr } from "./debug";
import { PartGroup } from "./PartGroup";

/**
 * PartBundle - Animation bundle
 *
 * Extends PartGroup with blend settings.
 * In BAM 6.10+, has CData with blend type and root transform.
 * In BAM 6.17+, has anim_preload pointer.
 */
export class PartBundle extends PartGroup {
  public animPreload: BAMObject | null = null; // TODO AnimPreloadTable
  public blendType = 0;
  public animBlendFlag = false;
  public frameBlendFlag = false;
  public rootXform = mat4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // In BAM 6.17+, read anim_preload pointer
    if (this._version.compare(new AssetVersion(6, 17)) >= 0) {
      this.animPreload = file.getObject(data.readObjectId());
    }

    // In BAM 6.10+, read CData
    if (this._version.compare(new AssetVersion(6, 10)) >= 0) {
      this.blendType = data.readUint8();
      this.animBlendFlag = data.readBool();
      this.frameBlendFlag = data.readBool();
      this.rootXform = data.readMat4();
    }

    // In BAM 6.11, skip modifies_anim_bundles flag
    if (this._version.compare(new AssetVersion(6, 11)) === 0) {
      data.readBool();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.animPreload = ctx.clone(this.animPreload);
    target.blendType = this.blendType;
    target.animBlendFlag = this.animBlendFlag;
    target.frameBlendFlag = this.frameBlendFlag;
    target.rootXform = this.rootXform; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(6, 17)) >= 0) {
      info.set("animPreload", dbgRef(this.animPreload));
    }
    if (this._version.compare(new AssetVersion(6, 10)) >= 0) {
      info.set("blendType", dbgNum(this.blendType));
      info.set("animBlendFlag", dbgBool(this.animBlendFlag));
      info.set("frameBlendFlag", dbgBool(this.frameBlendFlag));
      info.set("rootXform", dbgMat4(this.rootXform));
    }
    return info;
  }
}

registerBAMObject("PartBundle", PartBundle);
