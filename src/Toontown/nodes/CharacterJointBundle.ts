import { registerBAMObject } from "./base";
import { PartBundle } from "./PartBundle";

export class CharacterJointBundle extends PartBundle {}

registerBAMObject("CharacterJointBundle", CharacterJointBundle);
