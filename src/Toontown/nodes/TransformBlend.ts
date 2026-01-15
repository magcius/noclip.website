import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { VertexTransform } from "./VertexTransform";

/**
 * Represents weighted influence of multiple joints on a single vertex.
 * Typically a vertex is influenced by 1-4 joints.
 *
 * This is not a BAMObject itself, but is serialized inline within TransformBlendTable.
 *
 * BAM inline format:
 * - uint16 numEntries
 * - For each entry:
 *   - objectId (pointer to VertexTransform, typically JointVertexTransform)
 *   - float32 weight
 */
export interface TransformEntry {
  transform: VertexTransform;
  weight: number;
}

export class TransformBlend {
  public entries: TransformEntry[] = [];

  /**
   * Load a TransformBlend from BAM data.
   * Returns the number of object pointers that need to be resolved later.
   */
  load(file: BAMFile, data: DataStream): number {
    const numEntries = data.readUint16();
    this.entries = [];

    for (let i = 0; i < numEntries; i++) {
      const transformId = data.readObjectId();
      const weight = data.readStdFloat();

      // The transform will be resolved in complete_pointers
      // For now, store null and the weight
      const transform = file.getTyped(transformId, VertexTransform);
      if (transform) {
        this.entries.push({ transform, weight });
      }
    }

    return numEntries; // Number of pointers to resolve
  }

  /**
   * Compute the blended skinning matrix from all entries.
   * Result is: sum(transform.getSkinningMatrix() * weight) for all entries
   */
  getBlendedMatrix(out: mat4): void {
    mat4.set(out, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const temp = mat4.create();
    for (const entry of this.entries) {
      entry.transform.getSkinningMatrix(temp);
      mat4.multiplyScalarAndAdd(out, out, temp, entry.weight);
    }
  }

  /**
   * Get the number of joints influencing this blend.
   */
  get numTransforms(): number {
    return this.entries.length;
  }
}
