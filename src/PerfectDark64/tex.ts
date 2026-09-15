import * as UI from "../ui";
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero0x, spliceBisectRight } from "../util";
import { Endianness } from "../endian";
import {
    ImageFormat, ImageSize, decodeTex_RGB24, decodeTex_RGBA16,
    decodeTex_RGBA32, decodeTex_CI4, decodeTex_CI8, decodeTex_IA4,
    decodeTex_IA8, decodeTex_IA16, decodeTex_I4, decodeTex_I8, TextureLUT,
} from "../Common/N64/Image"; import { GfxDevice } from
"../gfx/platform/GfxPlatform";

import type { Inflater }  from "./rom";
import BitReader from "./bitreader";
import { inflateLookup, buildLookupTable } from "./tex_comp_lookup";

export interface InflatedTexture {
    index: number;
    format: Format;
    imageFormat: ImageFormat;
    imageSize: ImageSize;
    lutMode: TextureLUT;
    width: number;
    height: number;

    compressionMethod: number;
    hasLOD: boolean;
    numLODs: number;

    addr: number; // original in-ROM texture data addr
    offset: number; // offset in the coalesced texture binary we output
    size: number; // raw pixel data length

    numColors: number;
    palOffset: number; // offset in the coalesced texture binary we output
    palSize: number; // raw palette data length
}

export enum Format {
    RGBA32     = 0x00, // 32-bit RGBA (8/8/8/8)
    RGBA16     = 0x01, // 16-bit RGBA (5/5/5/1)
    RGB24      = 0x02, // 24-bit RGB (8/8/8)
    RGB15      = 0x03, // 15-bit RGB (5/5/5)
    IA16       = 0x04, // 16-bit grayscale+alpha
    IA8        = 0x05, // 8-bit grayscale+alpha (4/4)
    IA4        = 0x06, // 4-bit grayscale+alpha (3/1)
    I8         = 0x07, // 8-bit grayscale
    I4         = 0x08, // 4-bit grayscale
    RGBA16_CI8 = 0x09, // 16-bit 5551 paletted color with 8-bit palette indexes
    RGBA16_CI4 = 0x0a, // 16-bit 5551 paletted color with 4-bit palette indexes
    IA16_CI8   = 0x0b, // 16-bit 88 paletted greyscale+alpha with 8-bit palette indexes
    IA16_CI4   = 0x0c, // 16-bit 88 paletted greyscale+alpha with 4-bit palette indexes
}

function toGBIFormat(format: Format): ImageFormat {
    switch (format) {
        case Format.RGBA32:     return  ImageFormat.G_IM_FMT_RGBA;
        case Format.RGBA16:     return  ImageFormat.G_IM_FMT_RGBA;
        case Format.RGB24:      return  ImageFormat.G_IM_FMT_RGBA;
        case Format.RGB15:      return  ImageFormat.G_IM_FMT_RGBA;
        case Format.IA16:       return  ImageFormat.G_IM_FMT_IA;
        case Format.IA8:        return  ImageFormat.G_IM_FMT_IA;
        case Format.IA4:        return  ImageFormat.G_IM_FMT_IA;
        case Format.I8:         return  ImageFormat.G_IM_FMT_I;
        case Format.I4:         return  ImageFormat.G_IM_FMT_I;
        case Format.RGBA16_CI8: return  ImageFormat.G_IM_FMT_CI;
        case Format.RGBA16_CI4: return  ImageFormat.G_IM_FMT_CI;
        case Format.IA16_CI8:   return  ImageFormat.G_IM_FMT_CI;
        case Format.IA16_CI4:   return  ImageFormat.G_IM_FMT_CI;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

function toGBISize(format: Format): ImageSize {
    switch (format) {
        case Format.RGBA32:     return ImageSize.G_IM_SIZ_32b;
        case Format.RGBA16:     return ImageSize.G_IM_SIZ_16b;
        case Format.RGB24:      return ImageSize.G_IM_SIZ_32b;
        case Format.RGB15:      return ImageSize.G_IM_SIZ_16b;
        case Format.IA16:       return ImageSize.G_IM_SIZ_16b;
        case Format.IA8:        return ImageSize.G_IM_SIZ_8b;
        case Format.IA4:        return ImageSize.G_IM_SIZ_4b;
        case Format.I8:         return ImageSize.G_IM_SIZ_8b;
        case Format.I4:         return ImageSize.G_IM_SIZ_4b;
        case Format.RGBA16_CI8: return ImageSize.G_IM_SIZ_8b;
        case Format.RGBA16_CI4: return ImageSize.G_IM_SIZ_4b;
        case Format.IA16_CI8:   return ImageSize.G_IM_SIZ_8b;
        case Format.IA16_CI4:   return ImageSize.G_IM_SIZ_4b;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

function toGBILUTMode(format: Format): TextureLUT {
    switch (format) {
        case Format.RGBA32:     return TextureLUT.G_TT_NONE;
        case Format.RGBA16:     return TextureLUT.G_TT_NONE;
        case Format.RGB24:      return TextureLUT.G_TT_NONE;
        case Format.RGB15:      return TextureLUT.G_TT_NONE;
        case Format.IA16:       return TextureLUT.G_TT_NONE;
        case Format.IA8:        return TextureLUT.G_TT_NONE;
        case Format.IA4:        return TextureLUT.G_TT_NONE;
        case Format.I8:         return TextureLUT.G_TT_NONE;
        case Format.I4:         return TextureLUT.G_TT_NONE;
        case Format.RGBA16_CI8: return TextureLUT.G_TT_RGBA16;
        case Format.RGBA16_CI4: return TextureLUT.G_TT_RGBA16;
        case Format.IA16_CI8:   return TextureLUT.G_TT_IA16;
        case Format.IA16_CI4:   return TextureLUT.G_TT_IA16;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

// > For non-paletted images, size in decimal of each color channel.
// > Eg. 32 means each channel can store up to 32 values (5-bits per channel).
// > For paletted images, same thing but for the palette indices instead.
// - pd64 decomp
function toChannelSize(format: Format): number {
    switch (format) {
        case Format.RGBA32:     return 256;
        case Format.RGBA16:     return 32;
        case Format.RGB24:      return 256;
        case Format.RGB15:      return 32;
        case Format.IA16:       return 256;
        case Format.IA8:        return 16;
        case Format.IA4:        return 8;
        case Format.I8:         return 256;
        case Format.I4:         return 16;
        case Format.RGBA16_CI8: return 256;
        case Format.RGBA16_CI4: return 16;
        case Format.IA16_CI8:   return 256;
        case Format.IA16_CI4:   return 16;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

function has1BitAlpha(format:Format): boolean {
    switch (format) {
        case Format.RGBA32:     return false;
        case Format.RGBA16:     return true;
        case Format.RGB24:      return false;
        case Format.RGB15:      return false;
        case Format.IA16:       return false;
        case Format.IA8:        return false;
        case Format.IA4:        return true;
        case Format.I8:         return false;
        case Format.I4:         return false;
        case Format.RGBA16_CI8: return false;
        case Format.RGBA16_CI4: return false;
        case Format.IA16_CI8:   return false;
        case Format.IA16_CI4:   return false;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

function numChannels(format: Format): number {
    switch (format) {
        case Format.RGBA32:     return 4;
        case Format.RGBA16:     return 3;
        case Format.RGB24:      return 3;
        case Format.RGB15:      return 3;
        case Format.IA16:       return 2;
        case Format.IA8:        return 2;
        case Format.IA4:        return 1;
        case Format.I8:         return 1;
        case Format.I4:         return 1;
        case Format.RGBA16_CI8: return 1;
        case Format.RGBA16_CI4: return 1;
        case Format.IA16_CI8:   return 1;
        case Format.IA16_CI4:   return 1;

        default: throw new Error(`invalid texture format: ${format}`);
    }
}

function indicePerByte(format: Format): number {
    switch(format) {
        case Format.RGBA16_CI8:
        case Format.IA16_CI8:
            return 1;
        case Format.RGBA16_CI4:
        case Format.IA16_CI4:
            return 2;
        default:
            throw new Error(`unhandled texture format: ${format}`);
    }
}

export enum CompressionMethod {
    UNCOMPRESSED0      = 0,
    UNCOMPRESSED1      = 1,
    HUFFMAN            = 2,
    HUFFMANPERHCHANNEL = 3,  // 1 texture left
    RLE                = 4,
    LOOKUP             = 5,
    HUFFMANLOOKUP      = 6,
    RLELOOKUP          = 7,
    HUFFMANPAETH        = 8,
    RLEPAETH            = 9,

    // Not a "real" value, we set this when isZlib is set to have something to
    // show in the texture viewer.
    ZLIB               = 10,
}

export interface TextureListEntry {
    soundSurfaceType: number; // 4  bits
    surfaceType:      number; // 4  bits
    dataOffset:       number; // 24 bits

    // The rest is unused / padding.
}
export const textureListEntryStructSize = 8;

export interface TextureConfig {
    ptr: number; // uint32

    // All uint8
    width:  number;
    height: number;
    level:  number;
    format: number;
    depth:  number;
    s:      number;
    t:      number;
    unk0b:  number;
}
export const textureConfigStructSize = 12;
export function textureConfigFromView(view: DataView, offset: number): TextureConfig {
    return {
        ptr:    view.getUint32(offset),
        width:  view.getUint8(offset + 4),
        height: view.getUint8(offset + 5),
        level:  view.getUint8(offset + 6),
        format: view.getUint8(offset + 7),
        depth:  view.getUint8(offset + 8),
        s:      view.getUint8(offset + 9),
        t:      view.getUint8(offset + 10),
        unk0b:  view.getUint8(offset + 11),
    };
}

// Returns raw data, writes format and dimensions to {@param texture}.
export function inflateTexture(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
    decompress: Inflater,
): [ArrayBufferSlice, ArrayBufferSlice|null] /* indices, palette */ {
    if (data.byteLength <= 0) {
        console.warn(hexzero0x(texture.index, 4) + ":", "cannot inflate texture: no data");
        return [data, null];
    }

    const view = data.createDataView();
    const header = view.getUint8(0);
    const isZlib = !!((header & 0x40) >>> 6);
    texture.hasLOD = !!((header & 0x80) >>> 7);
    texture.numLODs = (header & 0x3f);

    if (isZlib) {
        return inflateZlibTexture(texture, data, decompress);
    }

    const subheader = view.getUint32(1);
    texture.format = subheader  >>> 28;
    texture.width  = (subheader >>> 20) & 0xFF;
    texture.height = (subheader >>> 12) & 0xFF;
    texture.imageFormat = toGBIFormat(texture.format);
    texture.imageSize = toGBISize(texture.format);
    texture.lutMode = toGBILUTMode(texture.format);
    texture.numColors = 0;
    texture.palOffset = -1;
    texture.palSize = -1;
    texture.compressionMethod = (subheader >>> 8) & 0x0F;

    return [data, null];
}

// Decompress, unpack, and realign textures to 8 bytes.
export function preprocessTexture(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
): null|ArrayBufferSlice {
    switch (texture.compressionMethod) {
        case CompressionMethod.ZLIB:
            return realignZlibTexture(texture, data);

        case CompressionMethod.HUFFMAN: {
            const reader = new BitReader(data);
            reader.read(32); // skip two headers
            let buf = inflateHuffmanTexture(texture, data, reader);

            if (has1BitAlpha(texture.format)) {
                buf = readAlphaBits(texture, buf, reader);
            }

            return unpackChannels(texture, buf);
        }

        case CompressionMethod.HUFFMANPAETH: {
            const reader = new BitReader(data);
            reader.read(32); // skip two headers
            const method = reader.read(3);
            let buf = inflateHuffmanTexture(texture, data, reader);
            buf = applyPaethFilter(texture, buf, method);

            if (has1BitAlpha(texture.format)) {
                buf = readAlphaBits(texture, buf, reader);
            }

            return unpackChannels(texture, buf);
        }

        case CompressionMethod.RLE: {
            const reader = new BitReader(data);
            reader.read(32); // skip two headers
            const blocksTotal = texture.width * texture.height * numChannels(texture.format);
            let buf = inflateRLETexture(reader, blocksTotal);
            if (has1BitAlpha(texture.format)) {
                buf = readAlphaBits(texture, buf, reader);
            }

            return unpackChannels(texture, buf);
        }

        case CompressionMethod.LOOKUP: {
            const reader = new BitReader(data);
            reader.read(32); // skip two headers
            const numColors = reader.read(11);
            const lookup = buildLookupTable(texture, reader, numColors);
            return inflateLookup(texture, data, lookup, numColors);
        }

        case CompressionMethod.HUFFMANLOOKUP: {
            const reader = new BitReader(data);
            reader.read(32); // skip two headers
            const numColors = reader.read(11);
            const lookup = buildLookupTable(texture, reader, numColors);
            const buf = inflateHuffmanTexture(texture, data, reader);
            return inflateLookup(texture, buf, lookup, numColors);
        }

        case CompressionMethod.RLELOOKUP: {
            const reader = new BitReader(data);
            reader.read(32); // skip two headers

            const numColors = reader.read(11);
            const lookup = buildLookupTable(texture, reader, numColors);

            const blocksTotal = texture.width * texture.height;
            const buf = inflateRLETexture(reader, blocksTotal);

            return inflateLookup(texture, buf, lookup, numColors);
        }
    }

    console.warn(
        hexzero0x(texture.index, 4) + ":",
        "unhandled compression method:",
        CompressionMethod[texture.compressionMethod]
    );
    return null;
}


/*
 * Apply a Paeth filter. During compression a pixel's value is predicted from
 * a "predictor" set of neighbouring pixels and only the difference between the
 * predicted value and the actual value is stored.
 * This reduces the range of values since pixels are often locally similar,
 * smaller range means better RLE/Huffman compressibility.
*/
function applyPaethFilter(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
    method: number,
): ArrayBufferSlice {
    const chanSize = toChannelSize(texture.format);
    const buf = data.createTypedArray(Uint8Array);
    const height = numChannels(texture.format)*texture.height;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const cur = buf[y * texture.width + x] + chanSize * 2;
            const left = x > 0 ? buf[y * texture.width + x - 1] : 0;
            const above = y > 0 ? buf[(y - 1) * texture.width + x] : 0;
            const aboveLeft = x > 0 && y > 0 ? buf[(y - 1) * texture.width + x - 1] : 0;

            const offset = y * texture.width + x;

            switch (method) {
                case 0:
                    buf[offset] = (cur + left) % chanSize;
                    break;
                case 1:
                    buf[offset] = (cur + above) % chanSize;
                    break;
                case 2:
                    buf[offset] = (cur + aboveLeft) % chanSize;
                    break;
                case 3:
                    buf[offset] = (cur + (left + above - aboveLeft)) % chanSize;
                    break;
                case 4:
                    buf[offset] = (cur + Math.trunc((above - aboveLeft) / 2) + left) % chanSize;
                    break;
                case 5:
                    buf[offset] = (cur + Math.trunc((left - aboveLeft) / 2) + above) % chanSize;
                    break;
                case 6:
                    buf[offset] = (cur + Math.trunc((left + above) / 2)) % chanSize;
                    break;
                default:
                    console.warn(
                        hexzero0x(texture.index, 4) + ":",
                        "unhandled paeth method:", method,
                    );
            }
        }
    }

    return ArrayBufferSlice.fromView(buf);
}

// This mess is a straight port from the decomp, warts and all.
// It could be refactored but I'd like to write tests before.
function inflateHuffmanTexture(texture: InflatedTexture, data: ArrayBufferSlice, reader: BitReader): ArrayBufferSlice {
    const numIterations = texture.width * texture.height * numChannels(texture.format);
    const chanSize = toChannelSize(texture.format);
    const out = new Uint8Array(0x2000);

    const frequencies: Array<number> = new Array(2048); // u16
    const nodes: Array<[number, number]> = new Array(2048); // [s16, s16]
    for (let i = 0; i < nodes.length; i++) {
        nodes[i] = [-1, -1];
    }

    for (let i = 0; i < chanSize; i++) {
        frequencies[i] = reader.read(8);
    }

    let minFreqA = 9999;
    let minFreqB = 9999;
    let minIndexA: number = NaN;
    let minIndexB: number = NaN;
	for (let i = 0; i < chanSize; i++) {
		if (frequencies[i] < minFreqA) {
			if (minFreqB < minFreqA) {
				minFreqA = frequencies[i];
				minIndexA = i;
			} else {
				minFreqB = frequencies[i];
				minIndexB = i;
			}
		} else if (frequencies[i] < minFreqB) {
			minFreqB = frequencies[i];
			minIndexB = i;
		}
	}
    assert(!isNaN(minIndexA) && !isNaN(minIndexB), "minIndex{A,B} should have been set");

    let rootIndex = -1;
    let done = false;
    while (!done) {
        let sum = frequencies[minIndexA] + frequencies[minIndexB];
        if (sum === 0) {
            sum = 1;
        }

        frequencies[minIndexA] = 9999;
        frequencies[minIndexB] = 9999;

        if (nodes[minIndexA][0] < 0 && nodes[minIndexA][1] < 0) {
            nodes[minIndexA][0] = minIndexA + 10000;
            rootIndex = minIndexA;
            frequencies[minIndexA] = sum;

            if (nodes[minIndexB][0] < 0 && nodes[minIndexB][1] < 0) {
                nodes[minIndexA][1] = minIndexB + 10000;
            } else {
                nodes[minIndexA][1] = minIndexB;
            }
        } else if (nodes[minIndexB][0] < 0 && nodes[minIndexB][1] < 0) {
            nodes[minIndexB][0] = minIndexB + 10000;
            rootIndex = minIndexB;
            frequencies[minIndexB] = sum;

            if (nodes[minIndexA][0] < 0 && nodes[minIndexA][1] < 0) {
                nodes[minIndexB][1] = minIndexA + 10000;
            } else {
                nodes[minIndexB][1] = minIndexA;
            }
        } else {
            for (
                rootIndex = 0;
                nodes[rootIndex][0] >= 0 ||
                nodes[rootIndex][1] >= 0 ||
                frequencies[rootIndex] < 9999;
                rootIndex++
            ) {
                if (rootIndex >= nodes.length - 1) {
                    break;
                }
            }

            frequencies[rootIndex] = sum;
            nodes[rootIndex][0] = minIndexA;
            nodes[rootIndex][1] = minIndexB;
        }

        // Find the two smallest frequencies again for the next iteration
        minFreqA = 9999;
        minFreqB = 9999;

        for (let i = 0; i < chanSize; i++) {
            if (frequencies[i] < minFreqA) {
                if (minFreqA > minFreqB) {
                    minFreqA = frequencies[i];
                    minIndexA = i;
                } else {
                    minFreqB = frequencies[i];
                    minIndexB = i;
                }
            } else if (frequencies[i] < minFreqB) {
                minFreqB = frequencies[i];
                minIndexB = i;
            }
        }

        if (minFreqA === 9999 || minFreqB === 9999) {
            done = true;
        }
    }

    loop:
    for (let i = 0; i < numIterations; i++) {
        let indexOrValue = rootIndex;

        while (indexOrValue < 10000) {
            try {
                indexOrValue = nodes[indexOrValue][reader.read(1)];
            } catch {
                console.warn(
                    hexzero0x(texture.index, 4) + ":",
                    "out of bound read during huffman decoding",
                );
                break loop;
            }
        }

        if (chanSize <= 256) {
            out[i] = indexOrValue - 10000;
        } else {
            assert(false, "unhandled");
        }
    }

    // Alpha is discarded and read back later.
    if (has1BitAlpha(texture.format)) {
        return ArrayBufferSlice.fromView(out).subarray(0, texture.width * texture.height * 3);
    }

    // In this case the entire scratch buffer is spat out, if I attempt to
    // resize it to match the texture dimensions there's an out of bound read down the line.
    // FIXME: Either understand and document, or fix.
    return ArrayBufferSlice.fromView(out);
}

// reader next readable bit should be the first bit of the alpha.
function readAlphaBits(texture: InflatedTexture, data: ArrayBufferSlice, reader: BitReader): ArrayBufferSlice {
    const area = texture.width * texture.height;
    const out = new Uint8Array(data.byteLength + area);
    out.set(data.createTypedArray(Uint8Array));

    for (let i = 0; i < area; i++) {
        out[data.byteLength + i] = reader.read(1);
    }

    return ArrayBufferSlice.fromView(out);
}

// Unpacks channels (RRRGGGBBB -> RGBRGBRGB) and realign bytes.
// (realign() counterpart for non-zlib textures)
function unpackChannels(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    switch(texture.format) {
        case Format.I4: return unpackChannels_I4(texture, data);
        case Format.IA4: return unpackChannels_IA4(texture, data);
        case Format.I8: return unpackChannels_I8(texture, data);
        case Format.IA8: return unpackChannels_IA8(texture, data);
        case Format.RGB15: return unpackChannels_RGB15(texture, data);
        case Format.RGB24: return unpackChannels_RGB24(texture, data);
        case Format.RGBA16: return unpackChannels_RGBA16(texture, data);
        case Format.RGBA32: return unpackChannels_RGBA32(texture, data);
        default:
            console.warn(
                hexzero0x(texture.index, 4) + ":",
                "unpackChannels: unhandled format:", Format[texture.format],
            );
    }

    return data;
}

export function alignedTextureSize(texture: InflatedTexture): number {
    const lineWidth = texture.width * numChannels(texture.format);
    const missing = lineWidth % 8;
    const alignedLineWidth = lineWidth + (8 - missing);

    return texture.height * alignedLineWidth;
}

// Expanded to r5g5b5a1 RGBA16.
function unpackChannels_RGB15(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint16Array(alignedTextureSize(texture));

    let dstOffset = 0;
    const reader = new BitReader(data);
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            out[dstOffset + x] = reader.read(15) << 1 | 1;
        }
        dstOffset += (texture.width + 3) & 0xffc;
    }

    return ArrayBufferSlice.fromView(out);
}

function unpackChannels_RGB24(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint32Array(alignedTextureSize(texture));
    const view = data.createDataView();
    const area = texture.width * texture.height;

    let offset = 0;
    let dstOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            out[dstOffset + x] = view.getUint8(offset) << 24 |
                view.getUint8(offset + area) << 16 |
                view.getUint8(offset + area * 2) << 8 |
                0xFF
            ;
            offset++;
        }
        dstOffset += (texture.width + 3) & 0xffc;
    }

    return ArrayBufferSlice.fromView(out);
}

function unpackChannels_RGBA32(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint32Array(alignedTextureSize(texture));
    const view = data.createDataView();
    const area = texture.width * texture.height;

    let offset = 0;
    let dstOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            out[dstOffset + x] = view.getUint8(offset) << 24 |
                view.getUint8(offset + area) << 16 |
                view.getUint8(offset + area * 2) << 8 |
                view.getUint8(offset + area * 3)
            ;
            offset++;
        }
        dstOffset += (texture.width + 3) & 0xffc;
    }

    return ArrayBufferSlice.fromView(out);
}

function unpackChannels_RGBA16(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint16Array(alignedTextureSize(texture));
    const view = data.createDataView();
    const area = texture.width * texture.height;

    let offset = 0;
    let dstOffset = 0;

    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            out[dstOffset + x] = view.getUint8(offset) << 11 |
                view.getUint8(offset + area) << 6 |
                view.getUint8(offset + area * 2) << 1 |
                view.getUint8(offset + area * 3)
             ;
             offset++;
        }

        dstOffset += (texture.width + 3) & 0xffc;
    }

    // Not sure why in this specific case I need to swap bytes but not elsewhere.
    return ArrayBufferSlice.fromView(out).convertFromEndianness(Endianness.BIG_ENDIAN, 2);
}

function unpackChannels_I8(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint8Array(alignedTextureSize(texture));
    const view = data.createDataView();

    let offset = 0;
    let dstOffset = 0;

    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            out[dstOffset + x] = view.getUint8(offset);
            offset++;
        }

        dstOffset += (texture.width + 7) & 0xff8;
    }

    return ArrayBufferSlice.fromView(out);
}

function unpackChannels_IA8(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint8Array(alignedTextureSize(texture));
    const view = data.createDataView();
    const area = texture.width * texture.height;

    let offset = 0;
    let dstOffset = 0;

    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            out[dstOffset + x] = view.getUint8(offset) << 4 | view.getUint8(offset + area);
            offset++;
        }

        dstOffset += (texture.width + 7) & 0xff8;
    }

    return ArrayBufferSlice.fromView(out);
}

function unpackChannels_I4(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint8Array(alignedTextureSize(texture));
    const view = data.createDataView();

    let offset = 0;
    let dstOffset = 0;

    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x+=2) {
            out[dstOffset + (x >>> 1)] = view.getUint8(offset) << 4 | view.getUint8(offset + 1);
            offset += 2;
        }

        if (texture.width & 1) {
            offset--;
        }

        dstOffset += ((texture.width + 15) & 0xff0) >>> 1;
    }

    return ArrayBufferSlice.fromView(out);
}

function unpackChannels_IA4(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const out = new Uint8Array(alignedTextureSize(texture));
    const view = data.createDataView();
    const area = texture.width * texture.height;

    let offset = 0;
    let dstOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x+=2) {
            out[dstOffset + (x >>> 1)] =
                view.getUint8(offset) << 5 |
                view.getUint8(offset + area * 3) << 4 |
                view.getUint8(offset + 1) << 1 |
                view.getUint8(offset + area * 3 + 1)
            ;
            offset += 2
        }

        if (texture.width & 1) {
            offset--;
        }

        dstOffset += (texture.width + 15) & 0xff0;
    }

    assert(false, "unused");
    return ArrayBufferSlice.fromView(out);
}


function inflateRLETexture(
    reader: BitReader,
    blocksTotal: number,
): ArrayBufferSlice {
    const btFieldSize = reader.read(3);
    const rlFieldSize = reader.read(3);
    const blockSize = reader.read(4);
    let cost = btFieldSize + rlFieldSize + blockSize + 1;
    let fudge = 0;
    while (cost > 0) {
        cost -= blockSize + 1;
        fudge++;
    }

    let blocksDone = 0;
    const dst: Uint8Array|Uint16Array =
        (blockSize <= 8) ?
        new Uint8Array(blocksTotal) :
        new Uint16Array(blocksTotal)
    ;

    while (blocksDone < blocksTotal) {
        if (reader.read(1) === 0) {
            dst[blocksDone++] = reader.read(blockSize);
            continue;
        }

        const startBlockIndex = blocksDone - reader.read(btFieldSize) - 1;
        const runNumBlocks = reader.read(rlFieldSize) + fudge;

        for (let i = startBlockIndex; i < startBlockIndex + runNumBlocks; i++) {
            dst[blocksDone++] = dst[i];
        }

        dst[blocksDone++] = reader.read(blockSize);
    }

    return ArrayBufferSlice.fromView(dst);
}

// FIXME: Ignore LODs for now.
function inflateZlibTexture(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
    decompress: Inflater,
): [ArrayBufferSlice, ArrayBufferSlice] {
    const view = data.createDataView();
    let offset = 1; // Skip header.

    texture.format = view.getUint8(offset++);
    texture.imageFormat = toGBIFormat(texture.format);
    texture.imageSize = toGBISize(texture.format);
    texture.lutMode = toGBILUTMode(texture.format);
    texture.numColors = view.getUint8(offset++) + 1;
    texture.compressionMethod = CompressionMethod.ZLIB;

    // Always 16 bits per color, either r5g5b5a1 or i8a8.
    const palette = new Uint8Array(texture.numColors * 2);
    for (let i = 0; i < palette.byteLength; i++) {
        palette[i] = view.getUint8(offset++);
    }

    texture.width = view.getUint8(offset++);
    texture.height = view.getUint8(offset++);

    const indices = decompress(data.subarray(offset));

    return [indices, ArrayBufferSlice.fromView(palette)];
}

// Textures must be aligned to 8 bytes per row but are stored without the padding.
function realignZlibTexture(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const ipb = indicePerByte(texture.format);
    const dst = new Uint8Array((texture.width * texture.height / ipb)|0);
    const view = data.createDataView();
    let inOffset = 0;
    let outOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += ipb) {
            dst[outOffset] = view.getUint8(inOffset);
            outOffset++;
            inOffset++;
        }

        outOffset = (outOffset + 7) & ~7;
    }

    return data;
}

function grow(data: ArrayBufferSlice, growthLength: number): ArrayBufferSlice {
    const expanded: Uint8Array = new Uint8Array(data.byteLength + growthLength);
    expanded.set(data.createTypedArray(Uint8Array));
    return ArrayBufferSlice.fromView(expanded);
}

function getLine(texture: InflatedTexture): number {
    if (texture.compressionMethod === CompressionMethod.ZLIB) {
        return 0;
    }

    switch (texture.format) {
        case Format.IA16:
        case Format.RGB15:
        case Format.RGBA16:      return  (texture.width  +  3)   >>>  2;
        case Format.I8:
        case Format.IA16_CI8:
        case Format.IA8:
        case Format.RGBA16_CI8:  return  (texture.width  +  7)   >>>  3;
        case Format.I4:
        case Format.IA16_CI4:
        case Format.IA4:
        case Format.RGBA16_CI4:  return  (texture.width  +  15)  >>>  4;
        default: return 0;
    }
}

export function decodeTexture(texture: InflatedTexture, data: ArrayBufferSlice, lut: Uint8Array): Uint8Array {
    // decodeTex_* will read OOB on odd-sided textures.
    const view = grow(data, 0x1000).createDataView();

    // HACK/FIXME: Some odd-sided textures are decoded as if they were larger.
    // I'm not yet sure this is the right way to do it or the right alignment.
    // Also the special case on this format in particular is odd.
    // See textures 0x067f-0x0682 for neighboring cases of various formats.
    if (texture.imageSize === ImageSize.G_IM_SIZ_4b) {
        texture.width = (texture.width + 1) & ~1;
    }

    const dst = new Uint8Array(texture.width * texture.height * 4);
    const line = getLine(texture);

    switch (texture.format) {
    case Format.RGBA32:
        decodeTex_RGBA32(dst, view, 0, texture.width, texture.height);
        break;
    case Format.RGB15:
    case Format.RGBA16: {
        decodeTex_RGBA16(dst, view, 0, texture.width, texture.height, line);
        break;
    }
    case Format.RGBA16_CI8:
    case Format.IA16_CI8: {
        decodeTex_CI8(dst, view, 0, texture.width, texture.height, lut, line);
        break;
    }
    case Format.RGBA16_CI4:
    case Format.IA16_CI4: {
        decodeTex_CI4(dst, view, 0, texture.width, texture.height, lut, line);
        break;
    }
    case Format.RGB24:
        decodeTex_RGB24(dst, view, 0, texture.width, texture.height);
        break;
    case Format.I8: {
        decodeTex_I8(dst, view, 0, texture.width, texture.height, line);
        break;
    }
    case Format.I4: {
        decodeTex_I4(dst, view, 0, texture.width, texture.height, line);
        break;
    }
    case Format.IA8: {
        decodeTex_IA8(dst, view, 0, texture.width, texture.height, line);
        break;
    }
    case Format.IA4: {
        decodeTex_IA4(dst, view, 0, texture.width, texture.height, line);
        break;
    }
    case Format.IA16: {
        decodeTex_IA16(dst, view, 0, texture.width, texture.height, line);
        break;
    }
    default:
        console.warn(
            hexzero0x(texture.index, 4) + ":",
            "decodeTexture: unhandled format:",
            Format[texture.format],
        );
        break;
    }

    return dst;
}

export class TextureListHolder implements UI.TextureListHolder {
    private viewerTextures: Viewer.Texture[] = [];
    private numberToIndex: Map<string, number> = new Map();
    private metadata: Map<number, InflatedTexture> = new Map();

    public onnewtextures: (() => void) = (() => {});

    constructor(textures: Viewer.Texture[], meta: InflatedTexture[]) {
        this.addTextures(textures);
        this.addMetadata(meta);

        this.viewerTextures.forEach((texture, i) => {
            this.numberToIndex.set(texture.gfxTexture.ResourceName!, i);
        });
    }

    public addMetadata(meta: InflatedTexture[]): void {
        meta.forEach(v => this.metadata.set(v.index, v));
    }

    public get textureNames(): string[] {
        return this.viewerTextures.map((texture) => texture.gfxTexture.ResourceName!);
    }

    public async getViewerTexture(i: number) {
        return this.viewerTextures[i];
    }

    public getMetadata(i: number): InflatedTexture | undefined {
        return this.metadata.get(i);
    }

    public getByTextureNumber(i: number): Viewer.Texture {
        // FIXME: Use number instead of string.
        const name = hexzero0x(i, 4);
        return this.viewerTextures[this.numberToIndex.get(name)!];
    }

    public addTextures(textures: Viewer.Texture[]): void {
        let changed = false;
        for (let i = 0; i < textures.length; i++) {
            if (this.viewerTextures.find((texture) => textures[i].gfxTexture.ResourceName === texture.gfxTexture.ResourceName) === undefined) {
                spliceBisectRight(
                    this.viewerTextures,
                    textures[i],
                    (a:Viewer.Texture, b:Viewer.Texture) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!),
                );
                changed = true;
            }
        }

        if (changed)
            this.onnewtextures();
    }

    public destroy(device: GfxDevice): void {
        this.viewerTextures.forEach(v => device.destroyTexture(v.gfxTexture));
    }
}
