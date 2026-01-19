import { getFrameTime } from "../Common";
import { intervalManager } from "./IntervalManager";

export enum State {
  Initial,
  Started,
  Paused,
  Final,
}

/**
 * Base class for all intervals.
 *
 * An interval represents an action that takes place over a period of time.
 * The interval system provides a way to sequence and compose these actions.
 */
export abstract class Interval {
  protected _state = State.Initial;
  protected _currT = 0;
  protected _duration: number;
  protected _name: string;
  protected _openEnded: boolean;

  // Playback state (managed by stepPlay)
  private _clockStart = 0;
  private _startT = 0;
  private _endT = 0;
  private _playRate = 1.0;
  private _doLoop = false;
  private _loopCount = 0;

  constructor(name: string, duration: number, openEnded: boolean) {
    this._name = name;
    this._duration = Math.max(0, duration);
    this._endT = this._duration;
    this._openEnded = openEnded;
  }

  get name(): string {
    return this._name;
  }

  get duration(): number {
    return this._duration;
  }

  get openEnded(): boolean {
    return this._openEnded;
  }

  get state(): State {
    return this._state;
  }

  get t(): number {
    return this._currT;
  }

  isStopped(): boolean {
    return this._state === State.Initial || this._state === State.Final;
  }

  isPaused(): boolean {
    return this._state === State.Paused;
  }

  /**
   * Start playing the interval once.
   */
  start(startT = 0, endT = -1, playRate = 1): void {
    this.setupPlay(startT, endT, playRate, false);
    intervalManager.addInterval(this);
  }

  /**
   * Start playing the interval in a loop.
   */
  loop(startT = 0, endT = -1, playRate = 1): void {
    this.setupPlay(startT, endT, playRate, true);
    intervalManager.addInterval(this);
  }

  /**
   * Pause the interval and return the current time.
   */
  pause(): number {
    if (this._state === State.Started) {
      this.privInterrupt();
    }
    intervalManager.removeInterval(this);
    return this._currT;
  }

  /**
   * Resume playing from the current time or a specified time.
   */
  resume(startT?: number): void {
    if (startT !== undefined) {
      this.setT(startT);
    }
    this.setupResume();
    intervalManager.addInterval(this);
  }

  /**
   * Immediately finish the interval, jumping to the end state.
   */
  finish(): void {
    if (this._state === State.Initial) {
      this.privInstant();
    } else if (this._state !== State.Final) {
      this.privFinalize();
    }
    intervalManager.removeInterval(this);
  }

  /**
   * Set the interval to a specific time (for scrubbing/debugging).
   */
  setT(t: number): void {
    if (this._state === State.Initial) {
      this.privInitialize(t);
      this.privInterrupt();
    } else if (this._state === State.Started) {
      this.privStep(t);
    } else if (this._state === State.Paused) {
      this.privStep(t);
      this.privInterrupt();
    } else {
      // State.Final
      this.privReverseInitialize(t);
      this.privInterrupt();
    }
  }

  /**
   * Reset the interval to its initial state.
   */
  clearToInitial(): void {
    this.pause();
    this._state = State.Initial;
    this._currT = 0;
  }

  // === Internal: Override these in subclasses ===

  /** Called when the interval first starts playing. */
  privInitialize(t: number): void {
    this._state = State.Started;
    this.privStep(t);
  }

  /** Called each frame while the interval is playing. */
  privStep(t: number): void {
    this._state = State.Started;
    this._currT = t;
  }

  /** Called when the interval reaches its end. */
  privFinalize(): void {
    this.privStep(this._duration);
    this._state = State.Final;
  }

  /** Called when the interval is played instantly (skipped). */
  privInstant(): void {
    this._state = State.Started;
    this.privStep(this._duration);
    this._state = State.Final;
  }

  /** Called when the interval is paused. */
  privInterrupt(): void {
    this._state = State.Paused;
  }

  /** Called when playing backwards from the end. */
  privReverseInitialize(t: number): void {
    this._state = State.Started;
    this.privStep(t);
  }

  /** Called when playing backwards reaches the start. */
  privReverseFinalize(): void {
    this.privStep(0);
    this._state = State.Initial;
  }

  // === Playback mechanics (called by IntervalManager) ===

  /**
   * Set up playback parameters.
   */
  setupPlay(
    startT: number,
    endT: number,
    playRate: number,
    doLoop: boolean,
  ): void {
    this._startT = Math.max(0, startT);
    this._endT = endT < 0 ? this._duration : Math.min(endT, this._duration);
    this._playRate = playRate;
    this._doLoop = doLoop;
    this._loopCount = 0;
    this._clockStart = getFrameTime();
  }

  /**
   * Set up to resume from the current time.
   */
  setupResume(): void {
    const now = getFrameTime();
    if (this._playRate > 0) {
      this._clockStart = now - (this._currT - this._startT) / this._playRate;
    } else if (this._playRate < 0) {
      this._clockStart = now - (this._currT - this._endT) / this._playRate;
    }
    this._loopCount = 0;
  }

  /**
   * Called by IntervalManager each frame.
   * Returns false when the interval is done and should be removed.
   */
  stepPlay(): boolean {
    const now = getFrameTime();
    const elapsed = (now - this._clockStart) * this._playRate;

    if (this._playRate >= 0) {
      const t = elapsed + this._startT;

      if (t < this._endT) {
        // In the middle of the interval
        if (this.isStopped()) {
          this.privInitialize(t);
        } else {
          this.privStep(t);
        }
      } else {
        // Past the end
        if (this.isStopped()) {
          if (this._openEnded || this._loopCount !== 0) {
            this.privInstant();
          }
        } else {
          this.privFinalize();
        }

        if (this._endT === this._startT) {
          this._loopCount++;
        } else {
          // Determine number of loops
          const loopDuration = (this._endT - this._startT) / this._playRate;
          const numLoops = Math.floor((now - this._clockStart) / loopDuration);
          this._loopCount += numLoops;
          this._clockStart += loopDuration * numLoops;
        }
      }
    } else {
      // Reverse playback (negative play rate)
      const t = elapsed + this._endT;

      if (t >= this._startT) {
        // In the middle of the interval
        if (this.isStopped()) {
          this.privReverseInitialize(t);
        } else {
          this.privStep(t);
        }
      } else {
        // Past the start (playing backwards)
        if (this.isStopped()) {
          if (this._openEnded || this._loopCount !== 0) {
            this.privInstant();
          }
        } else {
          this.privReverseFinalize();
        }

        if (this._endT === this._startT) {
          this._loopCount++;
        } else {
          // Determine number of loops
          const loopDuration = (this._endT - this._startT) / -this._playRate;
          const numLoops = Math.floor((now - this._clockStart) / loopDuration);
          this._loopCount += numLoops;
          this._clockStart += loopDuration * numLoops;
        }
      }
    }

    const shouldContinue = this._loopCount === 0 || this._doLoop;
    if (!shouldContinue && this._state === State.Started) {
      this.privInterrupt();
    }
    return shouldContinue;
  }
}
