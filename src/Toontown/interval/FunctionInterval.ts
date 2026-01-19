import { Interval } from "./Interval";

let funcNum = 0;

export class FunctionInterval extends Interval {
  constructor(
    private fn: () => void,
    openEnded = true,
  ) {
    super(`Func-${funcNum++}`, 0, openEnded);
  }

  override privInstant(): void {
    this.fn();
  }
}

export function Func(fn: () => void, openEnded = true): FunctionInterval {
  return new FunctionInterval(fn, openEnded);
}
