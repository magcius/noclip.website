import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import {
  type DebugInfo,
  dbgArray,
  dbgFields,
  dbgNum,
  dbgObject,
} from "./debug";
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
    this.entries = new Array(numEntries);
    for (let i = 0; i < numEntries; i++) {
      const transform = file.getTyped(data.readObjectId(), VertexTransform);
      if (!transform)
        throw new Error("Missing VertexTransform in TransformBlend");
      const weight = data.readStdFloat();
      this.entries[i] = { transform, weight };
    }
    return numEntries;
  }

  /**
   * Get the number of joints influencing this blend.
   */
  get numTransforms(): number {
    return this.entries.length;
  }

  getDebugInfo(): DebugInfo {
    const info: DebugInfo = new Map();
    info.set(
      "entries",
      dbgArray(
        this.entries.map((entry) =>
          dbgObject(
            dbgFields([
              ["transform", dbgObject(entry.transform.getDebugInfo())],
              ["weight", dbgNum(entry.weight)],
            ]),
          ),
        ),
      ),
    );
    return info;
  }
}
