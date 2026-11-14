// Wind

import { clamp } from "../MathHelpers.js";
import * as Env from "./Env.js";
import { Rng } from "./Rng.js";
import { wrapMod } from "./Util.js";

//#region Constants

export const SPEED_LEVEL_COUNT = 4;
export const MAX_SPEED_LEVEL = SPEED_LEVEL_COUNT - 1;

export const OCTANT_COUNT = 8;

export const DEFAULT_SPEED_LEVEL = 1;
export const DEFAULT_OCTANT = 0;

// Windspeed rerolled every half hour
export const SPEED_SLOT_SECONDS = 1800;
// Takes a half hour to change
export const SPEED_CHANGE_SECONDS = 1800;

// Direction rerolled every three hours
export const DIRECTION_SLOT_SECONDS = 10800;

export const DIRECTION_SECONDS_PER_OCTANT = 900;

export const SPEED_BAND_HOURS: readonly number[] = [5.0, 9.0, 16.0, 20.0];

export type SpeedChangeChances = readonly [number, number];

export const SPEED_CHANGE_TABLE: readonly (readonly (readonly SpeedChangeChances[])[])[] = [
    [   // season 0 - spring
        [[20, 0], [30, 0], [15, 0], [30, 0]],
        [[10, 40], [30, 30], [10, 30], [30, 30]],
        [[5, 60], [20, 50], [5, 60], [25, 35]],
        [[0, 60], [0, 50], [0, 50], [0, 50]],
    ],
    [   // season 1 - summer
        [[10, 0], [20, 0], [10, 0], [25, 0]],
        [[5, 60], [20, 40], [10, 40], [25, 30]],
        [[0, 70], [10, 50], [5, 50], [10, 35]],
        [[0, 60], [0, 40], [0, 40], [0, 50]],
    ],
    [   // season 2 - autumn
        [[25, 0], [40, 0], [30, 0], [30, 0]],
        [[15, 30], [40, 20], [30, 25], [30, 30]],
        [[0, 40], [5, 50], [0, 60], [5, 60]],
        [[0, 80], [0, 70], [0, 80], [0, 70]],
    ],
    [   // season 3 - winter
        [[30, 0], [40, 0], [35, 0], [40, 0]],
        [[15, 30], [30, 20], [35, 20], [35, 15]],
        [[10, 30], [20, 25], [5, 30], [25, 20]],
        [[0, 70], [0, 50], [0, 50], [0, 50]],
    ],
];

export const DIRECTION_WEIGHTS: readonly (readonly number[])[] = [
    [50, 25, 10, 0, 0, 0, 5, 10],   // spring
    [10, 20, 40, 20, 10, 0, 0, 0],  // summer
    [0, 0, 5, 10, 40, 30, 15, 0],   // autumn
    [10, 0, 0, 0, 10, 10, 60, 10],  // winter
];

//#endregion

//#region Shared Helpers

export function normalizeOctant(octant: number): number {
    return wrapMod(octant, OCTANT_COUNT);
}

function seasonRow(season: number): number {
    return clamp(season | 0, 0, 3);
}

function lerpOverRange(a: number, b: number, t0: number, t1: number, t: number): number {
    if (t1 - t0 === 0)
        return a;
    return a + ((b - a) * (t - t0)) / (t1 - t0);
}

// A change scheduled at 23:00 can still finish at 00:30.
const HALF_DAY_SECONDS = Env.DAY_SEC / 2;

function wrappedDiff(now: number, t: number): number {
    if (now < t + HALF_DAY_SECONDS) {
        if (now + HALF_DAY_SECONDS < t)
            t -= Env.DAY_SEC;
        return now - t;
    }
    return (now - Env.DAY_SEC) - t;
}

//#endregion

//#region Speed Curve

export class WindSpeedCurve {
    private from: number;
    private to: number;
    private startSec = 0;
    private endSec = 0;
    private lastSlot = -1;

    constructor(level: number = DEFAULT_SPEED_LEVEL) {
        this.from = level;
        this.to = level;
    }

    public value(nowSec: number): number {
        if (this.from === this.to)
            return this.to;
        return lerpOverRange(this.from, this.to, this.startSec, this.endSec, nowSec);
    }

    public set(level: number, nowSec: number): void {
        this.from = this.to = clamp(level | 0, 0, MAX_SPEED_LEVEL);
        this.lastSlot = Math.floor(nowSec / SPEED_SLOT_SECONDS);
    }

    private settleFinished(nowSec: number): void {
        if (this.from === this.to)
            return;
        if (wrappedDiff(nowSec, this.endSec) >= 0)
            this.from = this.to;
        else if (wrappedDiff(nowSec, this.startSec) < 0)
            this.to = this.from;
    }

    public update(nowSec: number, season: number, rng: Rng): void {
        this.settleFinished(nowSec);

        const slot = Math.floor(nowSec / SPEED_SLOT_SECONDS);
        if (slot !== this.lastSlot && this.from === this.to) {
            let i = 0;
            while (i < SPEED_BAND_HOURS.length && nowSec >= 3600.0 * SPEED_BAND_HOURS[i])
                i++;
            const band = (i + 3) % 4;

            const [up, down] = SPEED_CHANGE_TABLE[seasonRow(season)][this.to][band];
            const roll = rng.next() % 100;
            const delta = roll < up ? 1 : roll < up + down ? -1 : 0;
            if (delta !== 0) {
                this.from = this.to;
                this.to = clamp(this.from + delta, 0, MAX_SPEED_LEVEL);
                this.startSec = slot * SPEED_SLOT_SECONDS;
                this.endSec = this.startSec + SPEED_CHANGE_SECONDS;
            }
        }
        this.lastSlot = slot;
    }
}

//#endregion

//#region Direction Curve

// Shortest way around the 8-octant circle
function octantDelta(a: number, b: number): [number, number] {
    if (b < a + 4) {
        if (b + 4 < a)
            a -= OCTANT_COUNT;
    } else {
        b -= OCTANT_COUNT;
    }
    const d = b - a;
    return d < 0 ? [-d, -1] : [d, 1];
}

export class WindDirectionCurve {
    private from: number;
    private to: number;
    private step = 1;
    private startSec = 0;
    private endSec = 0;
    private lastSlot = -1;

    constructor(octant: number = DEFAULT_OCTANT) {
        this.from = octant;
        this.to = octant;
    }

    public value(nowSec: number): number {
        if (this.from === this.to)
            return this.to;
        const [d] = octantDelta(this.from, this.to);
        return lerpOverRange(this.from, this.from + d * this.step, this.startSec, this.endSec, nowSec);
    }

    public get fromOctant(): number {
        return this.from;
    }

    public get toOctant(): number {
        return this.to;
    }

    public crossFadeWeight(nowSec: number): number {
        if (this.from === this.to || this.endSec === this.startSec)
            return 0.0;
        return (nowSec - this.startSec) / (this.endSec - this.startSec);
    }

    public set(octant: number, nowSec: number): void {
        this.from = this.to = ((octant | 0) % OCTANT_COUNT + OCTANT_COUNT) % OCTANT_COUNT;
        this.lastSlot = Math.floor(nowSec / DIRECTION_SLOT_SECONDS);
    }

    private settleFinished(nowSec: number): void {
        if (this.from === this.to)
            return;
        if (wrappedDiff(nowSec, this.endSec) >= 0)
            this.from = this.to;
        else if (wrappedDiff(nowSec, this.startSec) < 0)
            this.to = this.from;
    }

    public update(nowSec: number, season: number, rng: Rng): void {
        this.settleFinished(nowSec);

        const slot = Math.floor(nowSec / DIRECTION_SLOT_SECONDS);
        if (slot !== this.lastSlot && this.from === this.to) {
            const weights = DIRECTION_WEIGHTS[seasonRow(season)];
            const roll = rng.next() % 100;
            let acc = 0, k = 0;
            for (; k < OCTANT_COUNT; k++) {
                acc += weights[k];
                if (roll < acc)
                    break;
            }
            if (k > OCTANT_COUNT - 1)
                k = 0;

            if (k !== this.to) {
                let [d, sign] = octantDelta(this.to, k);
                if (d === 4)
                    sign = (rng.next() % 2) === 0 ? 1 : -1;

                this.from = this.to;
                this.to = (this.from + d * sign + OCTANT_COUNT) % OCTANT_COUNT;
                this.startSec = slot * DIRECTION_SLOT_SECONDS;
                this.endSec = this.startSec + d * DIRECTION_SECONDS_PER_OCTANT;
                this.step = sign;
            }
        }
        this.lastSlot = slot;
    }
}

//#endregion

//#region Wind State

export class WindState {
    public readonly speedCurve = new WindSpeedCurve();
    public readonly directionCurve = new WindDirectionCurve();

    public octant = DEFAULT_OCTANT;
    public speed = DEFAULT_SPEED_LEVEL;
    public octantFrom = DEFAULT_OCTANT;
    public octantTo = DEFAULT_OCTANT;
    public turnBlend = 0.0;

    constructor(private rng: Rng) {}

    public update(nowSec: number, season: number): void {
        this.speedCurve.update(nowSec, season, this.rng);
        this.directionCurve.update(nowSec, season, this.rng);
        this.speed = this.speedCurve.value(nowSec);
        this.octant = this.directionCurve.value(nowSec);
        this.readCrossFade(nowSec);
    }

    private readCrossFade(nowSec: number): void {
        this.octantFrom = this.directionCurve.fromOctant;
        this.octantTo = this.directionCurve.toOctant;
        this.turnBlend = this.directionCurve.crossFadeWeight(nowSec);
    }

    public set(octant: number, speedLevel: number, nowSec: number): void {
        this.directionCurve.set(Math.round(octant), nowSec);
        this.speedCurve.set(Math.round(speedLevel), nowSec);
        this.speed = this.speedCurve.value(nowSec);
        this.octant = this.directionCurve.value(nowSec);
        this.readCrossFade(nowSec);
    }
}

//#endregion
