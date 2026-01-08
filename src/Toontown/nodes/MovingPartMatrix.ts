import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgStr } from "./debug";
import { MovingPartBase } from "./MovingPartBase";

/**
 * MovingPartMatrix - Animated matrix part
 *
 * Stores a 4x4 transform matrix that animates.
 * Hierarchy: MovingPartMatrix -> MovingPartBase -> PartGroup
 */
export class MovingPartMatrix extends MovingPartBase {
  // MovingPart<ACMatrixSwitchType> fields - two LMatrix4f values
  public value: Float32Array = new Float32Array(16);
  public initialValue: Float32Array = new Float32Array(16);

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // MovingPart<ACMatrixSwitchType>::fillin reads two LMatrix4f
    for (let i = 0; i < 16; i++) {
      this.value[i] = data.readFloat32();
    }
    for (let i = 0; i < 16; i++) {
      this.initialValue[i] = data.readFloat32();
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgStr(`[${Array.from(this.value).join(", ")}]`));
    info.set("initialValue", dbgStr(`[${Array.from(this.initialValue).join(", ")}]`));
    return info;
  }
}

registerBAMObject("MovingPartMatrix", MovingPartMatrix);
