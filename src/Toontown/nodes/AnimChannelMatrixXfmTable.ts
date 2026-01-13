import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { AnimChannelBase } from "./AnimChannelBase";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgNum } from "./debug";

// Matrix component indices (12 total for a 4x3 affine transform)
// i, j, k = scale
// a, b, c = shear
// h, p, r = rotation (HPR angles)
// x, y, z = translation
const NUM_MATRIX_COMPONENTS = 12;

/**
 * Matrix animation channel with transform tables.
 *
 * Stores per-frame transform data as separate tables for each component:
 * scale (i,j,k), shear (a,b,c), rotation (h,p,r), translation (x,y,z)
 *
 * Version differences:
 * - BAM < 4.14: No new_hpr flag
 * - BAM >= 4.14: Has new_hpr flag for HPR format conversion
 */
export class AnimChannelMatrixXfmTable extends AnimChannelBase {
  public tables: ReadonlyArray<Float32Array> = [];
  public compressed = false;
  public newHpr = false;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.compressed = data.readBool();

    // BAM 4.14+ has new_hpr flag
    if (this._version.compare(new AssetVersion(4, 14)) >= 0) {
      this.newHpr = data.readBool();
    }

    if (this.compressed) {
      throw new Error("Compressed animation channels not yet supported");
    } else {
      const tables = new Array<Float32Array>(NUM_MATRIX_COMPONENTS);
      for (let i = 0; i < NUM_MATRIX_COMPONENTS; i++) {
        const size = data.readUint16();
        tables[i] = data.readFloat32Array(size);
      }
      this.tables = tables;
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.tables = this.tables;
    target.compressed = this.compressed;
    target.newHpr = this.newHpr;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("compressed", dbgBool(this.compressed));
    const nonEmptyTables = this.tables.filter((t) => t.length > 0).length;
    info.set("tables", dbgNum(nonEmptyTables));
    return info;
  }
}

registerBAMObject("AnimChannelMatrixXfmTable", AnimChannelMatrixXfmTable);
