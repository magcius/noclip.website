import { Color, colorFromRGBA } from "../Color.js";

import * as Weather from "./Weather.js";
import * as Env from "./Env.js";
import { lerp, saturate } from "../MathHelpers.js";
import { Rng } from "./Rng.js";
import * as Wind from "./Wind.js";
import { mat4, vec3 } from "gl-matrix";

//#region Constants

// Pool size 0x32 of 0x24-byte nodes - max 50 clouds.
export const POOL_SIZE = 50;

export const SPAWN_Y = 500.0;

// Spawn position: `(rand() % 0x493e01 - 2400000) / 1000.0` on X and Z. 
export const FIELD_HALF_EXTENT = 2400.0;
const SPAWN_MODULUS = 0x493e01;
const SPAWN_BIAS = 2400000;
const SPAWN_DIVISOR = 1000.0;

export const IMAGE_INDEX_MIN = 0;
export const IMAGE_INDEX_MAX = 2;

export const SIZE_RAND_MIN = 0;
export const SIZE_RAND_MAX = 255;

export const DOME_RADIUS = 5.0 * Math.sqrt(6500000.0);

export function domeHeight(horizontalDistance: number): number {
    const h2 = DOME_RADIUS * DOME_RADIUS - horizontalDistance * horizontalDistance;
    return (h2 > 0 ? Math.sqrt(h2) : 0) - (DOME_RADIUS - SPAWN_Y);
}

export const FADE_START = 2000.0;
export const FADE_SPAN = 400.0;

export function distanceFade(horizontalDistance: number): number {
    if (horizontalDistance >= FIELD_HALF_EXTENT)
        return 0.0;
    if (horizontalDistance < FADE_START)
        return 1.0;
    return 1.0 - (horizontalDistance - FADE_START) / FADE_SPAN;
}

export const TRANSITION_SECONDS = Weather.TRANSITION_SECONDS;

export const WIND_SPEED_DIVISOR = 3.0;

export const WIND_DIRECTION_OCTANTS = Wind.OCTANT_COUNT;

export function windAngleRad(octant: number): number {
    return 2 * Math.PI * (1.0 - octant / WIND_DIRECTION_OCTANTS);
}

export function fieldRotationRad(octant: number): number {
    return windAngleRad(octant) - Math.PI / 2;
}

export function windDrift(dst: vec3, octant: number, speed: number): void {
    const a = windAngleRad(octant);
    const s = speed / WIND_SPEED_DIVISOR;
    vec3.set(dst, -Math.sin(a) * s, 0, -Math.cos(a) * s);
}

export const DEFAULT_WIND_SPEED = Wind.DEFAULT_SPEED_LEVEL;
export const DEFAULT_WIND_OCTANT = Wind.DEFAULT_OCTANT;

//#endregion

//#region Weather Tables

const COUNT_FRACTION: readonly number[] = [0.0, 0.2, 0.5, 1.0, 1.0, 1.0];

// World units: 500, 1600, 2400.
const BASE_SIZE: readonly number[] = [500.0, 500.0, 1600.0, 1600.0, 1600.0, 2400.0];

type WeatherBlend = Weather.WeatherBlend;

export function cloudCount(weather: number): number {
    return Math.round(POOL_SIZE * Weather.tableAt(COUNT_FRACTION, weather));
}

export function baseSize(weather: number): number {
    return Weather.tableAt(BASE_SIZE, weather);
}

//#endregion

//#region Single Cloud

export const enum NodeState {
    FadingIn = 0,
    FadingOut = 1,
    Visible = 2,
}

export interface CloudNode {
    x: number;
    z: number;
    imageIndex: number;
    sizeRand: number;
    // Seconds-of-day - in the past so a node can spawn already partway through its fade.
    spawnTimeSec: number;
    state: NodeState;
}

export function nodeFadeAlpha(state: NodeState, progress: number): number {
    const p = saturate(progress);
    if (state === NodeState.FadingOut)
        return 1.0 - p;
    if (state === NodeState.Visible)
        return 1.0;
    return p;
}

//#endregion

//#region Color

function sumRGB(c: Color): number {
    return c.r + c.g + c.b;
}

export function luminance(ambient: Color, keyLight: Color, keyLightWeatherFactor: number): number {
    return saturate((sumRGB(ambient) + sumRGB(keyLight) * keyLightWeatherFactor) / 3);
}

export function fillCloudColors(dstC0: Color, dstC1: Color, lum: number, weatherCurveC: number, alpha: number): void {
    const a = saturate(alpha);
    colorFromRGBA(dstC0, lum, lum, lum, a);
    const dark = lum * weatherCurveC;
    colorFromRGBA(dstC1, dark, dark, dark, a);
}

//#endregion

//#region Cloud Field

const scratchDrift = vec3.create();

export class CloudField {
    public nodes: CloudNode[] = [];
    private rng: Rng;
    private lastFrom = -1;
    private lastTo = -1;

    constructor(seed: number = 1) {
        this.rng = new Rng(seed >>> 0 || 1);
    }

    // Position anywhere in the field, random image, random size.
    private randomizeAppearance(node: CloudNode): void {
        node.x = (this.rng.next() % SPAWN_MODULUS - SPAWN_BIAS) / SPAWN_DIVISOR;
        node.z = (this.rng.next() % SPAWN_MODULUS - SPAWN_BIAS) / SPAWN_DIVISOR;
        node.imageIndex = this.rng.range(IMAGE_INDEX_MIN, IMAGE_INDEX_MAX);
        node.sizeRand = this.rng.range(SIZE_RAND_MIN, SIZE_RAND_MAX);
    }

    private spawn(nowSec: number, state: NodeState, phase: number): void {
        if (this.nodes.length >= POOL_SIZE)
            return;
        const node: CloudNode = { x: 0, z: 0, imageIndex: 0, sizeRand: 0, spawnTimeSec: 0, state };
        this.randomizeAppearance(node);
        node.spawnTimeSec = Weather.scheduleFade(this.rng, nowSec, TRANSITION_SECONDS, phase);
        this.nodes.push(node);
    }

    private settleFades(): void {
        const kept: CloudNode[] = [];
        for (const node of this.nodes) {
            if (node.state === NodeState.FadingOut)
                continue;
            if (node.state === NodeState.FadingIn)
                node.state = NodeState.Visible;
            kept.push(node);
        }
        this.nodes = kept;
    }

    private resizeForWeather(nowSec: number, weather: WeatherBlend): void {
        this.settleFades();
        const fromCount = cloudCount(weather.from);
        const toCount = cloudCount(weather.to);

        while (this.nodes.length < fromCount)
            this.spawn(nowSec, NodeState.Visible, 1.0);
        while (this.nodes.length > fromCount)
            this.nodes.shift();

        if (fromCount < toCount) {
            for (let i = fromCount; i < toCount; i++)
                this.spawn(nowSec, NodeState.FadingIn, weather.blend);
        } else if (toCount < fromCount) {
            // Fade out the first (fromCount - toCount) nodes in list order.
            for (let i = 0; i < fromCount - toCount && i < this.nodes.length; i++) {
                this.nodes[i].spawnTimeSec = Weather.scheduleFade(this.rng, nowSec, TRANSITION_SECONDS, weather.blend);
                this.nodes[i].state = NodeState.FadingOut;
            }
        }
    }

    // NaN -> no wrap occurred
    private static wrap(v: number): number {
        const span = FIELD_HALF_EXTENT * 2;
        if (v < -FIELD_HALF_EXTENT)
            return v + span;
        if (v > FIELD_HALF_EXTENT)
            return v - span;
        return NaN;
    }

    private tick(nowSec: number, windOctant: number, windSpeed: number, frames: number): void {
        windDrift(scratchDrift, windOctant, windSpeed);
        const dx = scratchDrift[0] * frames, dz = scratchDrift[2] * frames;

        const kept: CloudNode[] = [];
        for (const node of this.nodes) {
            node.x += dx;
            node.z += dz;

            const wx = CloudField.wrap(node.x);
            if (!Number.isNaN(wx)) {
                this.randomizeAppearance(node);
                node.x = wx;
            }
            const wz = CloudField.wrap(node.z);
            if (!Number.isNaN(wz)) {
                this.randomizeAppearance(node);
                node.z = wz;
            }

            const progress = Weather.fadeProgress(nowSec, node.spawnTimeSec, TRANSITION_SECONDS);
            if (node.state === NodeState.FadingOut) {
                if (progress >= 1.0)
                    continue; // faded - free the node
            } else if (node.state === NodeState.FadingIn && progress >= 1.0) {
                node.state = NodeState.Visible;
            }
            kept.push(node);
        }
        this.nodes = kept;
    }

    // deltaSeconds: real time | nowSec: in-game seconds-of-day clock
    public update(nowSec: number, weather: WeatherBlend, windOctant: number, windSpeed: number, deltaSeconds: number): void {
        if (weather.from !== this.lastFrom || weather.to !== this.lastTo) {
            this.lastFrom = weather.from;
            this.lastTo = weather.to;
            this.resizeForWeather(nowSec, weather);
        }
        // Carry leftover so we're independent of frame rate
        const frames = deltaSeconds * Env.ROM_LOGIC_FPS;
        if (frames <= 0)
            return;
        this.tick(nowSec, windOctant, windSpeed, frames);
    }
}

//#endregion

//#region Place one cloud
// Deviation: noclip draws static meshes via a model matrix, so the per-vertex projection can't
// apply literally without rebuilding geometry every frame. Instead each card sits on the dome's
// tangent plane at its own center.

const scratchAxis = vec3.create();
const scratchTranslate = vec3.create();
const scratchScale = vec3.create();

export function cloudScale(node: CloudNode, weather: WeatherBlend): number {
    const size = lerp(baseSize(weather.from), baseSize(weather.to), weather.blend);
    return size * (node.sizeRand + 255) / 255;
}

// dst: full model matrix for one cloud in field space
// aspect: bound image's height/width
export function fillCloudMatrix(dst: mat4, node: CloudNode, weather: WeatherBlend, windOctant: number, aspect: number, originX: number, originY: number, originZ: number): void {
    const d = Math.hypot(node.x, node.z);
    const y = domeHeight(d);
    const scale = cloudScale(node, weather);

    vec3.set(scratchTranslate, originX + node.x, originY + y, originZ + node.z);
    mat4.fromTranslation(dst, scratchTranslate);

    if (d > 1e-4) {
        const tilt = Math.atan2(d, y + (DOME_RADIUS - SPAWN_Y));
        vec3.set(scratchAxis, node.z / d, 0, -node.x / d); // up x radial, normalized
        mat4.rotate(dst, dst, tilt, scratchAxis);
    }

    mat4.rotateY(dst, dst, fieldRotationRad(windOctant));
    vec3.set(scratchScale, scale, 1, scale * aspect);
    mat4.scale(dst, dst, scratchScale);
}

//#endregion
