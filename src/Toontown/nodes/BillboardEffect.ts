import { vec3 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgNum, dbgRef, dbgVec3 } from "./debug";
import { PandaNode } from "./PandaNode";
import { RenderEffect } from "./RenderEffects";

/**
 * Makes a node always face the camera.
 *
 * Version differences:
 * - BAM 6.43+: Added look_at NodePath and fixed_depth
 */
export class BillboardEffect extends RenderEffect {
  public off = false;
  public upVector = vec3.fromValues(0, 0, 1);
  public eyeRelative = false;
  public axialRotate = false;
  public offset = 0;
  public lookAtPoint = vec3.create();
  public lookAt: PandaNode | null = null; // 6.43+
  public fixedDepth = false; // 6.43+

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.off = data.readBool();
    this.upVector = data.readVec3();
    this.eyeRelative = data.readBool();
    this.axialRotate = data.readBool();
    this.offset = data.readFloat32();
    this.lookAtPoint = data.readVec3();
    if (this._version.compare(new AssetVersion(6, 43)) >= 0) {
      this.lookAt = file.getTyped(data.readObjectId(), PandaNode);
      this.fixedDepth = data.readBool();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.off = this.off;
    vec3.copy(target.upVector, this.upVector);
    target.eyeRelative = this.eyeRelative;
    target.axialRotate = this.axialRotate;
    target.offset = this.offset;
    vec3.copy(target.lookAtPoint, this.lookAtPoint);
    target.lookAt = ctx.clone(this.lookAt);
    target.fixedDepth = this.fixedDepth;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("off", dbgBool(this.off));
    info.set("upVector", dbgVec3(this.upVector));
    info.set("eyeRelative", dbgBool(this.eyeRelative));
    info.set("axialRotate", dbgBool(this.axialRotate));
    info.set("offset", dbgNum(this.offset));
    info.set("lookAtPoint", dbgVec3(this.lookAtPoint));
    if (this._version.compare(new AssetVersion(6, 43)) >= 0) {
      info.set("lookAt", dbgRef(this.lookAt));
      info.set("fixedDepth", dbgBool(this.fixedDepth));
    }
    return info;
  }
}

registerBAMObject("BillboardEffect", BillboardEffect);
