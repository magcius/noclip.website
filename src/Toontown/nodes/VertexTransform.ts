import { mat4 } from "gl-matrix";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo } from "./debug";

/**
 * Base class for vertex transforms used by skinning/blending.
 * Provides a default identity transform.
 */
export class VertexTransform extends BAMObject {
  getSkinningMatrix(out: mat4): void {
    mat4.identity(out);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
  }

  override getDebugInfo(): DebugInfo {
    return super.getDebugInfo();
  }
}

registerBAMObject("VertexTransform", VertexTransform);
