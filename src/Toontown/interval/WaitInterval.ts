import { Interval, State } from "./Interval";

let waitNum = 0;

/**
 * An interval that does nothing for a specified duration.
 *
 * Used to add delays in sequences.
 */
export class WaitInterval extends Interval {
  constructor(duration: number, name?: string) {
    super(name ?? `Wait-${waitNum++}`, duration, true);
  }

  override privStep(_t: number): void {
    this._state = State.Started;
  }
}

/**
 * Convenience function to create a WaitInterval.
 */
export function Wait(duration: number, name?: string): WaitInterval {
  return new WaitInterval(duration, name);
}
