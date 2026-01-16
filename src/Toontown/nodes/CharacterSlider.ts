import { MovingPartScalar } from "./MovingPartScalar";
import { registerTypedObject } from "./TypedObject";

/**
 * CharacterSlider - Morph slider for character animation
 */
export class CharacterSlider extends MovingPartScalar {}

registerTypedObject("CharacterSlider", CharacterSlider);
