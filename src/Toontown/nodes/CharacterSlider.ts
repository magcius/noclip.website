import { registerBAMObject } from "./base";
import { MovingPartScalar } from "./MovingPartScalar";

/**
 * CharacterSlider - Morph slider for character animation
 */
export class CharacterSlider extends MovingPartScalar {}

registerBAMObject("CharacterSlider", CharacterSlider);
