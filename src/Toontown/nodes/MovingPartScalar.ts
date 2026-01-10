import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";
import { MovingPartBase } from "./MovingPartBase";

/**
 * Animated scalar part
 */
export class MovingPartScalar extends MovingPartBase {
  public value = 0;
  public initialValue = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.value = data.readFloat32();
    this.initialValue = data.readFloat32();
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.value = this.value;
    target.initialValue = this.initialValue;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgNum(this.value));
    info.set("initialValue", dbgNum(this.initialValue));
    return info;
  }
}

registerBAMObject("MovingPartScalar", MovingPartScalar);
