// Outdoor lamp lighting

import { mat4 } from "gl-matrix";

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as GX from "../gx/gx_enum.js";
import * as Tpl from "./Tpl.js";
import { gxTiledOffset } from "./Water.js";

//#region On/Off Clock

//04:00 and 19:00.
export const LAMPS_OFF_FROM_SEC = 14400;
export const LAMPS_OFF_UNTIL_SEC = 68400;

export function lampsOn(timeSeconds: number): boolean {
    return timeSeconds < LAMPS_OFF_FROM_SEC || timeSeconds > LAMPS_OFF_UNTIL_SEC;
}

//#endregion

//#region Glow Billboards

export const GLOW_HALF_SIZE = 2.5;

export interface LampGlow {
    // The lamp head's offset from its base
    offset: [number, number, number];
    imageIndex: number;
}

export const GLOWS_BY_TYPE: LampGlow[][] = [
    [{ offset: [0.0, 4.10, 0.0], imageIndex: 2 }],
    [{ offset: [0.0, 4.00, 0.0], imageIndex: 2 }],
    // This lamp type has two heads
    [{ offset: [-0.75, 4.35, 0.0], imageIndex: 2 }, { offset: [0.75, 4.80, 0.0], imageIndex: 2 }],
    [{ offset: [0.73, 2.35, 0.58], imageIndex: 3 }],
];

//#endregion

//#region Night texture swap

export const LIT_ATLAS_IMAGE_BY_MAPOBJ_IMAGE: ReadonlyMap<number, number> = new Map([
    [4, 0],
    [20, 1],
    [24, 2],
]);

export function litAtlasImageIndex(mapobjImageIndex: number): number | undefined {
    return LIT_ATLAS_IMAGE_BY_MAPOBJ_IMAGE.get(mapobjImageIndex);
}

export interface LitSource {
    file: "maplamp" | "mapwindow";
    colorImageIndex: number;
    alphaImageIndex: number;
}

export const LIT_SOURCE_IMAGES: LitSource[] = [
    { file: "maplamp", colorImageIndex: 0, alphaImageIndex: 1 },
    { file: "mapwindow", colorImageIndex: 0, alphaImageIndex: 1 },
    { file: "mapwindow", colorImageIndex: 2, alphaImageIndex: 3 },
];

export function litAtlasTpls(maplamp: Tpl.Tpl, mapwindow: Tpl.Tpl): [Tpl.Tpl, Tpl.Tpl] {
    const src = { maplamp, mapwindow };
    return [
        { textures: LIT_SOURCE_IMAGES.map((s) => src[s.file].textures[s.colorImageIndex]) },
        { textures: LIT_SOURCE_IMAGES.map((s) => src[s.file].textures[s.alphaImageIndex]) },
    ];
}

//#endregion

//#region Ground light pool

export const POOL_HALF_SIZE = 8.0;
export const POOL_IMAGE_INDEX = 2;

export const LIGHT_MAP_TEXELS_PER_UNIT = 4;
const LIGHT_MAP_MARGIN = 8.0;
const NEUTRAL_TEXEL = 0x80;

export const LIGHT_MAP_OFF_IMAGE = 0;
export const LIGHT_MAP_ON_IMAGE = 1;

export interface LightMap {
    tpl: Tpl.Tpl;
    worldToUv: mat4;
}

function zeroMat4(): mat4 {
    const m = mat4.create();
    for (let i = 0; i < 16; i++)
        m[i] = 0;
    return m;
}

function neutralI8Texture(name: string, width: number, height: number, data: Uint8Array): Tpl.TplTexture {
    return {
        name, format: GX.TexFormat.I8, width, height,
        data: new ArrayBufferSlice(data.buffer), mipCount: 1,
        wrapS: GX.WrapMode.CLAMP, wrapT: GX.WrapMode.CLAMP,
        minFilter: GX.TexFilter.LINEAR, magFilter: GX.TexFilter.LINEAR,
        lodBias: 0, edgeLOD: 0, minLOD: 0, maxLOD: 0,
        paletteFormat: GX.TexPalette.IA8, paletteData: null,
    };
}

function neutralLightMap(): LightMap {
    const neutral = new Uint8Array(8 * 4).fill(NEUTRAL_TEXEL);
    const tex = neutralI8Texture("lamp light map (neutral)", 8, 4, neutral);
    return { tpl: { textures: [tex, tex] }, worldToUv: zeroMat4() };
}

function rgba8Texel(view: DataView, x: number, y: number, width: number): [number, number, number, number] {
    const block = ((y >>> 2) * (width >>> 2) + (x >>> 2)) * 64;
    const texel = ((y & 3) * 4 + (x & 3)) * 2;
    return [
        view.getUint8(block + texel + 1),       // R
        view.getUint8(block + 32 + texel + 0),  // G
        view.getUint8(block + 32 + texel + 1),  // B
        view.getUint8(block + texel + 0),       // A
    ];
}

export function buildLightMap(poolTex: Tpl.TplTexture | undefined, lampPositions: [number, number, number][]): LightMap {
    if (poolTex === undefined || lampPositions.length === 0 || poolTex.format !== GX.TexFormat.RGBA8 || poolTex.data === null)
        return neutralLightMap();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of lampPositions) {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    }
    const pad = POOL_HALF_SIZE + LIGHT_MAP_MARGIN;
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

    const texelsPerUnit = LIGHT_MAP_TEXELS_PER_UNIT;

    const width = Math.ceil((maxX - minX) * texelsPerUnit / 8) * 8;
    const height = Math.ceil((maxZ - minZ) * texelsPerUnit / 4) * 4;
    maxX = minX + width / texelsPerUnit;
    maxZ = minZ + height / texelsPerUnit;

    const acc = new Float32Array(width * height).fill(NEUTRAL_TEXEL / 255);
    const poolView = poolTex.data.createDataView();
    for (const p of lampPositions) {
        const x0 = Math.round((p[0] - POOL_HALF_SIZE - minX) * texelsPerUnit);
        const z0 = Math.round((p[2] - POOL_HALF_SIZE - minZ) * texelsPerUnit);
        for (let ty = 0; ty < poolTex.height; ty++) {
            const y = z0 + ty;
            if (y < 0 || y >= height)
                continue;
            for (let tx = 0; tx < poolTex.width; tx++) {
                const x = x0 + tx;
                if (x < 0 || x >= width)
                    continue;
                const [r, , , a] = rgba8Texel(poolView, tx, ty, poolTex.width);

                const src = Math.min(1, 0.5 + r / 255);
                const srcAlpha = a / 255;
                const i = y * width + x;
                acc[i] = src * srcAlpha + acc[i] * (1 - srcAlpha);
            }
        }
    }

    // Image 0: the flat neutral. Image 1: the map.
    const neutral = new Uint8Array(8 * 4).fill(NEUTRAL_TEXEL);
    const baked = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            baked[gxTiledOffset(x, y, width, 8, 4, 1)] = Math.min(255, Math.round(acc[y * width + x] * 255));

    const worldToUv = zeroMat4();
    const sx = 1 / (maxX - minX), sz = 1 / (maxZ - minZ);
    worldToUv[0] = sx;           // row 0, col 0:  S <- x
    worldToUv[12] = -minX * sx;  // row 0, translation
    worldToUv[9] = sz;           // row 1, col 2:  T <- z
    worldToUv[13] = -minZ * sz;  // row 1, translation

    return {
        tpl: {
            textures: [
                neutralI8Texture("lamp light map (neutral)", 8, 4, neutral),
                neutralI8Texture("lamp light map", width, height, baked),
            ],
        },
        worldToUv,
    };
}

//#endregion
