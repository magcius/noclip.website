import { mat4 } from "gl-matrix";
import type { DebugInfo } from "./debug";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

/**
 * Base class for vertex transforms used by skinning/blending.
 * Provides a default identity transform.
 */
export class VertexTransform extends TypedObject {
  getMatrix(out: mat4): void {
    mat4.identity(out);
  }

  markModified(): void {}

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
  }

  override getDebugInfo(): DebugInfo {
    return super.getDebugInfo();
  }
}

registerTypedObject("VertexTransform", VertexTransform);
