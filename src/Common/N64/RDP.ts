
// Common utilities for the N64 Reality Display Processor (RDP).

import { assert, hexzero } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { ImageSize, ImageFormat, decodeTex_CI4, decodeTex_CI8, decodeTex_IA8, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_I8, decodeTex_I4, decodeTex_IA16, parseTLUT, TextureLUT, decodeTex_IA4, TexCM } from "./Image";
import { GfxDevice, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache";

export const enum CCMUX {
    COMBINED    = 0,
    TEXEL0      = 1,
    TEXEL1      = 2,
    PRIMITIVE   = 3,
    SHADE       = 4,
    ENVIRONMENT = 5,
    ONE         = 6,
    ADD_ZERO    = 7,
    // param C only
    COMBINED_A  = 7, // only for C
    TEXEL0_A    = 8,
    TEXEL1_A    = 9,
    PRIMITIVE_A = 10,
    SHADE_A     = 11,
    ENV_A       = 12,
    PRIM_LOD    = 14,
    MUL_ZERO    = 15, // should really be 31
}

export const enum ACMUX {
    ADD_COMBINED = 0,
    TEXEL0 = 1,
    TEXEL1 = 2,
    PRIMITIVE = 3,
    SHADE = 4,
    ENVIRONMENT = 5,
    ADD_ONE = 6,
    ZERO = 7,
}

export interface ColorCombinePass {
    a: CCMUX;
    b: CCMUX;
    c: CCMUX;
    d: CCMUX;
}

export interface AlphaCombinePass {
    a: ACMUX;
    b: ACMUX;
    c: ACMUX;
    d: ACMUX;
}

export interface CombineParams {
    c0: ColorCombinePass;
    a0: AlphaCombinePass;
    c1: ColorCombinePass;
    a1: AlphaCombinePass;
}

export function decodeCombineParams(w0: number, w1: number): CombineParams {
    // because we aren't implementing all the combine input options (notably, not noise)
    // and the highest values are just 0, we can get away with throwing away high bits:
    // ax,bx,dx can be 3 bits, and cx can be 4
    const a0  = (w0 >>> 20) & 0x07;
    const c0  = (w0 >>> 15) & 0x0f;
    const Aa0 = (w0 >>> 12) & 0x07;
    const Ac0 = (w0 >>> 9) & 0x07;
    const a1  = (w0 >>> 5) & 0x07;
    const c1  = (w0 >>> 0) & 0x0f;
    const b0  = (w1 >>> 28) & 0x07;
    const b1  = (w1 >>> 24) & 0x07;
    const Aa1 = (w1 >>> 21) & 0x07;
    const Ac1 = (w1 >>> 18) & 0x07;
    const d0  = (w1 >>> 15) & 0x07;
    const Ab0 = (w1 >>> 12) & 0x07;
    const Ad0 = (w1 >>> 9) & 0x07;
    const d1  = (w1 >>> 6) & 0x07;
    const Ab1 = (w1 >>> 3) & 0x07;
    const Ad1 = (w1 >>> 0) & 0x07;

    // CCMUX.ONE only applies to params a and d, the others are not implemented
    assert(b0 !== CCMUX.ONE && c0 !== CCMUX.ONE && b1 !== CCMUX.ONE && c1 !== CCMUX.ONE);

    return {
        c0: { a: a0, b: b0, c: c0, d: d0 },
        a0: { a: Aa0, b: Ab0, c: Ac0, d: Ad0 },
        c1: { a: a1, b: b1, c: c1, d: d1 },
        a1: { a: Aa1, b: Ab1, c: Ac1, d: Ad1 }
    };
}

function colorCombinePassUsesT0(ccp: ColorCombinePass) {
    return (ccp.a == CCMUX.TEXEL0) || (ccp.a == CCMUX.TEXEL0_A) ||
        (ccp.b == CCMUX.TEXEL0) || (ccp.b == CCMUX.TEXEL0_A) ||
        (ccp.c == CCMUX.TEXEL0) || (ccp.c == CCMUX.TEXEL0_A) ||
        (ccp.d == CCMUX.TEXEL0) || (ccp.d == CCMUX.TEXEL0_A);
}

function alphaCombinePassUsesT0(acp: AlphaCombinePass) {
    return (acp.a == ACMUX.TEXEL0 || acp.b == ACMUX.TEXEL0 || acp.c == ACMUX.TEXEL0 || acp.d == ACMUX.TEXEL0);
}

export function combineParamsUsesT0(cp: CombineParams) {
    return colorCombinePassUsesT0(cp.c0) || colorCombinePassUsesT0(cp.c1) ||
        alphaCombinePassUsesT0(cp.a0) || alphaCombinePassUsesT0(cp.a1);
}

function colorCombinePassUsesT1(ccp: ColorCombinePass) {
    return (ccp.a == CCMUX.TEXEL1) || (ccp.a == CCMUX.TEXEL1_A) ||
        (ccp.b == CCMUX.TEXEL1) || (ccp.b == CCMUX.TEXEL1_A) ||
        (ccp.c == CCMUX.TEXEL1) || (ccp.c == CCMUX.TEXEL1_A) ||
        (ccp.d == CCMUX.TEXEL1) || (ccp.d == CCMUX.TEXEL1_A);
}

function alphaCombinePassUsesT1(acp: AlphaCombinePass) {
    return (acp.a == ACMUX.TEXEL1 || acp.b == ACMUX.TEXEL1 || acp.c == ACMUX.TEXEL1 || acp.d == ACMUX.TEXEL1);
}

export function combineParamsUsesT1(cp: CombineParams) {
    return colorCombinePassUsesT1(cp.c0) || colorCombinePassUsesT1(cp.c1) ||
        alphaCombinePassUsesT1(cp.a0) || alphaCombinePassUsesT1(cp.a1);
}

export class Texture {
    public name: string;
    public format = 'rgba8';
    public tile = new TileState();

    constructor(tile: TileState, public dramAddr: number, public dramPalAddr: number, public width: number, public height: number, public pixels: Uint8Array) {
        this.tile.copy(tile);
        const nameAddr = tile.cacheKey !== 0 ? tile.cacheKey : this.dramAddr;
        this.name = hexzero(nameAddr, 8);
    }
}

export class TileState {
    public cacheKey: number = 0;
    public fmt: number = 0;
    public siz: number = 0;
    public line: number = 0;
    public tmem: number = 0;
    public palette: number = 0;
    public cmt: number = 0;
    public maskt: number = 0;
    public shiftt: number = 0;
    public cms: number = 0;
    public masks: number = 0;
    public shifts: number = 0;
    public uls: number = 0;
    public ult: number = 0;
    public lrs: number = 0;
    public lrt: number = 0;

    public set(fmt: number, siz: number, line: number, tmem: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        this.fmt = fmt; this.siz = siz; this.line = line; this.tmem = tmem; this.palette = palette; this.cmt = cmt; this.maskt = maskt; this.shiftt = shiftt; this.cms = cms; this.masks = masks; this.shifts = shifts;
    }

    public setSize(uls: number, ult: number, lrs: number, lrt: number): void {
        this.uls = uls; this.ult = ult; this.lrs = lrs; this.lrt = lrt;
    }

    public copy(o: TileState): void {
        this.set(o.fmt, o.siz, o.line, o.tmem, o.palette, o.cmt, o.maskt, o.shiftt, o.cms, o.masks, o.shifts);
        this.setSize(o.uls, o.ult, o.lrs, o.lrt);
        this.cacheKey = o.cacheKey;
    }
}

function translateTLUT(dst: Uint8Array, segmentBuffers: ArrayBufferSlice[], dramAddr: number, siz: ImageSize): void {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    const srcIdx = dramAddr & 0x00FFFFFF;
    parseTLUT(dst, view, srcIdx, siz, TextureLUT.G_TT_RGBA16);
}

const tlutColorTable = new Uint8Array(256 * 4);

export function getTileWidth(tile: TileState): number {
    const coordWidth = ((tile.lrs - tile.uls) >>> 2) + 1;
    if (tile.masks !== 0)
        return Math.min(1 << tile.masks, coordWidth)
    else
        return coordWidth;
}

export function getTileHeight(tile: TileState): number {
    const coordHeight = ((tile.lrt - tile.ult) >>> 2) + 1;
    if (tile.maskt !== 0)
        return Math.min(1 << tile.maskt, coordHeight)
    else
        return coordHeight;
}

export function getMaskedCMS(tile: TileState): number {
    const coordWidth = ((tile.lrs - tile.uls) >>> 2) + 1;
    if (tile.masks !== 0 && (1 << tile.masks) < coordWidth)
        return tile.cms & 1;
    return tile.cms;
}

export function getMaskedCMT(tile: TileState): number {
    const coordHeight = ((tile.lrt - tile.ult) >>> 2) + 1;
    if (tile.maskt !== 0 && (1 << tile.maskt) < coordHeight)
        return tile.cmt & 1;
    return tile.cmt;
}

export function texturePadWidth(siz: ImageSize, line: number, width: number): number {
    if (line === 0)
        return 0;
    const padTexels = (line << (4 - siz)) - width;
    if (siz === ImageSize.G_IM_SIZ_4b)
        return padTexels >>> 1;
    else
        return padTexels << (siz - 1);
}

export function translateTileTexture(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState, deinterleave: boolean = false): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    if (tile.fmt === ImageFormat.G_IM_FMT_CI)
        translateTLUT(tlutColorTable, segmentBuffers, dramPalAddr, tile.siz);

    const tileW = getTileWidth(tile);
    const tileH = getTileHeight(tile);

    // TODO(jstpierre): Support more tile parameters
    // assert(tile.shifts === 0); // G_TX_NOLOD
    // assert(tile.shiftt === 0); // G_TX_NOLOD

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    switch ((tile.fmt << 4) | tile.siz) {
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_4b):  decodeTex_CI4(dst, view, srcIdx, tileW, tileH, tlutColorTable, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_8b):  decodeTex_CI8(dst, view, srcIdx, tileW, tileH, tlutColorTable, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_4b):  decodeTex_IA4(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_8b):  decodeTex_IA8(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_16b): decodeTex_IA16(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_I    << 4 | ImageSize.G_IM_SIZ_4b):  decodeTex_I4(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_I    << 4 | ImageSize.G_IM_SIZ_8b):  decodeTex_I8(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_16b): decodeTex_RGBA16(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_32b): decodeTex_RGBA32(dst, view, srcIdx, tileW, tileH); break;
    default:
        throw new Error(`Unknown image format ${tile.fmt} / ${tile.siz}`);
    }
    const out = new Texture(tile, dramAddr, dramPalAddr, tileW, tileH, dst);

    return out;
}

// figure out if two textures with the same underlying data can reuse the same texture object
// we assume that a texture has only one real size/tiling behavior, so just match on coords

// TODO(jstpierre): Build a better upload tracker
function textureMatch(a: TileState, b: TileState): boolean {
    return a.uls === b.uls && a.ult === b.ult && a.lrs === b.lrs && a.lrt === b.lrt && a.cacheKey === b.cacheKey;
}

export class TextureCache {
    public textures: Texture[] = [];

    public translateTileTexture(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState, deinterleave: boolean = false): number {
        const existingIndex = this.textures.findIndex((t) => t.dramAddr === dramAddr && (tile.fmt !== ImageFormat.G_IM_FMT_CI || t.dramPalAddr === dramPalAddr) && textureMatch(t.tile, tile));
        if (existingIndex >= 0) {
            return existingIndex;
        } else {
            const texture = translateTileTexture(segmentBuffers, dramAddr, dramPalAddr, tile, deinterleave);
            const index = this.textures.length;
            this.textures.push(texture);
            return index;
        }
    }
}

export function translateToGfxTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    const hostAccessPass = device.createHostAccessPass();
    hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    device.submitPass(hostAccessPass);
    return gfxTexture;
}

export function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
    case TexCM.WRAP:   return GfxWrapMode.REPEAT;
    case TexCM.MIRROR: return GfxWrapMode.MIRROR;
    case TexCM.CLAMP:  return GfxWrapMode.CLAMP;
    case TexCM.MIRROR_CLAMP:  return GfxWrapMode.MIRROR;
    }
}

export function translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
    return cache.createSampler(device, {
        // if the tile uses clamping, but sets the mask to a size smaller than the actual image size,
        // it should repeat within the coordinate range, and clamp outside
        // then ignore clamping here, and handle it in the shader
        wrapS: translateCM(getMaskedCMS(texture.tile)),
        wrapT: translateCM(getMaskedCMT(texture.tile)),
        minFilter: GfxTexFilterMode.POINT,
        magFilter: GfxTexFilterMode.POINT,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0, maxLOD: 0,
    });
}