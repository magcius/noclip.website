import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import type { DebugInfo } from "./debug";
import { MovingPartScalar } from "./MovingPartScalar";

/**
 * CharacterSlider - Morph slider for character animation
 *
 * This is a MovingPartScalar that controls morph target weights.
 * The hierarchy is: CharacterSlider -> MovingPartScalar -> MovingPartBase -> PartGroup
 *
 * CharacterSlider has no additional BAM fields beyond MovingPartScalar.
 */
export class CharacterSlider extends MovingPartScalar {
  constructor(objectId: number, file: BAMFile, data: DataStream) {
    // Parent reads: PartGroup (name, freeze-joint, children), MovingPartBase (forcedChannelRef),
    // MovingPartScalar (value, initialValue)
    super(objectId, file, data);
    // CharacterSlider has no additional BAM data
  }

  override getDebugInfo(): DebugInfo {
    // All fields are handled by parent classes
    return super.getDebugInfo();
  }
}

registerBAMObject("CharacterSlider", CharacterSlider);
