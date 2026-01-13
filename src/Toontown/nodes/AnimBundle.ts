import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { AnimGroup } from "./AnimGroup";
import { CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";

/**
 * Root of an animation hierarchy.
 *
 * Contains the base frame rate and frame count for an animation.
 */
export class AnimBundle extends AnimGroup {
  public fps = 0;
  public numFrames = 0;

  constructor() {
    super();
    this.root = this;
  }

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.fps = data.readFloat32();
    this.numFrames = data.readUint16();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.fps = this.fps;
    target.numFrames = this.numFrames;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("fps", dbgNum(this.fps));
    info.set("numFrames", dbgNum(this.numFrames));
    return info;
  }
}

registerBAMObject("AnimBundle", AnimBundle);
