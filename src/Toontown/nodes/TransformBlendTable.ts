import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgNum } from "./debug";
import { SparseArray } from "./SparseArray";
import { TransformBlend } from "./TransformBlend";

/**
 * Contains all unique blend combinations for a piece of geometry.
 * Each blend represents a unique combination of weighted joint influences.
 *
 * Vertices reference this table via a "transform_blend" index column,
 * which maps each vertex to a TransformBlend entry.
 *
 * BAM format:
 * - uint16 numBlends
 * - For each blend: TransformBlend (inline)
 * - SparseArray rows (BAM 6.7+)
 * - CData (ignored)
 */
export class TransformBlendTable extends BAMObject {
  public blends: TransformBlend[] = [];
  public rows = new SparseArray();

  /** Maximum number of transforms influencing any single vertex */
  public maxSimultaneousTransforms = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const numBlends = data.readUint16();
    this.blends = [];
    this.maxSimultaneousTransforms = 0;

    for (let i = 0; i < numBlends; i++) {
      const blend = new TransformBlend();
      blend.load(file, data);
      this.blends.push(blend);

      // Track max transforms per vertex
      if (blend.numTransforms > this.maxSimultaneousTransforms) {
        this.maxSimultaneousTransforms = blend.numTransforms;
      }
    }

    // SparseArray rows - which vertices are affected (BAM 6.7+)
    if (this._version.compare(new AssetVersion(6, 7)) >= 0) {
      this.rows.load(data);
    }

    // CData is empty, skip reading it
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    // TransformBlends are not BAMObjects, need to copy manually
    target.blends = this.blends.map((blend) => {
      const newBlend = new TransformBlend();
      newBlend.entries = blend.entries.map((entry) => ({
        transform: ctx.clone(entry.transform),
        weight: entry.weight,
      }));
      return newBlend;
    });
    target.rows = this.rows; // SparseArray is immutable after load
    target.maxSimultaneousTransforms = this.maxSimultaneousTransforms;
  }

  /**
   * Get the blend at a given index.
   */
  getBlend(index: number): TransformBlend | null {
    if (index < 0 || index >= this.blends.length) {
      return null;
    }
    return this.blends[index];
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("numBlends", dbgNum(this.blends.length));
    info.set(
      "maxSimultaneousTransforms",
      dbgNum(this.maxSimultaneousTransforms),
    );
    info.set("rowsInverse", dbgBool(this.rows.inverse));
    info.set("rowsSubranges", dbgNum(this.rows.subranges.length));
    return info;
  }
}

registerBAMObject("TransformBlendTable", TransformBlendTable);
