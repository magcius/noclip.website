import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";

/**
 * CharacterJointEffect - Links a node to a Character for joint transforms
 *
 * This effect associates a node with a Character so it can receive
 * joint transform updates during animation.
 */
export class CharacterJointEffect extends BAMObject {
  public characterRef: number = 0;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);
    this.characterRef = data.readObjectId();
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("characterRef", dbgRef(this.characterRef));
    return info;
  }
}

registerBAMObject("CharacterJointEffect", CharacterJointEffect);
