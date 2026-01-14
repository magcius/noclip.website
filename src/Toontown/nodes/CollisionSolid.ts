import { vec3 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgFlags, dbgVec3 } from "./debug";

export const CollisionSolidFlags = {
  Tangible: 1 << 0,
  EffectiveNormal: 1 << 1,
};

export class CollisionSolid extends BAMObject {
  public flags = 0;
  public effectiveNormal = vec3.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.flags = data.readUint8();
    if (this.hasEffectiveNormal) {
      this.effectiveNormal = data.readVec3();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.flags = this.flags;
    vec3.copy(target.effectiveNormal, this.effectiveNormal);
  }

  get isTangible(): boolean {
    return (this.flags & CollisionSolidFlags.Tangible) !== 0;
  }

  get hasEffectiveNormal(): boolean {
    return (this.flags & CollisionSolidFlags.EffectiveNormal) !== 0;
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
