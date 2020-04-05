
import { assert } from "../../util";
import { texturePadWidth } from "./RDP";

export const enum ImageFormat {
    G_IM_FMT_RGBA = 0x00,
    G_IM_FMT_YUV  = 0x01,
    G_IM_FMT_CI   = 0x02,
    G_IM_FMT_IA   = 0x03,
    G_IM_FMT_I    = 0x04,
}

export const enum ImageSize {
    G_IM_SIZ_4b   = 0x00,
    G_IM_SIZ_8b   = 0x01,
    G_IM_SIZ_16b  = 0x02,
    G_IM_SIZ_32b  = 0x03,
}

export const enum TextureLUT {
    G_TT_NONE     = 0x00,
    G_TT_RGBA16   = 0x02,
    G_TT_IA16     = 0x03,
}

export const enum TexCM {
    WRAP = 0x00, MIRROR = 0x01, CLAMP = 0x02, MIRROR_CLAMP = 0x03,
}

export const enum TextFilt {
    G_TF_POINT   = 0x00,
    G_TF_AVERAGE = 0x03,
    G_TF_BILERP  = 0x02,
}

export function getSizBitsPerPixel(siz: ImageSize): number {
    switch (siz) {
    case ImageSize.G_IM_SIZ_4b:  return 4;
    case ImageSize.G_IM_SIZ_8b:  return 8;
    case ImageSize.G_IM_SIZ_16b: return 16;
    case ImageSize.G_IM_SIZ_32b: return 32;
    default: throw "whoops";
    }
}

export function getTLUTSize(siz: ImageSize) {
    switch (siz) {
    case ImageSize.G_IM_SIZ_4b:  return 0x10;
    case ImageSize.G_IM_SIZ_8b:  return 0x100;
    case ImageSize.G_IM_SIZ_16b: return 0x1000;
    case ImageSize.G_IM_SIZ_32b: return 0x10000;
    default: throw "whoops";
    }
}

function expand3to8(n: number): number {
    return ((n << (8 - 3)) | (n << (8 - 6)) | (n >>> (9 - 8))) & 0xFF;
}

function expand4to8(n: number): number {
    return ((n << (8 - 4)) | (n >>> (8 - 8))) & 0xFF;
}

function expand5to8(n: number): number {
    return ((n << (8 - 5)) | (n >>> (10 - 8))) & 0xFF;
}

function r5g5b5a1(dst: Uint8Array, dstOffs: number, p: number) {
    dst[dstOffs + 0] = expand5to8((p & 0xF800) >> 11);
    dst[dstOffs + 1] = expand5to8((p & 0x07C0) >> 6);
    dst[dstOffs + 2] = expand5to8((p & 0x003E) >> 1);
    dst[dstOffs + 3] = (p & 0x0001) ? 0xFF : 0x00;
}

function copyTLUTColor(dst: Uint8Array, dstOffs: number, colorTable: Uint8Array, i: number): void {
    dst[dstOffs + 0] = colorTable[(i * 4) + 0];
    dst[dstOffs + 1] = colorTable[(i * 4) + 1];
    dst[dstOffs + 2] = colorTable[(i * 4) + 2];
    dst[dstOffs + 3] = colorTable[(i * 4) + 3];
}

export function decodeTex_RGBA16(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, line: number = 0, deinterleave: boolean = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_16b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x++) {
            const p = view.getUint16(srcOffs + (srcIdx ^ di));
            r5g5b5a1(dst, dstIdx + 0, p);
            srcIdx += 0x02;
            dstIdx += 0x04;
        }
        srcIdx += padW;
    }
}

export function decodeTex_RGBA32(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number): void {
    let dstIdx = 0;
    const padW = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x++) {
            const p = view.getUint32(srcIdx);
            dst[dstIdx + 0] = (p >>> 24) & 0xFF;
            dst[dstIdx + 1] = (p >>> 16) & 0xFF;
            dst[dstIdx + 2] = (p >>>  8) & 0xFF;
            dst[dstIdx + 3] = (p >>>  0) & 0xFF;
            srcIdx += 0x04;
            dstIdx += 0x04;
        }
        srcIdx += padW;
    }
}

export function decodeTex_CI4(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, tlutColorTable: Uint8Array, line = 0, deinterleave = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_4b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x += 2) {
            const b = view.getUint8(srcOffs + (srcIdx ^ di));
            copyTLUTColor(dst, dstIdx + 0, tlutColorTable, (b >>> 4) & 0x0F);
            copyTLUTColor(dst, dstIdx + 4, tlutColorTable, (b >>> 0) & 0x0F);
            srcIdx += 0x01;
            dstIdx += 0x08;
        }
        srcIdx += padW;
    }
}

export function decodeTex_CI8(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, tlutColorTable: Uint8Array, line = 0, deinterleave = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_8b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x++) {
            const b = view.getUint8(srcOffs + (srcIdx ^ di));
            copyTLUTColor(dst, dstIdx + 0, tlutColorTable, b);
            srcIdx += 0x01;
            dstIdx += 0x04;
        }
        srcIdx += padW;
    }
}

export function decodeTex_IA4(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, line: number = 0, deinterleave: boolean = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_4b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x += 2) {
            const b = view.getUint8(srcOffs + (srcIdx ^ di));
            const i0 = expand3to8((b >>> 5) & 0x07);
            const a0 = ((b >>> 4) & 0x01) ? 0xFF : 0x00;
            dst[dstIdx + 0] = i0;
            dst[dstIdx + 1] = i0;
            dst[dstIdx + 2] = i0;
            dst[dstIdx + 3] = a0;
            const i1 = expand3to8((b >>> 1) & 0x07);
            const a1 = ((b >>> 0) & 0x01) ? 0xFF : 0x00;
            dst[dstIdx + 4] = i1;
            dst[dstIdx + 5] = i1;
            dst[dstIdx + 6] = i1;
            dst[dstIdx + 7] = a1;
            srcIdx += 0x01;
            dstIdx += 0x08;
        }
        srcIdx += padW;
    }
}

export function decodeTex_IA8(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, line: number = 0, deinterleave: boolean = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_8b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x++) {
            const b = view.getUint8(srcOffs + (srcIdx ^ di));
            const i = expand4to8((b >>> 4) & 0x0F);
            const a = expand4to8((b >>> 0) & 0x0F);
            dst[dstIdx + 0] = i;
            dst[dstIdx + 1] = i;
            dst[dstIdx + 2] = i;
            dst[dstIdx + 3] = a;
            srcIdx += 0x01;
            dstIdx += 0x04;
        }
        srcIdx += padW;
    }
}

export function decodeTex_IA16(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, line: number = 0, deinterleave: boolean = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_16b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x++) {
            const i = view.getUint8(srcOffs + (srcIdx ^ di) + 0x00);
            const a = view.getUint8(srcOffs + (srcIdx ^ di) + 0x01);
            dst[dstIdx + 0] = i;
            dst[dstIdx + 1] = i;
            dst[dstIdx + 2] = i;
            dst[dstIdx + 3] = a;
            srcIdx += 0x02;
            dstIdx += 0x04;
        }
        srcIdx += padW;
    }
}

export function decodeTex_I4(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, line: number = 0, deinterleave: boolean = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_4b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x += 2) {
            const b = view.getUint8(srcOffs + (srcIdx ^ di));
            const i0 = expand4to8((b >>> 4) & 0x0F);
            dst[dstIdx + 0] = i0;
            dst[dstIdx + 1] = i0;
            dst[dstIdx + 2] = i0;
            dst[dstIdx + 3] = i0;
            const i1 = expand4to8((b >>> 0) & 0x0F);
            dst[dstIdx + 4] = i1;
            dst[dstIdx + 5] = i1;
            dst[dstIdx + 6] = i1;
            dst[dstIdx + 7] = i1;
            srcIdx += 0x01;
            dstIdx += 0x08;
        }
        srcIdx += padW;
    }
}

export function decodeTex_I8(dst: Uint8Array, view: DataView, srcOffs: number, tileW: number, tileH: number, line: number = 0, deinterleave: boolean = false): void {
    let dstIdx = 0;
    let srcIdx = 0;
    const padW = texturePadWidth(ImageSize.G_IM_SIZ_8b, line, tileW);
    for (let y = 0; y < tileH; y++) {
        const di = deinterleave ? ((y & 1) << 2) : 0;
        for (let x = 0; x < tileW; x++) {
            const i = view.getUint8(srcOffs + (srcIdx ^ di));
            dst[dstIdx + 0] = i;
            dst[dstIdx + 1] = i;
            dst[dstIdx + 2] = i;
            dst[dstIdx + 3] = i;
            srcIdx += 0x01;
            dstIdx += 0x04;
        }
        srcIdx += padW;
    }
}

// TODO(jstpierre): non-RGBA16 TLUT modes (comes from TEXTLUT field in SETOTHERMODE_H)
export function parseTLUT(dst: Uint8Array, view: DataView, idx: number, siz: ImageSize, lutMode: TextureLUT): number {
    assert(lutMode === TextureLUT.G_TT_RGBA16);

    const tlutSize = getTLUTSize(siz);
    for (let i = 0; i < tlutSize; i++) {
        const p = view.getUint16(idx);
        r5g5b5a1(dst, i * 4, p);
        idx += 0x02;
    }

    return tlutSize * 0x02;
}

export function getImageFormatName(fmt: ImageFormat): string {
    switch (fmt) {
    case ImageFormat.G_IM_FMT_CI:   return 'CI';
    case ImageFormat.G_IM_FMT_I:    return 'I';
    case ImageFormat.G_IM_FMT_IA:   return 'IA';
    case ImageFormat.G_IM_FMT_RGBA: return 'RGBA';
    case ImageFormat.G_IM_FMT_YUV:  return 'YUV';
    }
}

export function getImageSizeName(siz: ImageSize): string {
    return '' + getSizBitsPerPixel(siz);
}
