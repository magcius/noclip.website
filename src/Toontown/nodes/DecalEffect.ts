import { RenderEffect } from "./RenderEffects";
import { registerTypedObject } from "./TypedObject";

/**
 * Marks a node as the base of a decal (children render on top).
 */
export class DecalEffect extends RenderEffect {}

registerTypedObject("DecalEffect", DecalEffect);
