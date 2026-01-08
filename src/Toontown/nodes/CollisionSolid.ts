import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgFlags, dbgVec3 } from "./debug";

// CollisionSolid flags
const F_TANGIBLE = 1 << 0;
const F_EFFECTIVE_NORMAL = 1 << 1;

const CollisionSolidFlags = {
  Tangible: F_TANGIBLE,
  EffectiveNormal: F_EFFECTIVE_NORMAL,
};

export class CollisionSolid extends BAMObject {
  public flags: number;
  public effectiveNormal: [number, number, number] = [0, 0, 0];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.flags = data.readUint8();
    if (this.hasEffectiveNormal) {
      this.effectiveNormal = data.readVec3();
    }
  }

  get isTangible(): boolean {
    return (this.flags & F_TANGIBLE) !== 0;
  }

  get hasEffectiveNormal(): boolean {
    return (this.flags & F_EFFECTIVE_NORMAL) !== 0;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("flags", dbgFlags(this.flags, CollisionSolidFlags));
    if (this.hasEffectiveNormal) {
      info.set("effectiveNormal", dbgVec3(this.effectiveNormal));
    }
    return info;
  }
}

registerBAMObject("CollisionSolid", CollisionSolid);
