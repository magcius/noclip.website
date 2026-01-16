import { mat4, quat, vec3 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import { FFTCompressor } from "../FFTCompressor";
import { applyShear, hprToQuat } from "../Math";
import { AnimChannelBase } from "./AnimChannelBase";
import { type DebugInfo, dbgArray, dbgBool, dbgTypedArray } from "./debug";
import { type CopyContext, registerTypedObject } from "./TypedObject";

// Matrix component indices (12 total for a 4x3 affine transform)
// i, j, k = scale
// a, b, c = shear
// h, p, r = rotation (HPR angles)
// x, y, z = translation
const NUM_MATRIX_COMPONENTS = 12;

// Default values for each of the 12 matrix components
const DEFAULTS = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

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
export class AnimChannelMatrixXfmTable extends AnimChannelBase<mat4> {
  public compressed = false;
  public newHpr = false;
  public tables: ReadonlyArray<Float32Array> = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.compressed = data.readBool();

    // BAM 4.14+ has new_hpr flag
    if (this._version.compare(new AssetVersion(4, 14)) >= 0) {
      this.newHpr = data.readBool();
    }

    const tables = new Array<Float32Array>(NUM_MATRIX_COMPONENTS);
    if (this.compressed) {
      // Read compressed animation data using FFT decompression
      const compressor = new FFTCompressor();
      compressor.readHeader(data);

      // Read scales (i, j, k) and shears (a, b, c) - indices 0-5
      for (let i = 0; i < 6; i++) {
        tables[i] = compressor.readReals(data);
      }

      // Read HPR angles (h, p, r) - indices 6-8
      // These are stored as quaternion components and converted back to HPR
      const hprs = compressor.readHprs(data, this.newHpr);
      tables[6] = hprs[0];
      tables[7] = hprs[1];
      tables[8] = hprs[2];

      // Read translations (x, y, z) - indices 9-11
      for (let i = 9; i < NUM_MATRIX_COMPONENTS; i++) {
        tables[i] = compressor.readReals(data);
      }
    } else {
      for (let i = 0; i < NUM_MATRIX_COMPONENTS; i++) {
        const size = data.readUint16();
        tables[i] = data.readFloat32Array(size);
      }
    }
    this.tables = tables;
  }

  /**
   * Compose a 4x4 matrix from the channel component tables.
   */
  override getValue(out: mat4, frame: number): mat4 {
    // Extract component values at this frame
    const sx = this.getComponentValue(0, frame);
    const sy = this.getComponentValue(1, frame);
    const sz = this.getComponentValue(2, frame);
    const shearXY = this.getComponentValue(3, frame);
    const shearXZ = this.getComponentValue(4, frame);
    const shearYZ = this.getComponentValue(5, frame);
    const h = this.getComponentValue(6, frame);
    const p = this.getComponentValue(7, frame);
    const r = this.getComponentValue(8, frame);
    const tx = this.getComponentValue(9, frame);
    const ty = this.getComponentValue(10, frame);
    const tz = this.getComponentValue(11, frame);

    // Create matrix
    const q = quat.create();
    hprToQuat(q, vec3.fromValues(h, p, r), this.newHpr);
    const t = vec3.fromValues(tx, ty, tz);
    const s = vec3.fromValues(sx, sy, sz);
    mat4.fromRotationTranslationScale(out, q, t, s);

    // Apply shear (if any)
    if (shearXY !== 0 || shearXZ !== 0 || shearYZ !== 0) {
      applyShear(out, shearXY, shearXZ, shearYZ);
    }
    return out;
  }

  private getComponentValue(index: number, frame: number): number {
    const table = this.tables[index];
    if (!table || table.length === 0) {
      return DEFAULTS[index];
    }
    return table[frame % table.length];
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.compressed = this.compressed;
    target.newHpr = this.newHpr;
    target.tables = this.tables;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("compressed", dbgBool(this.compressed));
    info.set("newHpr", dbgBool(this.newHpr));
    info.set(
      "tables",
      dbgArray(this.tables.map((table) => dbgTypedArray(table))),
    );
    return info;
  }
}

registerTypedObject("AnimChannelMatrixXfmTable", AnimChannelMatrixXfmTable);
