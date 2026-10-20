// The pasture's grass, with variable lengths and color dependent on season

import { ReadonlyMat4, vec3 } from "gl-matrix";
import { saturate } from "../MathHelpers.js";
import { Rng } from "./Rng.js";
import * as Season from "./Season.js";
import { cameraRay, wrapMod } from "./Util.js";

//#region Field geometry and constants

export const TILE_COUNT = 572;
export const FIELD_COLS = 22;
export const FIELD_ROWS = TILE_COUNT / FIELD_COLS; // 26

export const ORIGIN_X = 181.0;
export const ORIGIN_Z = 128.0;
export const TILE_CENTER = 0.5;
export const FIELD_Y = 13.0;

export const STAGE_COUNT = 4;
export const VARIANT_COUNT = 2;

export const VARIANT_GREEN = 0;
export const VARIANT_BROWN = 1;

// A bit big to prevent accidentally culling the edge
export const TILE_CULL_RADIUS = 1.225;

// Grass that's removed when the pond layer is enabled
export const POND_CUTOUT_RECT = { xMin: 192.0, xMax: 196.0, zMin: 133.0, zMax: 137.0 };

//#endregion

//#region Tile Placement

export function tilePosition(dst: vec3, index: number): vec3 {
    const row = (index / FIELD_COLS) | 0, col = index % FIELD_COLS;
    return vec3.set(dst, ORIGIN_X + row + TILE_CENTER, FIELD_Y, ORIGIN_Z + col + TILE_CENTER);
}

export function tileInPondCutout(index: number): boolean {
    const row = (index / FIELD_COLS) | 0, col = index % FIELD_COLS;
    const x = ORIGIN_X + row + TILE_CENTER, z = ORIGIN_Z + col + TILE_CENTER;
    return x >= POND_CUTOUT_RECT.xMin && x <= POND_CUTOUT_RECT.xMax
        && z >= POND_CUTOUT_RECT.zMin && z <= POND_CUTOUT_RECT.zMax;
}

export function imageIndex(stage: number, variant: number): number {
    return stage * VARIANT_COUNT + variant;
}

//#endregion

//#region Variants
// As autumn progresses, an increasing portion of the field browns
// Reverse occurs for winter to spring

const VARIANT_ROLLS = (() => {
    const rng = new Rng(1), out = new Uint8Array(TILE_COUNT);
    for (let i = 0; i < TILE_COUNT; i++)
        out[i] = rng.next() % 100;
    return out;
})();

function brownThresholdAutumn(index: number, day: number): number {
    const v = (TILE_COUNT - (index + 1)) - 114 * (day - 4);
    return 100 - ((Math.max(v, 0) * 100 / TILE_COUNT) | 0);
}

function greenThresholdWinter(index: number, day: number): number {
    const v = index - 143 * (day - 7);
    return 100 - ((Math.max(v, 0) * 100 / TILE_COUNT) | 0);
}

function cumulativeProbability(threshold: (index: number, day: number) => number, index: number, firstDay: number, day: number): number {
    let untouched = 1.0;
    for (let k = firstDay; k <= day; k++)
        untouched *= 1.0 - saturate((threshold(index, k) + 1) / 100);
    return 1.0 - untouched;
}

export function tileVariant(index: number, season: number, day: number): number {
    // Always green in spring, summer
    if (season === 0 || season === 1)
        return VARIANT_GREEN;
    if (season === 2) {
        if (day >= 8)
            return VARIANT_BROWN;
        if (day >= 4 && VARIANT_ROLLS[index] < 100 * cumulativeProbability(brownThresholdAutumn, index, 4, day))
            return VARIANT_BROWN;
        return VARIANT_GREEN;
    }
    if (day >= 7 && VARIANT_ROLLS[index] < 100 * cumulativeProbability(greenThresholdWinter, index, 7, day))
        return VARIANT_GREEN;
    return VARIANT_BROWN;
}

export function fillVariants(dst: Uint8Array, season: number, day: number): void {
    for (let i = 0; i < TILE_COUNT; i++)
        dst[i] = tileVariant(i, season, day);
}

//#endregion

//#region Cut Grass
// An easter egg - press F to cut a 3x3 square of grass


// Cut the grass to this stage of growth
export const CUT_STAGE = 0;

export const CUT_RADIUS = 1;

export const MESH_HEIGHT = 0.908;

export const CUT_AIM_MAX_DISTANCE = 12.0;

const scratchEye = vec3.create();
const scratchForward = vec3.create();

export function tileIndexAt(x: number, z: number): number {
    const row = Math.floor(x - ORIGIN_X), col = Math.floor(z - ORIGIN_Z);
    if (row < 0 || row >= FIELD_ROWS || col < 0 || col >= FIELD_COLS)
        return -1;
    return row * FIELD_COLS + col;
}

export function aimedTile(cameraWorldMatrix: ReadonlyMat4): number {
    cameraRay(scratchEye, scratchForward, cameraWorldMatrix);

    const planeY = FIELD_Y + MESH_HEIGHT * 0.5;
    const denom = scratchForward[1];
    if (Math.abs(denom) < 1e-6)
        return -1;
    const t = (planeY - scratchEye[1]) / denom;
    if (t <= 0 || t > CUT_AIM_MAX_DISTANCE)
        return -1;
    return tileIndexAt(scratchEye[0] + scratchForward[0] * t, scratchEye[2] + scratchForward[2] * t);
}

//#endregion

//#region GrassField

export class GrassField {
    public stage = STAGE_COUNT - 1;
    public pondCutout = false;
    public season = 0;
    public day = Season.DEFAULT_DAY;

    public variants = new Uint8Array(TILE_COUNT);

    // Easter egg - tiles cut
    public cut = new Uint8Array(TILE_COUNT);
    public cutCount = 0;

    private lastSeason = -1;
    private lastDay = -1;

    public cutAround(index: number): number {
        if (index < 0 || index >= TILE_COUNT)
            return 0;
        const row = (index / FIELD_COLS) | 0, col = index % FIELD_COLS;
        let n = 0;
        for (let dr = -CUT_RADIUS; dr <= CUT_RADIUS; dr++) {
            const r = row + dr;
            if (r < 0 || r >= FIELD_ROWS)
                continue;
            for (let dc = -CUT_RADIUS; dc <= CUT_RADIUS; dc++) {
                const c = col + dc;
                if (c < 0 || c >= FIELD_COLS)
                    continue;
                const i = r * FIELD_COLS + c;
                if (this.cut[i] === 0) {
                    this.cut[i] = 1;
                    this.cutCount++;
                    n++;
                }
            }
        }
        return n;
    }

    public clearCuts(): void {
        this.cut.fill(0);
        this.cutCount = 0;
    }

    public update(): boolean {
        const day = wrapMod(this.day, Season.DAYS_PER_SEASON);
        if (this.season === this.lastSeason && day === this.lastDay)
            return false;
        this.lastSeason = this.season;
        this.lastDay = day;
        fillVariants(this.variants, this.season, day);
        return true;
    }

    public invalidate(): void {
        this.lastSeason = -1;
        this.lastDay = -1;
    }
}

//#endregion
