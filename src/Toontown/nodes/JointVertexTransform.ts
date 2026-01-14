import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { CharacterJoint } from "./CharacterJoint";
import { type DebugInfo, dbgRef } from "./debug";

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
export class JointVertexTransform extends BAMObject {
  public joint: CharacterJoint | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.joint = file.getTyped(data.readObjectId(), CharacterJoint);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.joint = ctx.clone(this.joint);
  }

  /**
   * Compute the skinning matrix for this joint.
   * This should be called after the joint chain has been updated.
   */
  getSkinningMatrix(out: mat4): void {
    if (!this.joint) {
      mat4.identity(out);
      return;
    }
    // netTransform will be computed by the JointChain during animation update
    mat4.multiply(
      out,
      this.joint.netTransform,
      this.joint.initialNetTransformInverse,
    );
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("joint", dbgRef(this.joint));
    return info;
  }
}

registerBAMObject("JointVertexTransform", JointVertexTransform);
