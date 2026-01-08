import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";
import { MovingPartBase } from "./MovingPartBase";

/**
 * MovingPartScalar - Animated scalar part
 *
 * Stores a single floating-point value that animates.
 * Hierarchy: MovingPartScalar -> MovingPartBase -> PartGroup
 */
export class MovingPartScalar extends MovingPartBase {
  // MovingPart<ACScalarSwitchType> fields - two float values
  public value: number = 0;
  public initialValue: number = 0;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // MovingPart<ACScalarSwitchType>::fillin reads value and initial_value
    this.value = data.readFloat32();
    this.initialValue = data.readFloat32();
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("value", dbgNum(this.value));
    info.set("initialValue", dbgNum(this.initialValue));
    return info;
  }
}

registerBAMObject("MovingPartScalar", MovingPartScalar);
