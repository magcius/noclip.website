import { mat4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { type DebugInfo, dbgMat4 } from "./debug";
import { type CopyContext, registerTypedObject } from "./TypedObject";
import { VertexTransform } from "./VertexTransform";

export class UserVertexTransform extends VertexTransform {
  public matrix = mat4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    for (let i = 0; i < 16; i++) {
      this.matrix[i] = data.readStdFloat();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    mat4.copy(target.matrix, this.matrix);
  }

  override getMatrix(out: mat4): void {
    mat4.copy(out, this.matrix);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("matrix", dbgMat4(this.matrix));
    return info;
  }
}

registerTypedObject("UserVertexTransform", UserVertexTransform);
