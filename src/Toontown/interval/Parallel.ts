import { Interval, State } from "./Interval";

let parNum = 0;

/**
 * A meta-interval that plays child intervals simultaneously.
 *
 * All child intervals start at the same time. The duration of the Parallel
 * is the maximum duration of all children.
 */
export class Parallel extends Interval {
  private _intervals: Interval[];

  constructor(intervals: Interval[], name?: string) {
    const parName = name ?? `Parallel-${parNum++}`;
    // Duration is max of all children
    const duration = Math.max(0, ...intervals.map((i) => i.duration));
    super(parName, duration, true);
    this._intervals = intervals;
  }

  override privInitialize(t: number): void {
    // Reset and initialize all child intervals
    for (const ival of this._intervals) {
      ival.clearToInitial();
      if (t >= ival.duration) {
        ival.privInstant();
      } else {
        ival.privInitialize(t);
      }
    }
    this._state = State.Started;
    this._currT = t;
  }

  override privStep(t: number): void {
    // Step all active children
    for (const ival of this._intervals) {
      if (ival.state === State.Started) {
        if (t >= ival.duration) {
          // Child interval has finished
          ival.privFinalize();
        } else {
          ival.privStep(t);
        }
      }
    }
    this._state = State.Started;
    this._currT = t;
  }

  override privFinalize(): void {
    // Finalize any children that haven't finished yet
    for (const ival of this._intervals) {
      if (ival.state !== State.Final) {
        ival.privFinalize();
      }
    }
    this._state = State.Final;
    this._currT = this._duration;
  }

  override privInstant(): void {
    // Instantly complete all child intervals
    for (const ival of this._intervals) {
      ival.privInstant();
    }
    this._state = State.Final;
    this._currT = this._duration;
  }

  override privInterrupt(): void {
    // Interrupt all active child intervals
    for (const ival of this._intervals) {
      if (ival.state === State.Started) {
        ival.privInterrupt();
      }
    }
    this._state = State.Paused;
  }
}
