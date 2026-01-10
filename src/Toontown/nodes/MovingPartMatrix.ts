import { mat4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgStr } from "./debug";
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

  override copyTo(target: this): void {
    super.copyTo(target);
    target.value = this.value; // Shared
    target.initialValue = this.initialValue; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgStr(`[${Array.from(this.value).join(", ")}]`));
    info.set(
      "initialValue",
      dbgStr(`[${Array.from(this.initialValue).join(", ")}]`),
    );
    return info;
  }
}

registerBAMObject("MovingPartMatrix", MovingPartMatrix);
