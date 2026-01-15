import { vec3 } from "gl-matrix";
import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { type CopyContext, registerBAMObject } from "./base";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgVec3 } from "./debug";

export class CollisionBox extends CollisionSolid {
  public center = vec3.create();
  public min = vec3.create();
  public max = vec3.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.center = data.readVec3();
    this.min = data.readVec3();
    this.max = data.readVec3();

    for (let i = 0; i < 8; i++) {
      data.readVec3();
    }

    data.readFloat32();
    data.readFloat32();
    data.readFloat32();
    data.readFloat32();

    for (let i = 0; i < 6; i++) {
      data.readVec4();
    }

    for (let i = 0; i < 6; i++) {
      data.readMat4();
    }

    for (let i = 0; i < 6; i++) {
      const size = data.readUint16();
      for (let j = 0; j < size; j++) {
        data.readVec2();
        data.readVec2();
      }
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    vec3.copy(target.center, this.center);
    vec3.copy(target.min, this.min);
    vec3.copy(target.max, this.max);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("center", dbgVec3(this.center));
    info.set("min", dbgVec3(this.min));
    info.set("max", dbgVec3(this.max));
    return info;
  }
}

registerBAMObject("CollisionBox", CollisionBox);
