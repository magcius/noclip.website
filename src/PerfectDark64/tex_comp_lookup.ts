import ArrayBufferSlice from "../ArrayBufferSlice";
import { Endianness } from "../endian";
import { assert, hexzero0x } from "../util";

import BitReader from "./bitreader";
import { Format, InflatedTexture, alignedTextureSize } from "./tex";

function bitsPerPixel(format: Format): number {
    switch (format) {
        case Format.RGBA32:     return 32;
        case Format.RGBA16:     return 16;
        case Format.RGB24:      return 24;
        case Format.RGB15:      return 15;
        case Format.IA16:       return 16;
        case Format.IA8:        return 8;
        case Format.IA4:        return 4;
        case Format.I8:         return 8;
        case Format.I4:         return 4;
        case Format.RGBA16_CI8: return 16;
        case Format.RGBA16_CI4: return 16;
        case Format.IA16_CI8:   return 16;
        case Format.IA16_CI4:   return 16;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

export function buildLookupTable(texture: InflatedTexture, reader: BitReader, numColors: number): ArrayBufferSlice {
    const bpp = bitsPerPixel(texture.format);

    if (bpp <= 16) {
        const buf = new Uint16Array(numColors);
        for (let i = 0; i < numColors; i++) {
            buf[i] = reader.read(bpp);
        }
        return ArrayBufferSlice.fromView(buf);
    } else if (bpp <= 24) {
        const buf = new Uint32Array(numColors);
        for (let i = 0; i < numColors; i++) {
            buf[i] = reader.read(bpp);
        }
        return ArrayBufferSlice.fromView(buf);
    } else {
        const buf = new Uint32Array(numColors);
        for (let i = 0; i < numColors; i++) {
            buf[i] = reader.read(24) << 8 | reader.read(bpp - 24);
        }
        return ArrayBufferSlice.fromView(buf);
    }

    assert(false, "unreachable");
}


export function inflateLookup(
    texture: InflatedTexture,
    src: ArrayBufferSlice,
    lookup: ArrayBufferSlice,
    numColors: number,
): null|ArrayBufferSlice {
    try {
        switch (texture.format) {
            case Format.IA4:
            case Format.I4: return inflateLookup_I4(texture, src, lookup, numColors);
            case Format.I8:
            case Format.IA8: return inflateLookup_I8(texture, src, lookup, numColors);
            case Format.IA16:
            case Format.RGB15: return inflateLookup_RGBA16(texture, src, lookup, numColors, isRGB15);
            case Format.RGBA16: return inflateLookup_RGBA16(texture, src, lookup, numColors);
            case Format.RGB24: return inflateLookup_RGBA32(texture, src, lookup, numColors, isRGB24);
            case Format.RGBA32: return inflateLookup_RGBA32(texture, src, lookup, numColors);
            default:
                console.warn(
                    "texture:", hexzero0x(texture.index, 4),
                    "inflateLookup: unhandled format:", Format[texture.format],
                );
                return null;
        }
    } catch (err: unknown) {
        if (err instanceof RangeError) {
            console.warn(
                hexzero0x(texture.index, 4) + ":",
                "out of bounds read in inflateLookup"
            );
            return null;
        }

        throw err;
    }

    assert(false, "unreachable");
}

const isRGB24 = true;
function inflateLookup_RGBA32(
    texture: InflatedTexture,
    src: ArrayBufferSlice,
    lookup: ArrayBufferSlice,
    numColors: number,
    offsetAndSetAlpha: boolean = false,
): ArrayBufferSlice {
    const buf = new Uint32Array(alignedTextureSize(texture));
    const lookup16 = lookup.convertFromEndianness(Endianness.BIG_ENDIAN, 2).createTypedArray(Uint16Array);
    const lookup32 = lookup.convertFromEndianness(Endianness.BIG_ENDIAN, 4).createTypedArray(Uint32Array);
    const src8 = src.createTypedArray(Uint8Array);
    const src16 = src.createTypedArray(Uint16Array);

    let dstOffset = 0;
    let srcOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            let value: number;
            if (numColors <= 256) {
                value = lookup32[src8[srcOffset + x]];
            } else {
                value = lookup16[src16[srcOffset + x]];
            }

            if (offsetAndSetAlpha) {
                value = (value << 8) | 0xFF;
            }

            buf[dstOffset + x] = value;
        }

        dstOffset += (texture.width + 3) & 0xffc;
        srcOffset += texture.width;
    }

    return ArrayBufferSlice.fromView(buf);
}

const isRGB15 = true;
function inflateLookup_RGBA16(
    texture: InflatedTexture,
    src: ArrayBufferSlice,
    lookup: ArrayBufferSlice,
    numColors: number,
    offsetAndSetAlpha: boolean = false,
): ArrayBufferSlice {
    const buf = new Uint16Array(alignedTextureSize(texture));
    const lookup8 = lookup.createTypedArray(Uint8Array);
    const lookup16 = lookup.convertFromEndianness(Endianness.BIG_ENDIAN, 2).createTypedArray(Uint16Array);
    const src8 = src.createTypedArray(Uint8Array);
    const src16 = src.createTypedArray(Uint16Array);

    let dstOffset = 0;
    let srcOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            let value: number;
            if (numColors <= 256) {
                value = lookup8[src8[srcOffset + x] * 2];
            } else {
                value = lookup16[src16[srcOffset + x]];
            }

            if (offsetAndSetAlpha) {
                value = value << 1 | 1;
            }
            buf[dstOffset + x] = value;
        }

        dstOffset += (texture.width + 3) & 0xffc;
        srcOffset += texture.width;
    }

    return ArrayBufferSlice.fromView(buf);
}

function inflateLookup_I8(
    texture: InflatedTexture,
    src: ArrayBufferSlice,
    lookup: ArrayBufferSlice,
    numColors: number,
): ArrayBufferSlice {
    assert(numColors <= 256, "unused");

    const buf = new Uint8Array(alignedTextureSize(texture));
    const lookupView = lookup.createDataView();
    const srcView = src.createDataView();

    let dstOffset = 0;
    let srcOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            buf[dstOffset + x] = lookupView.getUint8(srcView.getUint8(srcOffset + x) * 2);
        }

        dstOffset += (texture.width + 7) & 0xff8;
        srcOffset += texture.width;
    }

    return ArrayBufferSlice.fromView(buf);
}

function inflateLookup_I4(
    texture: InflatedTexture,
    src: ArrayBufferSlice,
    lookup: ArrayBufferSlice,
    numColors: number,
): ArrayBufferSlice {
    assert(numColors <= 256, "unused");

    const buf = new Uint8Array(alignedTextureSize(texture));
    const lookupView = lookup.createDataView();
    const srcView = src.createDataView();

    let dstOffset = 0;
    let srcOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            // Out of bounds read on odd-sided textures, eg 0x0d10.
            const lo = (x < texture.width - 1 ) ? srcView.getUint8(srcOffset + x + 1) * 2 : 0;
            const hi = srcView.getUint8(srcOffset + x) * 2;

            buf[dstOffset + (x >>> 1)] = lookupView.getUint8(hi) << 4 | lookupView.getUint8(lo);
        }

        dstOffset += ((texture.width + 15) & 0xff0) >>> 1;
        srcOffset += texture.width;
    }

    return ArrayBufferSlice.fromView(buf);
}
