import { vec3 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { CopyContext, registerBAMObject } from "./base";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgNum, dbgVec3 } from "./debug";

/**
 * CollisionTube - Capsule collision shape
 *
 * Renamed to CollisionCapsule in BAM 6.44, but the format is identical.
 */
export class CollisionTube extends CollisionSolid {
  public pointA = vec3.create();
  public pointB = vec3.create();
  public radius = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.pointA = data.readVec3();
    this.pointB = data.readVec3();
    this.radius = data.readFloat32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    vec3.copy(target.pointA, this.pointA);
    vec3.copy(target.pointB, this.pointB);
    target.radius = this.radius;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("pointA", dbgVec3(this.pointA));
    info.set("pointB", dbgVec3(this.pointB));
    info.set("radius", dbgNum(this.radius));
    return info;
  }
}

registerBAMObject("CollisionTube", CollisionTube);
registerBAMObject("CollisionCapsule", CollisionTube);
