import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgEnum } from "./debug";

export enum CullFaceMode {
  CullNone = 0,
  CullClockwise = 1,
  CullCounterClockwise = 2,
  CullUnchanged = 3,
}

/**
 * CullFaceAttrib - Controls face culling
 *
 * Version differences:
 * - BAM 4.1+: Added reverse field
 */
export class CullFaceAttrib extends BAMObject {
  public mode: CullFaceMode = CullFaceMode.CullClockwise;
  public reverse: boolean = false;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.mode = data.readUint8() as CullFaceMode;
    if (this._version.compare(new AssetVersion(4, 1)) >= 0) {
      this.reverse = data.readBool();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, CullFaceMode));
    if (this._version.compare(new AssetVersion(4, 1)) >= 0) {
      info.set("reverse", dbgBool(this.reverse));
    }
    return info;
  }
}

registerBAMObject("CullFaceAttrib", CullFaceAttrib);
