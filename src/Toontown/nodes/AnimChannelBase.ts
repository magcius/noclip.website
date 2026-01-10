import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgNum } from "./debug";

export class AnimChannelBase extends AnimGroup {
  public lastFrame = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.lastFrame = data.readUint16();
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.lastFrame = this.lastFrame;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("lastFrame", dbgNum(this.lastFrame));
    return info;
  }
}
