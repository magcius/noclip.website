import { Interval, State } from "./Interval";

let seqNum = 0;

interface PlaybackEvent {
  /** Time when this event fires (in seconds from sequence start) */
  time: number;
  /** Index of the child interval */
  intervalIndex: number;
  /** Type of event */
  type: "begin" | "end";
}

/**
 * A meta-interval that plays child intervals one after another.
 *
 * The duration of the Sequence is the sum of all child durations.
 */
export class Sequence extends Interval {
  private _intervals: Interval[];
  private _events: PlaybackEvent[] = [];
  private _intervalStartTimes: number[] = [];
  private _activeIntervals = new Set<number>();
  private _eventIndex = 0;

  constructor(intervals: Interval[], name?: string) {
    const seqName = name ?? `Sequence-${seqNum++}`;
    super(seqName, 0, true); // Duration calculated in buildTimeline

    this._intervals = intervals;
    this.buildTimeline();
  }

  private buildTimeline(): void {
    this._events = [];
    this._intervalStartTimes = [];
    let currentTime = 0;

    for (let i = 0; i < this._intervals.length; i++) {
      const ival = this._intervals[i];
      const startTime = currentTime;
      const endTime = startTime + ival.duration;

      this._intervalStartTimes.push(startTime);
      this._events.push({ time: startTime, intervalIndex: i, type: "begin" });
      this._events.push({ time: endTime, intervalIndex: i, type: "end" });

      currentTime = endTime;
    }

    // Sort by time
    this._events.sort((a, b) => a.time - b.time);

    this._duration = currentTime;
  }

  override privInitialize(t: number): void {
    this._eventIndex = 0;
    this._activeIntervals.clear();

    // Reset all child intervals
    for (const ival of this._intervals) {
      ival.clearToInitial();
    }

    this._state = State.Started;
    this.privStep(t);
  }

  override privStep(t: number): void {
    // Process all events up to time t
    while (this._eventIndex < this._events.length) {
      const event = this._events[this._eventIndex];
      if (event.time > t) break;

      const ival = this._intervals[event.intervalIndex];

      if (event.type === "begin") {
        // Initialize the child interval
        const relT = t - this._intervalStartTimes[event.intervalIndex];
        if (relT >= ival.duration) {
          ival.privInstant();
        } else {
          ival.privInitialize(relT);
          this._activeIntervals.add(event.intervalIndex);
        }
      } else {
        // Finalize the child interval
        if (ival.state !== State.Final) {
          ival.privFinalize();
        }
        this._activeIntervals.delete(event.intervalIndex);
      }

      this._eventIndex++;
    }

    // Step all currently active intervals
    for (const idx of this._activeIntervals) {
      const ival = this._intervals[idx];
      const relT = t - this._intervalStartTimes[idx];
      if (ival.state === State.Started) {
        ival.privStep(relT);
      }
    }

    this._state = State.Started;
    this._currT = t;
  }

  override privFinalize(): void {
    // Finalize all remaining active intervals
    for (const idx of this._activeIntervals) {
      const ival = this._intervals[idx];
      if (ival.state !== State.Final) {
        ival.privFinalize();
      }
    }
    this._activeIntervals.clear();

    // Ensure all intervals are finalized (in case some were never started)
    for (const ival of this._intervals) {
      if (ival.state !== State.Final) {
        ival.privInstant();
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
    for (const idx of this._activeIntervals) {
      const ival = this._intervals[idx];
      if (ival.state === State.Started) {
        ival.privInterrupt();
      }
    }
    this._state = State.Paused;
  }
}
