import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";
import { RenderEffect } from "./RenderEffects";

/**
 * CharacterJointEffect - Links a node to a Character for joint transforms
 *
 * This effect associates a node with a Character so it can receive
 * joint transform updates during animation.
 */
export class CharacterJointEffect extends RenderEffect {
  public characterRef = 0; // TODO is this a circular ref?

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.characterRef = data.readObjectId();
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    // target.characterRef = ? TODO
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("characterRef", dbgNum(this.characterRef));
    return info;
  }
}

registerBAMObject("CharacterJointEffect", CharacterJointEffect);
