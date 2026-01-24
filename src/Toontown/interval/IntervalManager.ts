import type { Interval } from "./Interval";

/**
 * Manages active intervals and steps them each frame.
 */
export class IntervalManager {
  private _intervals = new Map<string, Interval>();

  /**
   * Add an interval to be managed.
   * If an interval with the same name exists, it is replaced.
   */
  addInterval(interval: Interval): void {
    this._intervals.set(interval.name, interval);
  }

  /**
   * Remove an interval from management.
   */
  removeInterval(interval: Interval): void {
    this._intervals.delete(interval.name);
  }

  /**
   * Find an interval by name.
   */
  findInterval(name: string): Interval | undefined {
    return this._intervals.get(name);
  }

  /**
   * Get the number of active intervals.
   */
  get numIntervals(): number {
    return this._intervals.size;
  }

  /**
   * Step all active intervals.
   * Called once per frame from the render loop.
   */
  step(): void {
    const toRemove: string[] = [];
    for (const [name, interval] of this._intervals) {
      const shouldContinue = interval.stepPlay();
      if (!shouldContinue) {
        toRemove.push(name);
      }
    }
    for (const name of toRemove) {
      this._intervals.delete(name);
    }
  }

  /**
   * Finish all active intervals immediately.
   */
  finishAll(): void {
    for (const interval of this._intervals.values()) {
      interval.finish();
    }
    this._intervals.clear();
  }

  /**
   * Pause all active intervals.
   */
  pauseAll(): void {
    for (const interval of this._intervals.values()) {
      interval.pause();
    }
    this._intervals.clear();
  }
}

// Global interval manager
export const intervalManager = new IntervalManager();
