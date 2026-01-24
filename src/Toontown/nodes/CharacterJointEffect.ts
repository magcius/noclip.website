import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { Character } from "./Character";
import { type DebugInfo, dbgRef } from "./debug";
import { RenderEffect } from "./RenderEffects";
import { type CopyContext, registerTypedObject } from "./TypedObject";

/**
 * CharacterJointEffect - Links a node to a Character for joint transforms
 *
 * This effect associates a node with a Character so it can receive
 * joint transform updates during animation.
 */
export class CharacterJointEffect extends RenderEffect {
  public character: Character | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.character = file.getTyped(data.readObjectId(), Character);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.character = ctx.clone(this.character);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("character", dbgRef(this.character));
    return info;
  }

  static make(character: Character | null = null): CharacterJointEffect {
    const effect = new CharacterJointEffect();
    effect.character = character;
    return effect;
  }
}

registerTypedObject("CharacterJointEffect", CharacterJointEffect);
