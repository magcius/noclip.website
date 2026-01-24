import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { MaterialData } from "../Geom";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgBool, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export enum CullFaceMode {
  CullNone = 0,
  CullClockwise = 1,
  CullCounterClockwise = 2,
  CullUnchanged = 3,
}

/**
 * Controls face culling.
 *
 * Version differences:
 * - BAM 4.1+: Added reverse field
 */
export class CullFaceAttrib extends RenderAttrib {
  public mode = CullFaceMode.CullClockwise;
  public reverse = false;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.mode = data.readUint8() as CullFaceMode;
    if (this._version.compare(new AssetVersion(4, 1)) >= 0) {
      this.reverse = data.readBool();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.mode = this.mode;
    target.reverse = this.reverse;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, CullFaceMode));
    if (this._version.compare(new AssetVersion(4, 1)) >= 0) {
      info.set("reverse", dbgBool(this.reverse));
    }
    return info;
  }

  override compose(other: this): this {
    // Normal case
    if (!this.reverse && other.mode !== CullFaceMode.CullUnchanged) {
      return other;
    }

    const mode =
      other.mode === CullFaceMode.CullUnchanged ? this.mode : other.mode;
    const reverse = this.reverse !== other.reverse;
    return CullFaceAttrib.create(mode, reverse) as this;
  }

  override applyToMaterial(material: MaterialData): void {
    material.cullFaceMode = this.mode;
    material.cullReverse = this.reverse;
  }

  static create(mode: CullFaceMode, reverse = false): CullFaceAttrib {
    const result = new CullFaceAttrib();
    result.mode = mode;
    result.reverse = reverse;
    return result;
  }
}

registerTypedObject("CullFaceAttrib", CullFaceAttrib);
