import { vec3 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { type CopyContext, registerBAMObject } from "./base";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgNum, dbgVec3 } from "./debug";

export class CollisionSphere extends CollisionSolid {
  public center = vec3.create();
  public radius = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.center = data.readVec3();
    this.radius = data.readFloat32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    vec3.copy(target.center, this.center);
    target.radius = this.radius;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("center", dbgVec3(this.center));
    info.set("radius", dbgNum(this.radius));
    return info;
  }
}

registerBAMObject("CollisionSphere", CollisionSphere);
