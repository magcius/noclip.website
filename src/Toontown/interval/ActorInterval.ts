import type { AnimControl } from "../anim/AnimControl";
import { Interval, State } from "./Interval";

let animNum = 0;

export interface ActorIntervalOptions {
  /** Name of this interval. Auto-generated if not specified. */
  name?: string;
  /** First frame to play. Defaults to 0. */
  startFrame?: number;
  /** Last frame to play. Defaults to last frame of animation. */
  endFrame?: number;
  /** Duration in seconds. If not specified, calculated from frame count and rate. */
  duration?: number;
  /** Playback rate multiplier. Negative values play in reverse. Defaults to 1. */
  playRate?: number;
  /** If true, loop the animation within the frame range. Defaults to false. */
  loop?: boolean;
  /** If true, loop only within startFrame/endFrame range. Defaults to false. */
  constrainedLoop?: boolean;
}

/**
 * An interval that plays an animation on an actor frame-by-frame.
 *
 * Unlike AnimControl.play(), this gives the interval system precise control
 * over animation timing by computing frames from normalized time and calling
 * pose() each frame.
 */
export class ActorInterval extends Interval {
  private _controls: AnimControl[];
  private _startFrame: number;
  private _endFrame: number;
  private _numFrames: number;
  private _frameRate: number;
  private _reverse: boolean;
  private _loopAnim: boolean;
  private _constrainedLoop: boolean;
  private _implicitDuration: boolean;

  constructor(
    controls: AnimControl | AnimControl[],
    options: ActorIntervalOptions = {},
  ) {
    const controlArray = Array.isArray(controls) ? controls : [controls];

    if (controlArray.length === 0) {
      throw new Error("ActorInterval requires at least one AnimControl");
    }

    const id = `Actor-${animNum++}`;
    const name = options.name ?? id;

    // Get animation properties from first control
    const control = controlArray[0];
    const baseFrameRate = control.frameRate;
    const playRate = options.playRate ?? 1;
    const frameRate = baseFrameRate * Math.abs(playRate);

    // Calculate frame range
    let startFrame = options.startFrame ?? 0;
    let endFrame = options.endFrame ?? control.numFrames - 1;

    // Handle reverse playback (negative rate or endFrame < startFrame)
    let reverse = playRate < 0;
    if (endFrame < startFrame) {
      reverse = true;
      [startFrame, endFrame] = [endFrame, startFrame];
    }

    const numFrames = endFrame - startFrame + 1;

    // Calculate duration
    const implicitDuration = options.duration === undefined;
    const duration =
      options.duration ?? (frameRate > 0 ? numFrames / frameRate : 0);

    super(name, duration, true);

    this._controls = controlArray;
    this._startFrame = startFrame;
    this._endFrame = endFrame;
    this._numFrames = numFrames;
    this._frameRate = frameRate;
    this._reverse = reverse;
    this._loopAnim = options.loop ?? false;
    this._constrainedLoop = options.constrainedLoop ?? false;
    this._implicitDuration = implicitDuration;
  }

  override privStep(t: number): void {
    // t is time in seconds, convert to frame count
    let frameCount = t * this._frameRate;

    if (this._constrainedLoop) {
      frameCount = frameCount % this._numFrames;
    }

    let absFrame: number;
    if (this._reverse) {
      absFrame = this._endFrame - frameCount;
    } else {
      absFrame = this._startFrame + frameCount;
    }

    // Pose each control
    for (const control of this._controls) {
      const numFrames = control.numFrames;
      let frame: number;

      if (this._loopAnim) {
        const intFrame = Math.floor(absFrame + 0.0001);
        frame = (intFrame % numFrames) + (absFrame - intFrame);
      } else {
        frame = Math.max(0, Math.min(absFrame, numFrames - 1));
      }

      control.pose(frame);
    }

    this._state = State.Started;
    this._currT = t;
  }

  override privFinalize(): void {
    if (this._implicitDuration && !this._loopAnim) {
      // Snap to final frame to avoid rounding errors
      const finalFrame = this._reverse ? this._startFrame : this._endFrame;
      for (const control of this._controls) {
        control.pose(finalFrame);
      }
    } else {
      this.privStep(this._duration);
    }
    this._state = State.Final;
  }
}
