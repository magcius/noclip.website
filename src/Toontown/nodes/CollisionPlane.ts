import { vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { CopyContext, registerBAMObject } from "./base";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgVec4 } from "./debug";

export class CollisionPlane extends CollisionSolid {
  public plane = vec4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.plane = data.readVec4();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    vec4.copy(target.plane, this.plane);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("plane", dbgVec4(this.plane));
    return info;
  }
}

registerBAMObject("CollisionPlane", CollisionPlane);
