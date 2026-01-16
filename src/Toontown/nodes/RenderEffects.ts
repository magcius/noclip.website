import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { type DebugInfo, dbgRefs } from "./debug";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

interface RenderEffectConstructor<T extends RenderEffect> {
  new (...args: any[]): T;
}

export class RenderEffects extends TypedObject {
  public effects: RenderEffect[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    const numEffects = data.readUint16();
    this.effects = readTypedRefs(file, data, numEffects, RenderEffect);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.effects = ctx.cloneArray(this.effects);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("effects", dbgRefs(this.effects));
    return info;
  }

  /**
   * Creates a new RenderEffects instance with the given effect added.
   * Replaces existing effects of the same type.
   */
  withEffect(effect: RenderEffect) {
    const result = new RenderEffects();
    for (const existing of this.effects) {
      if (existing.constructor !== effect.constructor) {
        result.effects.push(existing);
      }
    }
    result.effects.push(effect);
    return result;
  }

  get<T extends RenderEffect>(
    attribType: RenderEffectConstructor<T>,
  ): T | null {
    const entry = this.effects.find((a) => a.constructor === attribType);
    return entry ? (entry as T) : null;
  }
}

export class RenderEffect extends TypedObject {}

registerTypedObject("RenderEffects", RenderEffects);
