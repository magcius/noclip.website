import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum, dbgRefs } from "./debug";
import { VertexTransform } from "./VertexTransform";

/**
 * GPU bone palette - an array of VertexTransform references.
 * This is used for hardware (GPU) skinning where bone matrices
 * are indexed directly.
 *
 * BAM format:
 * - uint16 numTransforms
 * - For each: objectId (pointer to VertexTransform)
 */
export class TransformTable extends BAMObject {
  public transforms: Array<VertexTransform | null> = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const numTransforms = data.readUint16();
    this.transforms = new Array(numTransforms);

    for (let i = 0; i < numTransforms; i++) {
      const transformId = data.readObjectId();
      const transform = file.getTyped(transformId, VertexTransform);
      this.transforms[i] = transform;
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.transforms = this.transforms.map((t) => ctx.clone(t));
  }

  /**
   * Get the transform at a given index (bone index).
   */
  getTransform(index: number): VertexTransform | null {
    if (index < 0 || index >= this.transforms.length) {
      return null;
    }
    return this.transforms[index];
  }

  /**
   * Get the number of transforms (bones) in the palette.
   */
  get numTransforms(): number {
    return this.transforms.length;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("numTransforms", dbgNum(this.transforms.length));
    info.set("transforms", dbgRefs(this.transforms));
    return info;
  }
}

registerBAMObject("TransformTable", TransformTable);
