import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { FFTCompressor } from "../FFTCompressor";
import { AnimChannelBase } from "./AnimChannelBase";
import { type DebugInfo, dbgTypedArray } from "./debug";
import { type CopyContext, registerTypedObject } from "./TypedObject";

/**
 * Scalar animation channel with value table.
 *
 * Stores per-frame scalar values (e.g., for morph sliders).
 */
export class AnimChannelScalarTable extends AnimChannelBase<number> {
  public table: Float32Array = new Float32Array(0);
  public compressed = false;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.compressed = data.readBool();
    if (this.compressed) {
      // Compressed channels can be either discrete (indexed) or continuous (FFT)
      const indexLength = data.readUint8();

      if (indexLength < 0xff) {
        // Discrete values using lookup table
        if (indexLength > 0) {
          // Read the index table
          const index = new Float32Array(indexLength);
          for (let i = 0; i < indexLength; i++) {
            index[i] = data.readFloat32();
          }

          // Read the channel values
          const tableLength = data.readUint16();

          if (indexLength === 1) {
            // With only one index value, all values are the same
            this.table = new Float32Array(tableLength);
            this.table.fill(index[0]);
          } else {
            // Read nibble-packed index values
            this.table = new Float32Array(tableLength);
            let i = 0;
            while (i < tableLength - 1) {
              const num = data.readUint8();
              const i1 = (num >> 4) & 0xf;
              const i2 = num & 0xf;
              this.table[i++] = index[i1];
              this.table[i++] = index[i2];
            }
            // Handle odd last value
            if (i < tableLength) {
              const num = data.readUint8();
              const i1 = (num >> 4) & 0xf;
              this.table[i] = index[i1];
            }
          }
        } else {
          // Empty table
          this.table = new Float32Array(0);
        }
      } else {
        // Continuous channels using FFT compression
        const compressor = new FFTCompressor();
        compressor.readHeader(data);
        this.table = compressor.readReals(data);
      }
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

  override getValue(_out: number, frame: number): number {
    if (this.table.length === 0) return 0;
    return this.table[frame % this.table.length];
  }
}

registerTypedObject("AnimChannelScalarTable", AnimChannelScalarTable);
