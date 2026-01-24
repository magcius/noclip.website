import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgNum } from "./debug";
import type { CopyContext } from "./TypedObject";

export abstract class AnimChannelBase<T> extends AnimGroup {
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

  abstract getValue(out: T, frame: number): T;

  hasChanged(
    lastFrame: number,
    lastFrac: number,
    frame: number,
    frac: number,
  ): boolean {
    // TODO actually check if value has changed
    return lastFrame !== frame || lastFrac !== frac;
  }
}
