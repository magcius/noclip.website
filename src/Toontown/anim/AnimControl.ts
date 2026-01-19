import { getFrameTime } from "../Common";
import type { PartBundle } from "../nodes";
import type { AnimBundle } from "../nodes/AnimBundle";
import type { AnimChannelBase } from "../nodes/AnimChannelBase";

export enum PlayMode {
  Pose,
  Play,
  Loop,
  PingPong,
}

/**
 * Controls playback of a single animation.
 *
 * Manages the current frame, play state, and loop mode.
 */
export class AnimControl {
  private _anim: AnimBundle;
  private _channelIndex: number;

  private _frameRate = 0;
  private _playMode = PlayMode.Pose;
  private _startTime = 0;
  private _startFrame = 0;
  private _playFrames = 0;
  private _fromFrame = 0;
  private _toFrame = 0;
  private _playRate = 1.0;
  private _effectiveFrameRate = 0;
  private _paused = false;
  private _pausedF = 0;

  private _markedFrame = -1;
  private _markedFrac = 0;

  constructor(private _part: PartBundle) {}

  setupAnim(anim: AnimBundle, channelIndex: number): void {
    this._anim = anim;
    this._channelIndex = channelIndex;
    this.setRate(this._anim.fps, 1);
    this._markedFrame = -1;
  }

  get channelIndex(): number {
    return this._channelIndex;
  }

  play(from?: number, to?: number): void {
    if (from === undefined) from = 0;
    if (to === undefined) to = this._anim.numFrames - 1;
    if (from >= to) {
      this.pose(from);
      return;
    }

    this._playMode = PlayMode.Play;
    this._startTime = getFrameTime();
    this._startFrame = from;
    this._playFrames = to - from + 1;
    this._fromFrame = Math.floor(from);
    this._toFrame = Math.floor(to);
    this._paused = false;
    this._pausedF = 0;

    if (this._effectiveFrameRate < 0) {
      this._startTime -= this._playFrames / this._effectiveFrameRate;
    }

    // Notify the part that an animation has been started
    this._part.controlActivated(this);
  }

  loop(restart = true, from?: number, to?: number): void {
    if (from === undefined) from = 0;
    if (to === undefined) to = this._anim.numFrames - 1;
    if (from >= to) {
      this.pose(from);
      return;
    }

    let fframe = this.getFullFFrame();
    this._playMode = PlayMode.Loop;
    this._startTime = getFrameTime();
    this._startFrame = from;
    this._playFrames = to - from + 1;
    this._fromFrame = Math.floor(from);
    this._toFrame = Math.floor(to);
    this._pausedF = 0;

    if (!restart) {
      fframe = Math.min(Math.max(fframe, from), to);
      if (this._paused) {
        this._pausedF = fframe - this._startFrame;
      } else {
        this._startTime -=
          (fframe - this._startFrame) / this._effectiveFrameRate;
      }
    }

    // Notify the part that an animation has been started
    this._part.controlActivated(this);
  }

  /**
   * Stop the animation at the current frame.
   */
  stop(): void {
    const frame = this.getFullFFrame();
    this._playMode = PlayMode.Pose;
    this._startTime = getFrameTime();
    this._startFrame = frame;
    this._playFrames = 0;
    this._fromFrame = Math.floor(frame);
    this._toFrame = Math.floor(frame);
    this._pausedF = 0;

    // Do not activate the control
  }

  /**
   * Set the animation to a specific frame (stops playback).
   */
  pose(frame: number): void {
    this._playMode = PlayMode.Pose;
    this._startTime = getFrameTime();
    this._startFrame = frame;
    this._playFrames = 0;
    this._fromFrame = Math.floor(frame);
    this._toFrame = Math.floor(frame);
    this._pausedF = 0;

    // Notify the part that an animation has been started
    this._part.controlActivated(this);
  }

  get frame(): number {
    const numFrames = this._anim.numFrames;
    if (numFrames <= 0) return 0;
    return this.getFullFrame(0) % numFrames;
  }

  get nextFrame(): number {
    const numFrames = this._anim.numFrames;
    if (numFrames <= 0) return 0;
    return this.getFullFrame(1) % numFrames;
  }

  get frac(): number {
    return this.getFullFFrame() - this.getFullFrame(0);
  }

  get frameRate(): number {
    return this._frameRate;
  }

  get numFrames(): number {
    return this._anim?.numFrames ?? 0;
  }

  getFullFrame(increment: number): number {
    let frame = Math.floor(this.getFullFFrame()) + increment;
    if (this._playMode === PlayMode.Play) {
      frame = Math.min(Math.max(frame, this._fromFrame), this._toFrame);
    }
    return frame;
  }

  getFullFFrame(): number {
    switch (this._playMode) {
      case PlayMode.Pose:
        return this._startFrame;
      case PlayMode.Play:
        return (
          Math.min(Math.max(this.getF(), 0), this._playFrames) +
          this._startFrame
        );
      case PlayMode.Loop:
        return (this.getF() % this._playFrames) + this._startFrame;
      case PlayMode.PingPong: {
        const f = this.getF() % (this._playFrames * 2);
        return f > this._playFrames
          ? this._playFrames * 2 - f + this._startFrame
          : f + this._startFrame;
      }
    }
  }

  /**
   * Returns the floating-point frame number elapsed since the animation started.
   */
  getF(): number {
    if (this._paused) return this._pausedF;
    const now = getFrameTime();
    const elapsed = now - this._startTime;
    return elapsed * this._effectiveFrameRate;
  }

  markChannels(frameBlendFlag: boolean): void {
    this._markedFrame = this.frame;
    this._markedFrac = frameBlendFlag ? this.frac : 0;
  }

  channelHasChanged(
    channel: AnimChannelBase<unknown>,
    frameBlendFlag: boolean,
  ): boolean {
    if (this._markedFrame < 0) return true;
    return channel.hasChanged(
      this._markedFrame,
      this._markedFrac,
      this.frame,
      frameBlendFlag ? this.frac : 0,
    );
  }

  setRate(frameRate?: number, playRate?: number): void {
    if (frameRate === undefined) frameRate = this._anim.fps;
    if (playRate === undefined) playRate = 1;
    const f = this.getF();
    this._frameRate = frameRate;
    this._playRate = playRate;
    this._effectiveFrameRate = this._frameRate * this._playRate;
    if (this._effectiveFrameRate === 0) {
      this._paused = true;
      this._pausedF = f;
    } else {
      const newElapsed = f / this._effectiveFrameRate;
      const now = getFrameTime();
      this._startTime = now - newElapsed;
      this._paused = false;
    }
  }
}
