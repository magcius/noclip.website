import type { AnimBundle } from "../nodes/AnimBundle";

/**
 * Controls playback of a single animation.
 *
 * Manages the current frame, play state, and loop mode.
 */
export class AnimControl {
  public readonly anim: AnimBundle;
  private _frame = 0;
  private _playing = false;
  private _looping = true;
  private _playRate = 1.0;

  constructor(anim: AnimBundle) {
    this.anim = anim;
  }

  /**
   * Start playing the animation from the beginning.
   */
  play(): void {
    this._frame = 0;
    this._playing = true;
    this._looping = false;
  }

  /**
   * Start looping the animation from the beginning.
   */
  loop(): void {
    this._frame = 0;
    this._playing = true;
    this._looping = true;
  }

  /**
   * Stop the animation at the current frame.
   */
  stop(): void {
    this._playing = false;
  }

  /**
   * Set the animation to a specific frame (stops playback).
   */
  pose(frame: number): void {
    this._frame = frame;
    this._playing = false;
  }

  /**
   * Update the animation based on elapsed time.
   */
  update(deltaTimeMs: number): void {
    if (!this._playing || this.anim.numFrames <= 0) {
      return;
    }

    // Convert time to frames
    const deltaFrames = (deltaTimeMs / 1000) * this.anim.fps * this._playRate;
    this._frame += deltaFrames;

    // Handle looping/stopping
    if (this._looping) {
      // Wrap around
      while (this._frame >= this.anim.numFrames) {
        this._frame -= this.anim.numFrames;
      }
      while (this._frame < 0) {
        this._frame += this.anim.numFrames;
      }
    } else {
      // Clamp to end
      if (this._frame >= this.anim.numFrames - 1) {
        this._frame = this.anim.numFrames - 1;
        this._playing = false;
      } else if (this._frame < 0) {
        this._frame = 0;
        this._playing = false;
      }
    }
  }

  getFrame(): number {
    return Math.floor(this._frame);
  }
}
