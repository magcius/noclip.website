import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgMat4, dbgStr } from "./debug";
import { MovingPartBase } from "./MovingPartBase";

/**
 * Animated matrix part
 */
export class MovingPartMatrix extends MovingPartBase {
  public value = mat4.create();
  public initialValue = mat4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.value = data.readMat4();
    this.initialValue = data.readMat4();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    mat4.copy(target.value, this.value);
    mat4.copy(target.initialValue, this.initialValue);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgMat4(this.value));
    info.set("initialValue", dbgMat4(this.initialValue));
    return info;
  }
}

registerBAMObject("MovingPartMatrix", MovingPartMatrix);
