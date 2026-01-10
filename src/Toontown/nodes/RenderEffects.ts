import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, readTypedRefs, registerBAMObject } from "./base";
import { type DebugInfo, dbgRefs } from "./debug";

export class RenderEffects extends BAMObject {
  public effects: RenderEffect[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    const numEffects = data.readUint16();
    this.effects = readTypedRefs(file, data, numEffects, RenderEffect);
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.effects = this.effects.map((o) => o.clone());
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
      if (existing.constructor.name !== effect.constructor.name) {
        result.effects.push(existing);
      }
    }
    result.effects.push(effect);
    return result;
  }
}

export class RenderEffect extends BAMObject {}

registerBAMObject("RenderEffects", RenderEffects);
