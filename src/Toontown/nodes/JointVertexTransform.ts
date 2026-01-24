import { mat4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { CharacterJoint } from "./CharacterJoint";
import { type DebugInfo, dbgRef } from "./debug";
import { type CopyContext, registerTypedObject } from "./TypedObject";
import { VertexTransform } from "./VertexTransform";

/**
 * Provides the skinning matrix for vertices bound to a joint.
 *
 * The skinning matrix transforms vertices from bind pose to current
 * animated pose:
 *   skinMatrix = joint.initialNetTransformInverse * joint.netTransform
 *
 * BAM format:
 * - Pointer to CharacterJoint
 */
export class JointVertexTransform extends VertexTransform {
  public joint: CharacterJoint | null = null;

  private _matrix = mat4.create();
  private _matrixStale = true;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.joint = file.getTyped(data.readObjectId(), CharacterJoint);

    // Register this vertex transform with the joint
    if (this.joint) this.joint.vertexTransforms.push(this);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.joint = ctx.clone(this.joint);

    // Register this vertex transform with the joint
    if (target.joint) target.joint.vertexTransforms.push(target);
  }

  override getMatrix(out: mat4): void {
    if (!this.joint) {
      mat4.identity(out);
      return;
    }
    if (this._matrixStale) {
      mat4.multiply(
        this._matrix,
        this.joint.netTransform,
        this.joint.initialNetTransformInverse,
      );
      this._matrixStale = false;
    }
    mat4.copy(out, this._matrix);
  }

  override markModified(): void {
    this._matrixStale = true;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("joint", dbgRef(this.joint));
    return info;
  }
}

registerTypedObject("JointVertexTransform", JointVertexTransform);
