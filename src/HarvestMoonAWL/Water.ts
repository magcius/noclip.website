// mapwater's surface animation.

import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color } from "../Color.js";
import { assert } from "../util.js";
import * as GX from "../gx/gx_enum.js";
import * as Tpl from "./Tpl.js";

//#region Animator Records

export interface WaterOctave {
    angleRad: number;
    speedPerTick: number;
    tileSize: number;
}

export interface WaterAnim {
    octaves: [WaterOctave, WaterOctave];
    texGenSrc: number;
}

const WATER_ANIM_RIVER: WaterAnim = {
    octaves: [
        { angleRad: 2.9, speedPerTick: 0.08, tileSize: 10.0 },
        { angleRad: 3.3, speedPerTick: 0.05, tileSize: 7.0 },
    ],
    texGenSrc: 0,
};

const WATER_ANIM_OCEAN: WaterAnim = {
    octaves: [
        { angleRad: 6.2, speedPerTick: 0.09, tileSize: 49.8 },
        { angleRad: 3.1, speedPerTick: 0.05, tileSize: 15.8 },
    ],
    texGenSrc: 0,
};

const WATER_ANIM_POND: WaterAnim = {
    octaves: [
        { angleRad: 5.4, speedPerTick: 0.02, tileSize: 10.0 },
        { angleRad: 2.0, speedPerTick: 0.01, tileSize: 8.9 },
    ],
    texGenSrc: 0,
};

const WATER_ANIM_WATERFALL: WaterAnim = {
    octaves: [
        { angleRad: 4.71, speedPerTick: 0.05, tileSize: 3.0 },
        { angleRad: 4.63, speedPerTick: 0.02, tileSize: 1.5 },
    ],
    texGenSrc: 12,
};

const WATER_ANIM_BY_GROUP: WaterAnim[] = [
    WATER_ANIM_POND, 
    WATER_ANIM_RIVER,
    WATER_ANIM_OCEAN,
    WATER_ANIM_POND, // foam-overlay class - handled separately
    WATER_ANIM_POND,
    WATER_ANIM_WATERFALL,
    WATER_ANIM_POND,
    WATER_ANIM_POND,
];

export function animForTypeId(rawTypeId: number, idMod: number): WaterAnim {
    const group = Math.floor(rawTypeId / idMod);
    return WATER_ANIM_BY_GROUP[group] ?? WATER_ANIM_POND;
}

//#endregion

//#region Scrolling texture matrices

export function texGenSrc(anim: WaterAnim): GX.TexGenSrc {
    return anim.texGenSrc === 0 ? GX.TexGenSrc.POS : GX.TexGenSrc.TEX0;
}

function wrapUnit(v: number): number {
    return v - Math.floor(v);
}

export function fillTexMtx(dst: mat4, anim: WaterAnim, octaveIndex: number, ticks: number): void {
    const oct = anim.octaves[octaveIndex];
    const s = 1.0 / oct.tileSize;
    const vx = oct.speedPerTick * Math.cos(oct.angleRad);
    const vPerp = -oct.speedPerTick * Math.sin(oct.angleRad);

    for (let i = 0; i < 16; i++)
        dst[i] = 0;

    if (anim.texGenSrc === 0) {
        const tz = vPerp * ticks;
        const tx = vx * ticks;
        dst[8] = s;
        dst[1] = -s;
        dst[12] = wrapUnit(-s * tz);
        dst[13] = wrapUnit(s * tx + 1.0);
    } else {
        const tx = vx * ticks;
        const ty = vPerp * ticks;
        dst[0] = s;
        dst[5] = s;
        dst[12] = wrapUnit(-s * tx);
        dst[13] = wrapUnit(-s * ty);
    }
}

//#endregion

//#region Bump slope map

const BUMP_ENCODE_BIAS = 128.0;
const BUMP_ENCODE_SCALE = 127.0;

export function gxTiledOffset(x: number, y: number, width: number, blockW: number, blockH: number, bytesPerTexel: number): number {
    const blockX = (x / blockW) | 0, blockY = (y / blockH) | 0;
    const inX = x % blockW, inY = y % blockH;
    return bytesPerTexel * (blockY * width * blockH + blockX * blockW * blockH + inY * blockW + inX);
}

export function buildBumpSlopeMap(src: Tpl.Tpl): Tpl.Tpl {
    const tex = src.textures[0];
    assert(tex.format === GX.TexFormat.I8, `mapwater-bump.tpl should be I8, got format ${tex.format}`);
    const width = tex.width, height = tex.height;
    assert(tex.data !== null, `mapwater-bump.tpl image 0 has no data`);
    const srcView = tex.data.createDataView();

    const h = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            h[y * width + x] = srcView.getUint8(gxTiledOffset(x, y, width, 8, 4, 1)) / 255.0;

    const k = height;
    const dst = new Uint8Array(width * height * 2);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const h0 = h[y * width + x];
            const dU = k * (h0 - h[y * width + ((x + 1) % width)]);
            const dV = k * (h0 - h[((y + 1) % height) * width + x]);
            const len = Math.hypot(dU, 1.0, dV);
            const nx = -dU / len, nz = -dV / len;
            const offs = gxTiledOffset(x, y, width, 4, 4, 2);
            dst[offs + 0] = (BUMP_ENCODE_BIAS + BUMP_ENCODE_SCALE * nx) | 0;
            dst[offs + 1] = (BUMP_ENCODE_BIAS + BUMP_ENCODE_SCALE * -nz) | 0;
        }
    }

    return {
        textures: [{
            name: `${tex.name} (slope map)`,
            format: GX.TexFormat.IA8,
            width, height,
            data: new ArrayBufferSlice(dst.buffer),
            mipCount: 1,
            wrapS: tex.wrapS, wrapT: tex.wrapT,
            minFilter: tex.minFilter, magFilter: tex.magFilter,
            lodBias: 0, edgeLOD: 0, minLOD: 0, maxLOD: 0,
            paletteFormat: GX.TexPalette.IA8, paletteData: null,
        }],
    };
}

export const BASE_IMAGE_INDEX = 1;

//#endregion

//#region Shoreline Foam Overlay

export const FOAM_CYCLE_TICKS = 240;
export const FOAM_PHASE_TICKS: readonly number[] = [0, 120];

export const FOAM_IMAGE_INDEX = 0;

const FOAM_SWEEP_RAD = 2.0943951;
const FOAM_TRAVEL_X = 16.0;
const FOAM_FADE_IN_TICKS = 30;
const FOAM_FADE_OUT_START = 119;
const FOAM_FADE_OUT_TICKS = 120;
const FOAM_ALPHA_SCALE = 255.0;

export interface FoamState {
    alpha: number;
    offsetX: number;
}

export const TINT_PASS_GROUP = 6;
export const TINT_PASS_COLOR: [number, number, number, number] = [0x9b, 0xc5, 0x44, 0x60];

export function isTintPassGroup(rawTypeId: number, idMod: number): boolean {
    return Math.floor(rawTypeId / idMod) === TINT_PASS_GROUP;
}

export function tintPassColor(dst: Color, waterTint: Color): void {
    dst.r = (TINT_PASS_COLOR[0] / 255) * waterTint.r;
    dst.g = (TINT_PASS_COLOR[1] / 255) * waterTint.g;
    dst.b = (TINT_PASS_COLOR[2] / 255) * waterTint.b;
    dst.a = TINT_PASS_COLOR[3] / 255;
}

export function isFoamOverlay(rawTypeId: number, idMod: number): boolean {
    return Math.floor(rawTypeId / idMod) === 3;
}

export function foamState(dst: FoamState, ticks: number, phaseTicks: number): void {
    let t = (ticks + phaseTicks) % FOAM_CYCLE_TICKS;
    if (t < 0)
        t += FOAM_CYCLE_TICKS;

    dst.offsetX = -FOAM_TRAVEL_X * (1.0 - Math.sin((FOAM_SWEEP_RAD * t) / FOAM_CYCLE_TICKS));

    let a: number;
    if (t < FOAM_FADE_IN_TICKS)
        a = t / FOAM_FADE_IN_TICKS;
    else if (t > FOAM_FADE_OUT_START)
        a = (FOAM_CYCLE_TICKS - t) / FOAM_FADE_OUT_TICKS;
    else
        a = 1.0;
    dst.alpha = Math.min(1.0, Math.trunc(FOAM_ALPHA_SCALE * a) / FOAM_ALPHA_SCALE);
}

export function buildFoamTexture(src: Tpl.Tpl): Tpl.Tpl {
    const tex = src.textures[FOAM_IMAGE_INDEX];
    return {
        textures: [{
            ...tex,
            name: `${tex.name} (foam overlay)`,
            wrapS: GX.WrapMode.CLAMP,
            wrapT: GX.WrapMode.CLAMP,
            minFilter: GX.TexFilter.LINEAR,
            magFilter: GX.TexFilter.LINEAR,
        }],
    };
}

//#endregion
