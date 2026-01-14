import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { AnimGroup } from "./AnimGroup";
import type { CopyContext } from "./base";
import { type DebugInfo, dbgNum } from "./debug";

export class AnimChannelBase extends AnimGroup {
  public lastFrame = -1;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.lastFrame = data.readUint16();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.lastFrame = this.lastFrame;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("lastFrame", dbgNum(this.lastFrame));
    return info;
  }
}
