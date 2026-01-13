import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { AnimChannelBase } from "./AnimChannelBase";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum, dbgTypedArray } from "./debug";

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

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.table = this.table;
    target.compressed = this.compressed;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("values", dbgTypedArray(this.table));
    return info;
  }
}

registerBAMObject("AnimChannelScalarTable", AnimChannelScalarTable);
