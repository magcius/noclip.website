import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { AnimChannelBase } from "./AnimChannelBase";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";

/**
 * Scalar animation channel with value table.
 *
 * Stores per-frame scalar values (e.g., for morph sliders).
 */
export class AnimChannelScalarTable extends AnimChannelBase {
  public table: Float32Array = new Float32Array(0);
  public compressed = false;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.compressed = data.readBool();
    if (this.compressed) {
      throw new Error("Compressed animation channels not yet supported");
    } else {
      const size = data.readUint16();
      this.table = data.readFloat32Array(size);
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.table = this.table.slice();
    target.compressed = this.compressed;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("values", dbgNum(this.table.length));
    return info;
  }
}

registerBAMObject("AnimChannelScalarTable", AnimChannelScalarTable);
