import { vec3 } from "gl-matrix";

import { Color } from "../Color.js";

import * as Env from "./Env.js";
import { saturate } from "../MathHelpers.js";
import { Rng } from "./Rng.js";
import * as Weather from "./Weather.js";

//#region Constants

export const POOL_SIZE = 1000;

export const STREAK_LENGTH = 4.5;

export const FALL_PER_FRAME = 3.0;

export const BOX_FOV_DEG = 30.0;
export const BOX_ASPECT = 1.3333334;
export const BOX_NEAR = 1.0;
export const BOX_FAR = 30.0;

export const BOX_CENTER_DISTANCE = (BOX_NEAR + BOX_FAR) * 0.5;

export const BOX_HALF_EXTENT = (() => {
    const tan = Math.tan(BOX_FOV_DEG * 0.5 * Math.PI / 180.0);
    const x = tan * BOX_ASPECT * BOX_NEAR, y = tan * BOX_NEAR, z = BOX_CENTER_DISTANCE - BOX_NEAR;
    return Math.sqrt(x * x + y * y + z * z);
})();

const SPAWN_DIVISOR = 1000.0;

export const PEAK_INTENSITY = 32.0 / 255.0;

//#endregion

//#region Raindrop

export const enum DropState {
    FadingIn = 0,
    FadingOut = 1,
    Visible = 2,
}

export interface RainDrop {
    x: number;
    y: number;
    z: number;
    spawnTimeSec: number;
    state: DropState;
}

export function dropFade(state: DropState, progress: number): number {
    const p = saturate(progress);
    if (state === DropState.FadingOut)
        return 1.0 - p;
    if (state === DropState.Visible)
        return 1.0;
    return p;
}

export function dropCount(weather: Weather.WeatherBlend): number {
    return Weather.blendedCount(Weather.RAIN_FRACTION, weather, POOL_SIZE);
}

//#endregion

//#region Rain Field

export class RainBox {
    public min = vec3.create();
    public max = vec3.create();
}

export function fillBox(dst: RainBox, cameraPos: vec3, cameraForward: vec3): void {
    const cx = cameraPos[0] + cameraForward[0] * BOX_CENTER_DISTANCE;
    const cy = cameraPos[1] + cameraForward[1] * BOX_CENTER_DISTANCE;
    const cz = cameraPos[2] + cameraForward[2] * BOX_CENTER_DISTANCE;
    vec3.set(dst.min, cx - BOX_HALF_EXTENT, cy - BOX_HALF_EXTENT, cz - BOX_HALF_EXTENT);
    vec3.set(dst.max, cx + BOX_HALF_EXTENT, cy + BOX_HALF_EXTENT, cz + BOX_HALF_EXTENT);
}

export function wrapCoord(v: number, min: number, max: number): number {
    const span = max - min;
    if (v < min)
        return v + span;
    if (v > max)
        return v - span;
    return NaN;
}

export class RainField {
    public drops: RainDrop[] = [];
    public readonly box = new RainBox();
    private rng: Rng;
    private lastFrom = -1;
    private lastTo = -1;

    constructor(seed: number = 1) {
        this.rng = new Rng(seed >>> 0 || 1);
    }

    private pick(min: number, max: number): number {
        const lo = Math.trunc(min * SPAWN_DIVISOR), hi = Math.trunc(max * SPAWN_DIVISOR);
        if (hi <= lo)
            return min;
        return (lo + (this.rng.next() % (hi - lo + 1))) / SPAWN_DIVISOR;
    }

    private spawn(nowSec: number, windowSeconds: number, state: DropState, phase: number): void {
        if (this.drops.length >= POOL_SIZE)
            return;
        this.drops.push({
            x: this.pick(this.box.min[0], this.box.max[0]),
            y: this.pick(this.box.min[1], this.box.max[1]),
            z: this.pick(this.box.min[2], this.box.max[2]),
            spawnTimeSec: Weather.scheduleFade(this.rng, nowSec, windowSeconds, phase),
            state,
        });
    }

    private settleFades(): void {
        const kept: RainDrop[] = [];
        for (const drop of this.drops) {
            if (drop.state === DropState.FadingOut)
                continue;
            if (drop.state === DropState.FadingIn)
                drop.state = DropState.Visible;
            kept.push(drop);
        }
        this.drops = kept;
    }

    private resizeForWeather(nowSec: number, weather: Weather.RemappedBlend): void {
        this.settleFades();
        const fromCount = dropCount({ from: weather.from, to: weather.from, blend: 0 });
        const toCount = dropCount({ from: weather.to, to: weather.to, blend: 0 });

        while (this.drops.length < fromCount)
            this.spawn(nowSec, weather.windowSeconds, DropState.Visible, 1.0);
        while (this.drops.length > fromCount)
            this.drops.shift();

        if (fromCount < toCount) {
            for (let i = fromCount; i < toCount; i++)
                this.spawn(nowSec, weather.windowSeconds, DropState.FadingIn, weather.blend);
        } else if (toCount < fromCount) {
            // Fade out the first (fromCount - toCount) nodes in list order.
            for (let i = 0; i < fromCount - toCount && i < this.drops.length; i++) {
                this.drops[i].spawnTimeSec = Weather.scheduleFade(this.rng, nowSec, weather.windowSeconds, weather.blend);
                this.drops[i].state = DropState.FadingOut;
            }
        }
    }

    private tick(nowSec: number, weather: Weather.RemappedBlend, frames: number): void {
        const min = this.box.min, max = this.box.max;
        const dy = FALL_PER_FRAME * frames;

        const kept: RainDrop[] = [];
        for (const drop of this.drops) {
            drop.y -= dy;

            const wx = wrapCoord(drop.x, min[0], max[0]);
            if (!Number.isNaN(wx))
                drop.x = wx;
            const wz = wrapCoord(drop.z, min[2], max[2]);
            if (!Number.isNaN(wz))
                drop.z = wz;
            const wy = wrapCoord(drop.y, min[1] - STREAK_LENGTH, max[1]);
            if (!Number.isNaN(wy)) {
                drop.y = wy;
                drop.x = this.pick(min[0], max[0]);
                drop.z = this.pick(min[2], max[2]);

                const progress = Weather.fadeProgress(nowSec, drop.spawnTimeSec, weather.windowSeconds);
                if (drop.state === DropState.FadingOut) {
                    if (progress >= 1.0)
                        continue;
                } else if (drop.state === DropState.FadingIn && progress >= 1.0) {
                    drop.state = DropState.Visible;
                }
            }
            kept.push(drop);
        }
        this.drops = kept;
    }

    // nowSec: in-game clock 
    // deltaSeconds: real time
    public update(nowSec: number, weather: Weather.RemappedBlend, cameraPos: vec3, cameraForward: vec3, deltaSeconds: number): void {
        fillBox(this.box, cameraPos, cameraForward);

        if (weather.from !== this.lastFrom || weather.to !== this.lastTo) {
            this.lastFrom = weather.from;
            this.lastTo = weather.to;
            this.resizeForWeather(nowSec, weather);
        }

        const frames = deltaSeconds * Env.ROM_LOGIC_FPS;
        if (frames <= 0)
            return;
        this.tick(nowSec, weather, frames);
    }
}

//#endregion

//#region Placing A Raindrop

export function sceneBrightness(ambient: Color, keyLight: Color): number {
    const sum = (ambient.r + ambient.g + ambient.b) + (keyLight.r + keyLight.g + keyLight.b);
    return saturate(sum / 6);
}

export function pixelsToWorld(viewDepth: number, px: number, fovY: number): number {
    return 2.0 * viewDepth * Math.tan(fovY * 0.5) * (px / Env.REFERENCE_EFB_HEIGHT);
}

export const LINE_WIDTH_PIXELS = 1.0;

export function streakWorldWidth(viewDepth: number, fovY: number, backbufferHeight: number): number {
    const onePixelInEfbLines = Env.REFERENCE_EFB_HEIGHT / Math.max(1, backbufferHeight);
    return pixelsToWorld(viewDepth, Math.max(LINE_WIDTH_PIXELS, onePixelInEfbLines), fovY);
}

//#endregion
