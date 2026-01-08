import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgNum, dbgRef, dbgVec3 } from "./debug";

/**
 * BillboardEffect - Makes a node always face the camera
 *
 * Version differences:
 * - BAM < 6.43: No look_at node or fixed_depth
 * - BAM >= 6.43: Has look_at NodePath and fixed_depth
 */
export class BillboardEffect extends BAMObject {
  public off: boolean = false;
  public upVector: [number, number, number] = [0, 0, 1];
  public eyeRelative: boolean = false;
  public axialRotate: boolean = false;
  public offset: number = 0;
  public lookAtPoint: [number, number, number] = [0, 0, 0];
  public lookAtRef: number = 0; // 6.43+
  public fixedDepth: boolean = false; // 6.43+

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.off = data.readBool();
    this.upVector = data.readVec3();
    this.eyeRelative = data.readBool();
    this.axialRotate = data.readBool();
    this.offset = data.readFloat32();
    this.lookAtPoint = data.readVec3();

    if (this._version.compare(new AssetVersion(6, 43)) >= 0) {
      this.lookAtRef = data.readObjectId();
      this.fixedDepth = data.readBool();
    }
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
      info.set("lookAtRef", dbgRef(this.lookAtRef));
      info.set("fixedDepth", dbgBool(this.fixedDepth));
    }
    return info;
  }
}

registerBAMObject("BillboardEffect", BillboardEffect);
