import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgEnum, dbgNum } from "./debug";
import { PandaNode } from "./PandaNode";

export enum PlayMode {
  Pose = 0,
  Play = 1,
  Loop = 2,
  Pingpong = 3,
}

/**
 * SequenceNode - Cycles through its children over time
 *
 * Version differences:
 * - BAM < 5.4: Simple cycle_rate + frame_offset format
 * - BAM >= 5.4: Full AnimInterface format
 */
export class SequenceNode extends PandaNode {
  // Pre-5.4 format
  public cycleRate = 0;
  public frameOffset = 0;

  // 5.4+ AnimInterface format
  public numFrames = 0;
  public frameRate = 0;
  public playMode = PlayMode.Pose;
  public startTime = 0;
  public startFrame = 0;
  public playFrames = 0;
  public fromFrame = 0;
  public toFrame = 0;
  public playRate = 1;
  public paused = true;
  public pausedFrame = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    if (this._version.compare(new AssetVersion(5, 4)) < 0) {
      // Pre-5.4: SelectiveChildNode::fillin (just PandaNode) + CData
      this.cycleRate = data.readFloat32();
      this.frameOffset = data.readFloat32();
    } else {
      // 5.4+: AnimInterface::fillin
      this.numFrames = data.readInt32();

      // AnimInterface CData
      this.frameRate = data.readFloat32();
      this.playMode = data.readUint8() as PlayMode;
      this.startTime = data.readFloat32();
      this.startFrame = data.readFloat32();
      this.playFrames = data.readFloat32();
      this.fromFrame = data.readInt32();
      this.toFrame = data.readInt32();
      this.playRate = data.readFloat32();
      this.paused = data.readBool();
      this.pausedFrame = data.readFloat32();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.cycleRate = this.cycleRate;
    target.frameOffset = this.frameOffset;
    target.numFrames = this.numFrames;
    target.frameRate = this.frameRate;
    target.playMode = this.playMode;
    target.startTime = this.startTime;
    target.startFrame = this.startFrame;
    target.playFrames = this.playFrames;
    target.fromFrame = this.fromFrame;
    target.toFrame = this.toFrame;
    target.playRate = this.playRate;
    target.paused = this.paused;
    target.pausedFrame = this.pausedFrame;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    if (this._version.compare(new AssetVersion(5, 4)) < 0) {
      info.set("cycleRate", dbgNum(this.cycleRate));
      info.set("frameOffset", dbgNum(this.frameOffset));
    } else {
      info.set("frameRate", dbgNum(this.frameRate));
      info.set("playMode", dbgEnum(this.playMode, PlayMode));
      info.set("startTime", dbgNum(this.startTime));
      info.set("startFrame", dbgNum(this.startFrame));
      info.set("playFrames", dbgNum(this.playFrames));
      info.set("fromFrame", dbgNum(this.fromFrame));
      info.set("toFrame", dbgNum(this.toFrame));
      info.set("playRate", dbgNum(this.playRate));
      info.set("paused", dbgBool(this.paused));
      info.set("pausedFrame", dbgNum(this.pausedFrame));
    }
    return info;
  }
}

registerBAMObject("SequenceNode", SequenceNode);
