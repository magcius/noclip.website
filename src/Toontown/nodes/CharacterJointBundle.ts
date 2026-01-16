import { PartBundle } from "./PartBundle";
import { registerTypedObject } from "./TypedObject";

export class CharacterJointBundle extends PartBundle {}

registerTypedObject("CharacterJointBundle", CharacterJointBundle);
