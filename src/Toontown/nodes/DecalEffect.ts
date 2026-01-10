import { registerBAMObject } from "./base";
import { RenderEffect } from "./RenderEffects";

/**
 * Marks a node as the base of a decal (children render on top).
 */
export class DecalEffect extends RenderEffect {}

registerBAMObject("DecalEffect", DecalEffect);
