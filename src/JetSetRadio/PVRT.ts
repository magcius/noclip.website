
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";


// Ported for JSR to TS from
//  https://github.com/yevgeniy-logachev/spvr2png/blob/master/SegaPVRImage.c
// A more complete PVRT implementation is can be found here:
//  https://github.com/inolen/redream/blob/master/src/guest/pvr/tex.c

export interface PVR_Texture {
    name: string;
    id: number;
    width: number;
    height: number;
    format: PVRTFormat;
    mask: PVRTMask;
    levels: PVR_TextureLevel[];
}

export interface PVR_TextureLevel {
    width: number;
    height: number;
    data: Uint8Array;
}

export interface PVR_GlobalIndex {
    id: number;
}

export const enum PVRTFormat {
    ARGB1555    = 0x00, // single transparency bit
    RGB565      = 0x01, //
    ARGB4444    = 0x02, //
    YUV442      = 0x03, // <no planned support>
    BUMPMAP     = 0x04, // <no planned support>
    PAL4BPP     = 0x05, // <no planned support>
    PAL8BPP     = 0x06, // <no planned support>
}

export const enum PVRTMask {
    Twiddled                                = 0x01,
    TwiddledMipMaps                         = 0x02,
    VectorQuantized                         = 0x03,
    VectorQuantizedMipMaps                  = 0x04,
    NonSquare                               = 0x09,
    TwiddledNonSquare                       = 0x0D,
    VectorQuantizedCustomCodeBook           = 0x10,
    VectorQuantizedCustomCodeBookMipMaps    = 0x11,
}

export function getFormatName(fmt: PVRTFormat): string {
    switch (fmt) {
    case PVRTFormat.ARGB1555:   return "ARGB1555";
    case PVRTFormat.RGB565:     return "RGB565";
    case PVRTFormat.ARGB4444:   return "ARGB4444";
    case PVRTFormat.YUV442:     return "YUV442";
    case PVRTFormat.BUMPMAP:    return "BUMPMAP";
    case PVRTFormat.PAL4BPP:    return "PAL4BPP";
    case PVRTFormat.PAL8BPP:    return "PAL8BPP";
    default:                    return "Invalid";
    }
}

export function getMaskName(mask: PVRTMask): string {
    switch(mask) {
    case PVRTMask.Twiddled:                             return "Twiddled";
    case PVRTMask.TwiddledMipMaps:                      return "Twiddled (mips)";
    case PVRTMask.VectorQuantized:                      return "Vector Quantized";
    case PVRTMask.VectorQuantizedMipMaps:               return "Vector Quantized (mips)";
    case PVRTMask.NonSquare:                            return "Non-Square";
    case PVRTMask.TwiddledNonSquare:                    return "Twiddled Non-Square";
    case PVRTMask.VectorQuantizedCustomCodeBook:        return "Vector Quantized (custom)";
    case PVRTMask.VectorQuantizedCustomCodeBookMipMaps: return "Vector Quantized (custom)(mips)";
    default:                                            return "Invalid";
    }
}

export function readPVRTChunk(buffer: ArrayBufferSlice, offs: number): [PVR_Texture, number] {
    const view = buffer.createDataView(offs + 0x08);

    const format = view.getUint8(0x00);
    const mask = view.getUint8(0x01);
    const width = view.getUint16(0x04, true);
    const height = view.getUint16(0x06, true);

    const dataView = buffer.slice(offs + 0x10).createDataView();

    const params = decideParams(mask, width);
    const mipChain = decideMipChain(width, height, params);

    const id = 0;
    const texture: PVR_Texture = { name: "", id, width, height, format, mask, levels: [] };

    for (let i = 0; i < mipChain.levels.length; i++) {
        const level = extractLevel(dataView, format, mask, params, mipChain.levels[i]);
        texture.levels.push(level);
    }

    const size = mipChain.size + 0x10;
    return [texture, size];
}

function untwiddleValue(value: number) : number {
    let untwiddled = 0;

    for (let i = 0; i < 10; i++) {
        const shift = 1 << i;
        if (value & shift)
            untwiddled |= (shift << i);
    }

    return untwiddled;
}

function getUntwiddledTexelPosition(x: number, y: number) : number {
    return untwiddleValue(y) | untwiddleValue(x) << 1;
}

function unpackTexelToRGBA(srcTexel: number, srcFormat: PVRTFormat, dst: Uint8Array, dstOffs: number): void {
    if (srcFormat === PVRTFormat.RGB565) {
        const a = 0xFF;
        const r = (srcTexel & 0xF800) >>> 8;
        const g = (srcTexel & 0x07E0) >>> 3;
        const b = (srcTexel & 0x001F) << 3;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    } else if (srcFormat === PVRTFormat.ARGB1555) {
        const a = (srcTexel & 0x8000) ? 0xFF : 0x00;
        const r = (srcTexel & 0x7C00) >>> 7;
        const g = (srcTexel & 0x03E0) >>> 2;
        const b = (srcTexel & 0x001F) << 3;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    } else if (srcFormat === PVRTFormat.ARGB4444) {
        const a = (srcTexel & 0xF000) >>> 8;
        const r = (srcTexel & 0x0F00) >>> 4;
        const g = (srcTexel & 0x00F0);
        const b = (srcTexel & 0x000F) << 4;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    }
}

function mipMapCountFromWidth(width: number) : number {
    let mipMapsCount = 0;
    while (width > 0) {
        ++mipMapsCount;
        width >>= 1;
    }

    return mipMapsCount;
}

interface UnpackedLevel {
    width: number;
    height: number;
    size: number;
    offset: number;
}

interface UnpackParams {
    numCodedComponents: number;
    kSrcStride: number;
    kDstStride: number;

    twiddled: boolean;
    mipMaps: boolean;
    vqCompressed: boolean;
    codeBookSize: number;
}

function decideParams(mask: PVRTMask, width: number): UnpackParams {
    const params: UnpackParams = {
        numCodedComponents: 4,
        kSrcStride: 2,
        kDstStride: 4,
        twiddled: false,
        mipMaps: false,
        vqCompressed: false,
        codeBookSize: 0,
    };

    if (mask === PVRTMask.TwiddledMipMaps) {
        params.twiddled = true;
        params.mipMaps = true;
    } else if (mask === PVRTMask.Twiddled) {
        params.twiddled = true;
    } else if (mask === PVRTMask.VectorQuantizedMipMaps) {
        params.mipMaps = true;
        params.vqCompressed = true;
        params.codeBookSize = 256;
    } else if (mask === PVRTMask.VectorQuantized) {
        params.vqCompressed = true;
        params.codeBookSize = 256;
    } else if (mask === PVRTMask.TwiddledNonSquare) {
        params.twiddled = true;
    } else if (mask === PVRTMask.VectorQuantizedCustomCodeBook) {
        params.vqCompressed = true;
    } else if (mask === PVRTMask.VectorQuantizedCustomCodeBookMipMaps) {
        params.mipMaps = true;
        params.vqCompressed = true;
    } else if (mask === PVRTMask.NonSquare) {
        // no param changes
    } else {
        throw new Error(`Unhandled mask ${mask}`);
    }

    if (mask === PVRTMask.VectorQuantizedCustomCodeBook) {
        if (width <= 16)
            params.codeBookSize = 16;
        else if (width <= 32)
            params.codeBookSize = 32;
        else if (width <= 64)
            params.codeBookSize = 128;
        else
            params.codeBookSize = 256;
    } else if (mask === PVRTMask.VectorQuantizedCustomCodeBookMipMaps) {
        if (width <= 16)
            params.codeBookSize = 16;
        else if (width <= 32)
            params.codeBookSize = 64;
        else
            params.codeBookSize = 256;
    }

    return params;
}

interface MipChain {
    levels: UnpackedLevel[];
    size: number;
}

function decideMipChain(width: number, height: number, params: UnpackParams): MipChain {
    let levels: UnpackedLevel[] = [];

    let srcOffset = 0;

    if (params.vqCompressed) {
        const vqSize = params.numCodedComponents * params.kSrcStride * params.codeBookSize;
        srcOffset += vqSize;
    }

    let mipMapCount = (params.mipMaps) ? mipMapCountFromWidth(width) : 1;
    while (mipMapCount > 0) {
        const mipWidth = (width >> (mipMapCount - 1));
        const mipHeight = (height >> (mipMapCount - 1));
        const mipSize = mipWidth * mipHeight;

        const level: UnpackedLevel = { width: mipWidth, height: mipHeight, size: mipSize, offset: srcOffset };
        levels.push(level);

        mipMapCount--;
        if (params.vqCompressed) {
            if (params.mipMaps)
                srcOffset += Math.max(1, mipSize / 4);
            else
                srcOffset += mipSize / 4;
        } else {
            srcOffset += (params.kSrcStride * mipSize);
        }
    }

    const size = srcOffset;
    return { levels, size };
}

function extractLevel(srcData: DataView, format: PVRTFormat, mask: PVRTMask, params: UnpackParams, level: UnpackedLevel): PVR_TextureLevel {
    // Size of RGBA output
    const dstData = new Uint8Array(level.width * level.height * 4);

    let mipWidth = level.width;
    let mipHeight = level.height;
    let mipSize = level.size;

    // Compressed textures processes only half-size
    if (params.vqCompressed) {
        mipWidth /= 2;
        mipHeight /= 2;
        mipSize = mipWidth * mipHeight;
    }

    //extract image data
    let x = 0;
    let y = 0;

    let processed = 0;
    while (processed < mipSize) {
        if (params.vqCompressed) {
            const codebookIndex = getUntwiddledTexelPosition(x, y);

            // Index of codebook * numbers of 2x2 block components
            const vqIndex = srcData.getUint8(level.offset + codebookIndex) * params.numCodedComponents;

            // Bypass elements in 2x2 block
            for (let yy = 0; yy < 2; ++yy) {
                for (let xx = 0; xx < 2; ++xx) {   
                    const srcPos = (vqIndex + (xx * 2 + yy)) * params.kSrcStride;
                    const srcTexel = srcData.getUint16(srcPos, true);
                    const dstPos = ((y * 2 + yy) * 2 * mipWidth + (x * 2 + xx)) * params.kDstStride;
                    unpackTexelToRGBA(srcTexel, format, dstData, dstPos);
                }
            }

            if (++x >= mipWidth) {
                x = 0;
                ++y;
            }
        } else {
            x = processed % mipWidth;
            y = Math.floor(processed / mipWidth);
            const srcPos = (params.twiddled ? getUntwiddledTexelPosition(x, y) : processed) * params.kSrcStride;
            const srcTexel = srcData.getUint16(level.offset + srcPos, true);
            const dstPos = processed * params.kDstStride;
            unpackTexelToRGBA(srcTexel, format, dstData, dstPos);
        }
        
        ++processed;
    }

    return { width: level.width, height: level.height, data: dstData };
}
