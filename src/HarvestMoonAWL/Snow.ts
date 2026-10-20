// Snow - much shared with Rain.ts

import { vec3 } from "gl-matrix";

import * as Cloud from "./Cloud.js";
import * as Env from "./Env.js";
import * as Rain from "./Rain.js";
import { Rng } from "./Rng.js";
import * as Weather from "./Weather.js";

//#region Constants

export const POOL_SIZE = Rain.POOL_SIZE;

export const FALL_PER_FRAME = 0.05;

export const DRIFT_SCALE = 0.01;

export const WOBBLE_AMPLITUDE = 0.1;
export const WOBBLE_PERIOD_FRAMES = 60;
export const WOBBLE_SLOT_COUNT = 8;

export const DIRECTION_COUNT = 8;

export const POINT_SIZE_NUMERATOR = 300.0;
export const POINT_SIZE_MAX_RAW = 255;
export const MIN_VIEW_DEPTH = 1.0;

//#endregion

//#region Single flake

export const enum FlakeState {
    FadingIn = 0,
    FadingOut = 1,
    Visible = 2,
}

export interface SnowFlake {
    x: number;
    y: number;
    z: number;
    spawnTimeSec: number;
    state: FlakeState;
    dirIndex: number;
    wobbleSlot: number;
}

export function swayDirection(dst: vec3, dirIndex: number): void {
    const a = (2 * Math.PI) * ((dirIndex % DIRECTION_COUNT) * 0.125);
    vec3.set(dst, Math.sin(a), 0, Math.cos(a));
}

export function swayAmount(slot: number, frameClock: number): number {
    const phase = (frameClock / WOBBLE_PERIOD_FRAMES) + (slot % WOBBLE_SLOT_COUNT) * 0.125;
    return WOBBLE_AMPLITUDE * Math.sin((2 * Math.PI) * phase);
}

export function pointSizePixels(viewDepth: number): number {
    if (viewDepth < MIN_VIEW_DEPTH)
        return 0;
    const raw = Math.min(POINT_SIZE_MAX_RAW, Math.trunc(POINT_SIZE_NUMERATOR / viewDepth));
    return raw / Env.POINT_SIZE_UNITS_PER_PIXEL;
}

export function flakeHalfSize(viewDepth: number, fovY: number): number {
    return Rain.pixelsToWorld(viewDepth, pointSizePixels(viewDepth) * 0.5, fovY);
}

export function flakeCount(weather: Weather.WeatherBlend): number {
    return Weather.blendedCount(Weather.SNOW_FRACTION, weather, POOL_SIZE);
}

//#endregion

//#region Snow Field

const scratchDrift = vec3.create();

export class SnowField {
    public flakes: SnowFlake[] = [];
    public readonly box = new Rain.RainBox();
    public frameClock = 0;
    private rng: Rng;
    private lastFrom = -1;
    private lastTo = -1;

    constructor(seed: number = 1) {
        this.rng = new Rng(seed >>> 0 || 1);
    }

    private pick(min: number, max: number): number {
        const lo = Math.trunc(min * 1000), hi = Math.trunc(max * 1000);
        if (hi <= lo)
            return min;
        return (lo + (this.rng.next() % (hi - lo + 1))) / 1000;
    }

    private spawn(nowSec: number, windowSeconds: number, state: FlakeState, phase: number): void {
        if (this.flakes.length >= POOL_SIZE)
            return;
        this.flakes.push({
            x: this.pick(this.box.min[0], this.box.max[0]),
            y: this.pick(this.box.min[1], this.box.max[1]),
            z: this.pick(this.box.min[2], this.box.max[2]),
            spawnTimeSec: Weather.scheduleFade(this.rng, nowSec, windowSeconds, phase),
            state,
            dirIndex: this.rng.range(0, DIRECTION_COUNT - 1),
            wobbleSlot: this.rng.range(0, WOBBLE_SLOT_COUNT - 1),
        });
    }

    private settleFades(): void {
        const kept: SnowFlake[] = [];
        for (const flake of this.flakes) {
            if (flake.state === FlakeState.FadingOut)
                continue;
            if (flake.state === FlakeState.FadingIn)
                flake.state = FlakeState.Visible;
            kept.push(flake);
        }
        this.flakes = kept;
    }

    private resizeForWeather(nowSec: number, weather: Weather.RemappedBlend): void {
        this.settleFades();
        const fromCount = flakeCount({ from: weather.from, to: weather.from, blend: 0 });
        const toCount = flakeCount({ from: weather.to, to: weather.to, blend: 0 });

        while (this.flakes.length < fromCount)
            this.spawn(nowSec, weather.windowSeconds, FlakeState.Visible, 1.0);
        while (this.flakes.length > fromCount)
            this.flakes.shift();

        if (fromCount < toCount) {
            for (let i = fromCount; i < toCount; i++)
                this.spawn(nowSec, weather.windowSeconds, FlakeState.FadingIn, weather.blend);
        } else if (toCount < fromCount) {
            for (let i = 0; i < fromCount - toCount && i < this.flakes.length; i++) {
                this.flakes[i].spawnTimeSec = Weather.scheduleFade(this.rng, nowSec, weather.windowSeconds, weather.blend);
                this.flakes[i].state = FlakeState.FadingOut;
            }
        }
    }

    private tick(nowSec: number, weather: Weather.RemappedBlend, windOctant: number, windSpeed: number, frames: number): void {
        const a = Cloud.windAngleRad(windOctant);
        vec3.set(scratchDrift, -Math.sin(a) * windSpeed, 0, -Math.cos(a) * windSpeed);
        const dx = DRIFT_SCALE * scratchDrift[0] * frames;
        const dz = DRIFT_SCALE * scratchDrift[2] * frames;
        const dy = FALL_PER_FRAME * frames;

        const min = this.box.min, max = this.box.max;
        const kept: SnowFlake[] = [];
        for (const flake of this.flakes) {
            flake.y -= dy;
            flake.x += dx;
            flake.z += dz;

            const wx = Rain.wrapCoord(flake.x, min[0], max[0]);
            if (!Number.isNaN(wx))
                flake.x = wx;
            const wz = Rain.wrapCoord(flake.z, min[2], max[2]);
            if (!Number.isNaN(wz))
                flake.z = wz;
            const wy = Rain.wrapCoord(flake.y, min[1] - FALL_PER_FRAME, max[1]);
            if (!Number.isNaN(wy)) {
                flake.y = wy;
                flake.x = this.pick(min[0], max[0]);
                flake.z = this.pick(min[2], max[2]);

                const progress = Weather.fadeProgress(nowSec, flake.spawnTimeSec, weather.windowSeconds);
                if (flake.state === FlakeState.FadingOut) {
                    if (progress >= 1.0)
                        continue;
                } else if (flake.state === FlakeState.FadingIn && progress >= 1.0) {
                    flake.state = FlakeState.Visible;
                }
            }
            kept.push(flake);
        }
        this.flakes = kept;
    }

    public update(nowSec: number, weather: Weather.RemappedBlend, cameraPos: vec3, cameraForward: vec3, windOctant: number, windSpeed: number, deltaSeconds: number): void {
        Rain.fillBox(this.box, cameraPos, cameraForward);

        if (weather.from !== this.lastFrom || weather.to !== this.lastTo) {
            this.lastFrom = weather.from;
            this.lastTo = weather.to;
            this.resizeForWeather(nowSec, weather);
        }

        const frames = deltaSeconds * Env.ROM_LOGIC_FPS;
        if (frames <= 0)
            return;
        this.frameClock = (this.frameClock + frames) % WOBBLE_PERIOD_FRAMES;
        this.tick(nowSec, weather, windOctant, windSpeed, frames);
    }
}

//#endregion
