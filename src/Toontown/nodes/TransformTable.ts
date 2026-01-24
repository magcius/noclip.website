import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgNum, dbgRefs } from "./debug";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";
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
export class TransformTable extends TypedObject {
  public transforms: Array<VertexTransform | null> = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.transforms = readTypedRefs(
      file,
      data,
      data.readUint16(),
      VertexTransform,
    );
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.transforms = ctx.cloneArray(this.transforms);
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

registerTypedObject("TransformTable", TransformTable);
