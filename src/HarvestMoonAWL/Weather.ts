// Weather system - six states

import { Color, colorLerp } from "../Color.js";
import { clamp, lerp, saturate } from "../MathHelpers.js";
import * as Env from "./Env.js";
import { Rng } from "./Rng.js";

//#region State Index

export const WEATHER_STATE_COUNT = 6;

export const enum WeatherIndex {
    Clear = 0,
    FewClouds = 1,
    Cloudy = 2,
    Rain = 3,
    Snow = 4,
    Storm = 5,
}

export const TRANSITION_SECONDS = 3600;

export const DEFAULT_WEATHER = WeatherIndex.FewClouds;

export const SHORT_WEATHER_LABELS: readonly string[] = [
    "Clear",
    "Few",
    "Cloudy",
    "Rain",
    "Snow",
    "Storm",
];

//#endregion

//#region Per-State Symbols

export const LIGHT_FACTOR: readonly number[] = [1.0, 0.8, 0.5, 0.3, 0.3, 0.2];

export const FOG_FACTOR: readonly number[] = [0.0, 0.0, 0.0, 0.5, 0.5, 1.0];

export const CURVE_C: readonly number[] = [1.0, 1.0, 0.25, 0.0, 0.0, 0.0];

export const RAIN_FRACTION: readonly number[] = [0.0, 0.0, 0.0, 0.5, 0.0, 1.0];

export const SNOW_FRACTION: readonly number[] = [0.0, 0.0, 0.0, 0.0, 1.0, 0.0];

export const OVERCAST_FOG_START_Z = -100.0;
export const OVERCAST_FOG_END_Z = 60.0;
export const OVERCAST_FOG_COLOR: Color = { r: 0x40 / 0xff, g: 0x40 / 0xff, b: 0x40 / 0xff, a: 1.0 };

//#endregion

//#region Blending

export function tableAt(table: readonly number[], weather: number): number {
    return table[clamp(weather | 0, 0, table.length - 1)];
}

export function fadeProgress(nowSec: number, spawnTimeSec: number, windowSeconds: number): number {
    let t = spawnTimeSec;
    // Check for wrap at midnight
    if (nowSec + Env.DAY_SEC / 2 < t)
        t -= Env.DAY_SEC;
    return (nowSec - t) / Math.trunc(windowSeconds / 2);
}

export function scheduleFade(rng: Rng, nowSec: number, windowSeconds: number, phase: number): number {
    const half = Math.trunc(windowSeconds / 2);
    return Math.trunc(nowSec - windowSeconds * phase) + rng.range(0, half);
}

export interface WeatherBlend {
    from: number;
    to: number;
    blend: number;
}

export function blendedTable(table: readonly number[], weather: WeatherBlend): number {
    return saturate(lerp(tableAt(table, weather.from), tableAt(table, weather.to), weather.blend));
}

export function blendedCount(table: readonly number[], weather: WeatherBlend, poolSize: number): number {
    return Math.trunc(poolSize * lerp(tableAt(table, weather.from), tableAt(table, weather.to), weather.blend));
}

export function lightFactor(weather: WeatherBlend): number {
    return blendedTable(LIGHT_FACTOR, weather);
}

export function fogFactor(weather: WeatherBlend): number {
    return blendedTable(FOG_FACTOR, weather);
}

export function curveC(weather: WeatherBlend): number {
    return blendedTable(CURVE_C, weather);
}

export function applyFog(color: Color, range: { startZ: number, endZ: number }, factor: number): void {
    if (factor <= 0)
        return;
    range.startZ = lerp(range.startZ, OVERCAST_FOG_START_Z, factor);
    range.endZ = lerp(range.endZ, OVERCAST_FOG_END_Z, factor);
    colorLerp(color, color, OVERCAST_FOG_COLOR, factor);
}

//#endregion

//#region Transition from Snow to Rain
// This transition is a bit fancy. The rain stops and snow starts at 2x the normal speed
// taking a half hour each, and meeting in the middle with cloudy weather

const RAINY = new Set<number>([WeatherIndex.Rain, WeatherIndex.Storm]);

export interface RemappedBlend extends WeatherBlend {
    windowSeconds: number;
}

export function viaCloudy(dst: RemappedBlend, weather: WeatherBlend): void {
    dst.from = weather.from;
    dst.to = weather.to;
    dst.blend = weather.blend;
    dst.windowSeconds = TRANSITION_SECONDS;

    const snowToRain = weather.from === WeatherIndex.Snow && RAINY.has(weather.to);
    const rainToSnow = RAINY.has(weather.from) && weather.to === WeatherIndex.Snow;
    if (!snowToRain && !rainToSnow)
        return;

    if (weather.blend >= 0.5) {
        dst.from = WeatherIndex.Cloudy;
        dst.blend = (weather.blend - 0.5) * 2.0;
    } else {
        dst.to = WeatherIndex.Cloudy;
        dst.blend = weather.blend * 2.0;
    }
    dst.windowSeconds = TRANSITION_SECONDS / 2;
}

//#endregion

//#region Live State


export class WeatherState {
    public readonly blend: WeatherBlend;
    public readonly remapped: RemappedBlend = { from: 0, to: 0, blend: 0, windowSeconds: TRANSITION_SECONDS };
    private from: number;
    private remainingSec = 0;

    constructor(public target: number = DEFAULT_WEATHER) {
        this.from = target;
        this.blend = { from: target, to: target, blend: 0 };
        viaCloudy(this.remapped, this.blend);
    }

    public set(weather: number, crossFade: boolean = false, elapsedSeconds: number = 0): void {
        if (weather === this.target && (this.remainingSec <= 0 || !crossFade))
            return;
        if (crossFade) {
            this.from = this.blend.to;
            this.target = weather;
            this.remainingSec = Math.max(0, TRANSITION_SECONDS - elapsedSeconds);
        } else {
            this.from = weather;
            this.target = weather;
            this.remainingSec = 0;
            this.blend.from = weather;
            this.blend.to = weather;
            this.blend.blend = 0;
            viaCloudy(this.remapped, this.blend);
        }
    }

    public advance(deltaGameSeconds: number): void {
        this.remainingSec = Math.max(0, this.remainingSec - deltaGameSeconds);
        if (this.remainingSec <= 0) {
            this.from = this.target;
            this.blend.from = this.target;
            this.blend.to = this.target;
            this.blend.blend = 0;
        } else {
            this.blend.from = this.from;
            this.blend.to = this.target;
            this.blend.blend = 1 - this.remainingSec / TRANSITION_SECONDS;
        }
        viaCloudy(this.remapped, this.blend);
    }
}

//#endregion

//#region Automatic weather

export const WEATHER_PHASE_COUNT = 8;

export function seasonPhase(season: number, dayOfSeason: number): number {
    const s = ((season | 0) % 4 + 4) % 4;
    const d = ((dayOfSeason | 0) % 10 + 10) % 10;
    if (d >= 8)
        return s * 2 + 1;
    if (d < 2)
        return s === 0 ? 7 : s * 2 - 1;
    return s * 2;
}

export const PATTERN_FIRST_STATE: readonly number[] = [
    0, 1, 2, 3, 4, 5,
    0, 1, 1, 2, 2, 2,
    3, 3, 4, 4, 3, 5,
];

export const PATTERN_SECOND_STATE: readonly number[] = [
    0, 1, 2, 3, 4, 5,
    1, 0, 2, 1, 3, 4,
    2, 4, 3, 2, 5, 3,
];

export const FIRST_CHANGE_HOURS: readonly [number, number] = [0, 4];
export const SECOND_CHANGE_HOURS: readonly [number, number] = [6, 10];

export type PatternEntry = readonly [number, number];

export function pickPattern(list: readonly PatternEntry[], rng: Rng): number {
    for (const [id, weight] of list) {
        if (rng.next() % 100 <= weight)
            return id;
    }
    // Unreachable guard
    return list[list.length - 1][0];
}

export const PATTERN_TABLES: readonly (readonly (readonly PatternEntry[])[])[] = [
    [   // phase 0 - spring
        [[0x01, 70], [0x06, 70], [0x08, 70], [0x07, 50], [0x00, 255]],
        [[0x01, 70], [0x06, 70], [0x09, 70], [0x08, 70], [0x0a, 60], [0x02, 60], [0x07, 50], [0x00, 255]],
        [[0x09, 60], [0x01, 60], [0x08, 60], [0x0a, 60], [0x0c, 50], [0x02, 50], [0x03, 50], [0x10, 50], [0x07, 255]],
        [[0x02, 70], [0x09, 70], [0x0c, 70], [0x0a, 60], [0x03, 60], [0x11, 60], [0x10, 50], [0x05, 255]],
        [[0x02, 60], [0x09, 60], [0x0c, 60], [0x0f, 50], [0x0a, 50], [0x0e, 50], [0x03, 255]],
        [[0x0c, 80], [0x03, 80], [0x10, 50], [0x11, 60], [0x05, 255]],
    ],
    [   // phase 1 - spring into summer
        [[0x08, 80], [0x01, 80], [0x06, 60], [0x07, 50], [0x00, 255]],
        [[0x0a, 70], [0x02, 70], [0x08, 70], [0x09, 50], [0x06, 50], [0x01, 50], [0x07, 50], [0x00, 255]],
        [[0x0a, 80], [0x03, 70], [0x10, 60], [0x0c, 60], [0x08, 50], [0x02, 50], [0x09, 50], [0x01, 50], [0x07, 255]],
        [[0x0c, 70], [0x02, 70], [0x03, 60], [0x0a, 60], [0x09, 60], [0x11, 60], [0x10, 50], [0x05, 255]],
        [[0x04, 255]],
        [[0x0c, 80], [0x03, 60], [0x11, 60], [0x10, 50], [0x05, 255]],
    ],
    [   // phase 2 - summer
        [[0x00, 80], [0x07, 60], [0x06, 60], [0x01, 50], [0x08, 255]],
        [[0x00, 80], [0x07, 60], [0x06, 60], [0x09, 60], [0x01, 50], [0x08, 50], [0x02, 50], [0x0a, 255]],
        [[0x07, 80], [0x01, 60], [0x09, 60], [0x08, 50], [0x02, 50], [0x0c, 50], [0x0a, 50], [0x03, 50], [0x10, 255]],
        [[0x09, 80], [0x02, 80], [0x0c, 70], [0x0a, 50], [0x03, 50], [0x11, 50], [0x10, 50], [0x05, 255]],
        [[0x04, 255]],
        [[0x0c, 90], [0x03, 80], [0x11, 50], [0x10, 50], [0x05, 255]],
    ],
    [   // phase 3 - summer into autumn
        [[0x08, 80], [0x01, 60], [0x06, 60], [0x07, 50], [0x00, 255]],
        [[0x09, 70], [0x0a, 70], [0x08, 60], [0x02, 60], [0x06, 50], [0x07, 50], [0x01, 50], [0x00, 255]],
        [[0x0c, 70], [0x03, 60], [0x0a, 60], [0x08, 50], [0x02, 50], [0x09, 50], [0x01, 50], [0x10, 60], [0x07, 255]],
        [[0x0a, 70], [0x11, 70], [0x0c, 50], [0x02, 50], [0x09, 60], [0x10, 50], [0x03, 50], [0x05, 255]],
        [[0x04, 255]],
        [[0x0c, 90], [0x03, 80], [0x11, 80], [0x10, 50], [0x05, 255]],
    ],
    [   // phase 4 - autumn
        [[0x01, 70], [0x08, 60], [0x06, 50], [0x07, 50], [0x00, 255]],
        [[0x01, 60], [0x0a, 60], [0x09, 60], [0x02, 50], [0x08, 50], [0x06, 50], [0x07, 50], [0x00, 255]],
        [[0x01, 60], [0x0a, 60], [0x03, 60], [0x0c, 60], [0x10, 60], [0x09, 50], [0x08, 50], [0x07, 50], [0x02, 255]],
        [[0x09, 70], [0x11, 60], [0x0c, 60], [0x02, 50], [0x0a, 50], [0x03, 50], [0x10, 50], [0x05, 255]],
        [[0x04, 255]],
        [[0x0c, 80], [0x03, 80], [0x11, 50], [0x10, 50], [0x05, 255]],
    ],
    [   // phase 5 - autumn into winter
        [[0x08, 80], [0x01, 70], [0x06, 60], [0x07, 50], [0x00, 255]],
        [[0x0a, 70], [0x09, 60], [0x0b, 60], [0x08, 60], [0x06, 50], [0x02, 50], [0x01, 50], [0x07, 50], [0x00, 255]],
        [[0x0c, 60], [0x08, 60], [0x0f, 60], [0x0b, 60], [0x0d, 60], [0x0e, 60], [0x09, 50], [0x0a, 50], [0x02, 50], [0x03, 50], [0x04, 50], [0x01, 50], [0x07, 50], [0x10, 255]],
        [[0x0f, 70], [0x0e, 70], [0x0b, 70], [0x09, 60], [0x0c, 60], [0x0d, 60], [0x0a, 50], [0x02, 50], [0x03, 50], [0x04, 50], [0x11, 50], [0x10, 50], [0x05, 255]],
        [[0x0c, 70], [0x0a, 70], [0x09, 80], [0x0b, 60], [0x02, 60], [0x03, 50], [0x0f, 50], [0x0e, 50], [0x04, 50], [0x10, 50], [0x0d, 255]],
        [[0x0c, 90], [0x03, 80], [0x11, 80], [0x10, 50], [0x05, 50], [0x0d, 255]],
    ],
    [   // phase 6 - winter
        [[0x08, 80], [0x01, 60], [0x06, 60], [0x07, 50], [0x00, 255]],
        [[0x02, 70], [0x08, 70], [0x0b, 60], [0x01, 50], [0x09, 50], [0x06, 50], [0x07, 50], [0x00, 50], [0x0a, 255]],
        [[0x0f, 70], [0x08, 70], [0x02, 70], [0x01, 70], [0x09, 70], [0x0b, 70], [0x07, 70], [0x0d, 50], [0x0e, 50], [0x04, 50], [0x0a, 50], [0x0c, 50], [0x03, 50], [0x10, 255]],
        [[0x02, 60], [0x04, 60], [0x09, 60], [0x0d, 60], [0x0f, 60], [0x0c, 60], [0x0b, 60], [0x0a, 50], [0x03, 50], [0x0e, 50], [0x11, 50], [0x10, 50], [0x05, 255]],
        [[0x02, 70], [0x0f, 70], [0x0b, 60], [0x09, 60], [0x04, 60], [0x0c, 50], [0x0e, 50], [0x03, 50], [0x0a, 50], [0x0d, 50], [0x10, 255]],
        [[0x0c, 95], [0x11, 50], [0x03, 255]],
    ],
    [   // phase 7 - winter into spring
        [[0x08, 70], [0x06, 70], [0x01, 60], [0x07, 50], [0x00, 255]],
        [[0x09, 70], [0x08, 60], [0x0a, 60], [0x0b, 0], [0x06, 60], [0x01, 50], [0x02, 50], [0x07, 50], [0x00, 255]],
        [[0x08, 70], [0x0f, 0], [0x0e, 0], [0x0c, 60], [0x09, 60], [0x0a, 60], [0x0b, 0], [0x0d, 0], [0x02, 50], [0x07, 50], [0x01, 50], [0x04, 0], [0x03, 50], [0x10, 255]],
        [[0x09, 80], [0x02, 70], [0x0c, 70], [0x0d, 0], [0x0a, 60], [0x04, 0], [0x03, 50], [0x0b, 0], [0x0e, 0], [0x0f, 0], [0x10, 50], [0x11, 50], [0x05, 255]],
        [[0x0c, 70], [0x0e, 0], [0x0f, 0], [0x0a, 70], [0x09, 60], [0x02, 60], [0x03, 50], [0x04, 0], [0x0b, 0], [0x0d, 0], [0x10, 255]],
        [[0x0c, 95], [0x03, 90], [0x11, 50], [0x10, 50], [0x0d, 0], [0x05, 255]],
    ],
];

const SECONDS_PER_HOUR = 3600;

export interface ScheduledChange {
    state: number;
    elapsedSec: number;
}

export class WeatherSchedule {
    public readonly rng: Rng;
    public patternId = 0;
    public firstState = 0;
    public secondState = 0;
    public firstChangeSec = 0;
    public secondChangeSec = 0;
    public firstPending = false;
    public secondPending = false;
    private scheduledDay = Number.NaN;

    constructor(seed: number = 0x77ea) {
        this.rng = new Rng(seed);
    }

    public reschedule(nowAbsSec: number, dayIndex: number, phase: number, currentWeather: number): void {
        const p = ((phase | 0) % WEATHER_PHASE_COUNT + WEATHER_PHASE_COUNT) % WEATHER_PHASE_COUNT;
        const row = Math.max(0, Math.min(WEATHER_STATE_COUNT - 1, currentWeather | 0));
        this.patternId = pickPattern(PATTERN_TABLES[p][row], this.rng);
        this.firstState = PATTERN_FIRST_STATE[this.patternId];
        this.secondState = PATTERN_SECOND_STATE[this.patternId];

        const [firstLo, firstHi] = FIRST_CHANGE_HOURS;
        const [secondLo, secondHi] = SECOND_CHANGE_HOURS;
        this.firstChangeSec = nowAbsSec + (firstLo + (this.rng.next() % (firstHi - firstLo + 1))) * SECONDS_PER_HOUR;
        this.secondChangeSec = nowAbsSec + (secondLo + (this.rng.next() % (secondHi - secondLo + 1))) * SECONDS_PER_HOUR;
        this.firstPending = true;
        this.secondPending = true;
        this.scheduledDay = dayIndex;
    }

    public update(nowAbsSec: number, dayIndex: number, phase: number, currentWeather: number): ScheduledChange | null {
        if (dayIndex !== this.scheduledDay)
            this.reschedule(nowAbsSec, dayIndex, phase, currentWeather);
        if (this.firstPending && this.firstChangeSec < nowAbsSec) {
            this.firstPending = false;
            return { state: this.firstState, elapsedSec: nowAbsSec - this.firstChangeSec };
        }
        if (this.secondPending && this.secondChangeSec < nowAbsSec) {
            this.secondPending = false;
            return { state: this.secondState, elapsedSec: nowAbsSec - this.secondChangeSec };
        }
        return null;
    }

    public nextChangeTimeOfDay(): { state: number, timeOfDaySec: number } | null {
        if (this.firstPending)
            return { state: this.firstState, timeOfDaySec: this.firstChangeSec % Env.DAY_SEC };
        if (this.secondPending)
            return { state: this.secondState, timeOfDaySec: this.secondChangeSec % Env.DAY_SEC };
        return null;
    }
}

//#endregion
