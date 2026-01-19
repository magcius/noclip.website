import { Func, type Interval, Sequence, Wait } from "../interval";
import { GenericAnimatedProp } from "./GenericAnimatedProp";

export interface IdleAnimDef {
  name: string;
  minLoops: number;
  maxLoops: number;
  settleAnim: string | null;
  minPauseTime: number;
  maxPauseTime: number;
}

// For debugging
const RANDOMIZE_IDLES = true;

export class InteractiveAnimatedProp extends GenericAnimatedProp {
  protected _hoodToIdles: Record<number, IdleAnimDef[]>;
  protected _numIdles: number;
  protected _curIval: Interval | null = null;

  override async init(): Promise<void> {
    await super.init();

    const idleAnims = this._hoodToIdles[this._hoodId];
    if (!idleAnims) {
      throw new Error(`No idle animations defined for zone ${this._hoodId}`);
    }

    const anims: Record<string, string> = {};
    for (let i = 0; i < idleAnims.length; i++) {
      const animDef = idleAnims[i];
      anims[`idle${i}`] = `${this._path}/${animDef.name}`;
      if (animDef.settleAnim) {
        anims[`settle${i}`] = `${this._path}/${animDef.settleAnim}`;
      }
    }
    this._numIdles = idleAnims.length;
    await this._actor.loadAnims(anims);
  }

  override enter(): void {
    this._startNextIdleAnim();
  }

  override exit(): void {
    if (this._curIval) {
      // pause instead of finish to avoid triggering an infinite loop
      this._curIval.pause();
      this._curIval = null;
    }
    super.exit();
  }

  protected _startNextIdleAnim() {
    const idleIdx = this.chooseIdleAnimToRun();
    const idleDef = this._hoodToIdles[this._hoodId][idleIdx];
    const idleIval = this._actor.actorInterval(`idle${idleIdx}`);
    const sequence: Interval[] = [];
    const numLoops = randomIntInclusive(idleDef.minLoops, idleDef.maxLoops);
    const pauseTime = randomIntInclusive(
      idleDef.minPauseTime,
      idleDef.maxPauseTime,
    );
    for (let i = 0; i < numLoops; i++) {
      sequence.push(idleIval);
    }
    if (idleDef.settleAnim) {
      sequence.push(this._actor.actorInterval(`settle${idleIdx}`));
    }
    sequence.push(
      Wait(pauseTime),
      Func(() => {
        this._startNextIdleAnim();
      }),
    );
    this._curIval = new Sequence(sequence);
    this._curIval.start();
  }

  private _lastIdleAnimIndex = -1;

  private chooseIdleAnimToRun(): number {
    if (!RANDOMIZE_IDLES) {
      const index = this._lastIdleAnimIndex + 1;
      this._lastIdleAnimIndex = index % this._numIdles;
      return this._lastIdleAnimIndex;
    }
    const pairs: Array<WeightedPair<number>> = [];
    for (let i = 0; i < this._numIdles; i++) {
      const reversedChance = this._numIdles - i - 1;
      pairs.push([2 ** reversedChance, i]);
    }
    return weightedChoice(pairs);
  }
}

type WeightedPair<T> = [weight: number, item: T];

function weightedChoice<T>(choiceList: Array<WeightedPair<T>>): T {
  let total = 0;
  for (const [weight] of choiceList) total += weight;
  let accum = Math.random() * total;
  // Fallback in case of floating-point edge cases
  let lastItem: T = choiceList[choiceList.length - 1][1];
  for (const [weight, item] of choiceList) {
    lastItem = item;
    accum -= weight;
    if (accum <= 0) return item;
  }
  return lastItem;
}

export function randomIntInclusive(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}
