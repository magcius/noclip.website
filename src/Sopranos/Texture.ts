import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";

const IMAGE_MAGIC = 0x65;
const IMAGE_HEADER_SIZE = 0x2C;
const SGP_IMAGES_AT = 0x80;
const SGP_IMAGES_END_AT = 0x0C;
const EGP_IMAGES_START_AT = 0x4C;
const PALETTE_ENTRIES = 256;
const PALETTE_BYTES = PALETTE_ENTRIES * 4;
const FORMAT_PALETTED = 2;
const FORMAT_RGB = 4;
const FORMAT_RGBA = 5;
const ALPHA_CLEAR = 0.02;
const ALPHA_PARTIAL = 0.20;
const SKIN_HINTS = ['body', 'suit', 'torso', 'head', 'face'];

function clutSwizzleIndex(i: number): number {
    return (i & 0xE7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1);
}

function doubleAlpha(a: number): number {
    return Math.min(255, a * 2);
}

export const enum AlphaMode {
    Opaque,
    Mask,
    Blend,
    Glow,
}

/** The cooker's blend mode for a texture, from byte `0x1B` of its image record. */
export const enum BlendMode {
    /** No override; the render pass decides. For a level means opaque. */
    Default = 0,
    /** GS `TEST_1` with ATE set, ATST `GEQUAL`, AREF 8 on the PS2's 0..128 alpha scale. */
    Cutout = 1,
    /** GS `ALPHA_1` 0x44: `(Cs - Cd) * As + Cd`. */
    Blend = 2,
    /** GS `ALPHA_1` 0x68 with FIX 0x80: `Cs + Cd`. Drawn without depth writes. */
    Additive = 3,
    /** GS `ALPHA_1` 0xA1 with FIX 0x80: `Cd - Cs`. Drawn without depth writes. */
    Subtractive = 4,
}

export interface TextureInfo {
    name: string;
    width: number;
    height: number;
    pixelFormat: number;
    blendMode: BlendMode;
    dataOffset: number;
    paletteOffset: number;
    recordOffset: number;
}

export interface DecodedTexture {
    name: string;
    width: number;
    height: number;
    pixels: Uint8Array;
    alphaMode: AlphaMode;
    /** The cooker's own blend mode. `Default` leaves the choice to `alphaMode`. */
    blendMode: BlendMode;
}

function readImage(view: DataView, data: ArrayBufferSlice, offset: number): { info: TextureInfo | null, total: number } {
    if (view.getUint32(offset + 0x00, true) !== IMAGE_MAGIC) {
        return { info: null, total: 0 };
    }
    const total = view.getUint32(offset + 0x04, true);
    const nameOffset = view.getUint32(offset + 0x08, true);
    const pixelFormat = view.getUint8(offset + 0x1A);
    if (pixelFormat !== FORMAT_PALETTED && pixelFormat !== FORMAT_RGB && pixelFormat !== FORMAT_RGBA) {
        return { info: null, total: 0 };
    }
    const dataOffset = view.getUint32(offset + 0x24, true);
    const paletteOffset = view.getUint32(offset + 0x28, true);
    return {
        info: {
            name: readString(data, offset + nameOffset),
            width: view.getUint16(offset + 0x14, true),
            height: view.getUint16(offset + 0x16, true),
            pixelFormat,
            blendMode: view.getUint8(offset + 0x1B) as BlendMode,
            dataOffset: offset + dataOffset,
            paletteOffset: paletteOffset !== 0 ? offset + paletteOffset : 0,
            recordOffset: offset,
        },
        total,
    };
}

/**
 * Read every image embedded in a `.SGP2` or `.EGP2` geometry blob.
 * @param data The whole geometry blob.
 * @returns One entry per embedded image, in file order.
 */
export function readGeometryTextures(data: ArrayBufferSlice): TextureInfo[] {
    const textures: TextureInfo[] = [];
    if (data.byteLength < SGP_IMAGES_AT) {
        return textures;
    }
    const view = data.createDataView();
    const end = view.getUint32(SGP_IMAGES_END_AT, true);
    let offset = end !== 0 ? SGP_IMAGES_AT : view.getUint32(EGP_IMAGES_START_AT, true);
    const limit = end !== 0 ? Math.min(end, data.byteLength) : data.byteLength;
    while (offset + IMAGE_HEADER_SIZE <= limit) {
        const { info, total } = readImage(view, data, offset);
        if (info === null || total === 0) {
            break;
        }
        textures.push(info);
        offset += total;
    }
    return textures;
}

/**
 * Decode one image to top-down RGBA.
 * @param data The blob holding the image.
 * @param texture The image to decode.
 * @returns The pixels, or `null` when the image runs past the end of the blob.
 */
export function decodeTexture(data: ArrayBufferSlice, texture: TextureInfo): Uint8Array | null {
    const { width, height } = texture;
    const bytes = data.createTypedArray(Uint8Array);
    const pixels = new Uint8Array(width * height * 4);

    if (texture.pixelFormat === FORMAT_RGB || texture.pixelFormat === FORMAT_RGBA) {
        const depth = texture.pixelFormat === FORMAT_RGB ? 3 : 4;
        if (texture.dataOffset + width * height * depth > bytes.length) {
            return null;
        }
        for (let i = 0; i < width * height; i++) {
            const src = texture.dataOffset + i * depth;
            pixels[i * 4 + 0] = bytes[src + 0];
            pixels[i * 4 + 1] = bytes[src + 1];
            pixels[i * 4 + 2] = bytes[src + 2];
            pixels[i * 4 + 3] = depth === 3 ? 0xFF : doubleAlpha(bytes[src + 3]);
        }
    } else {
        if (texture.dataOffset + width * height > bytes.length || texture.paletteOffset + PALETTE_BYTES > bytes.length) {
            return null;
        }
        const palette = new Uint8Array(PALETTE_BYTES);
        for (let i = 0; i < PALETTE_ENTRIES; i++) {
            const slot = texture.paletteOffset + clutSwizzleIndex(i) * 4;
            palette[i * 4 + 0] = bytes[slot + 0];
            palette[i * 4 + 1] = bytes[slot + 1];
            palette[i * 4 + 2] = bytes[slot + 2];
            palette[i * 4 + 3] = doubleAlpha(bytes[slot + 3]);
        }
        for (let i = 0; i < width * height; i++) {
            const entry = bytes[texture.dataOffset + i] * 4;
            pixels[i * 4 + 0] = palette[entry + 0];
            pixels[i * 4 + 1] = palette[entry + 1];
            pixels[i * 4 + 2] = palette[entry + 2];
            pixels[i * 4 + 3] = palette[entry + 3];
        }
    }

    // Rows are stored bottom-up, following the .tga sources.
    const stride = width * 4;
    const row = new Uint8Array(stride);
    for (let y = 0; y < (height >> 1); y++) {
        const top = y * stride, bottom = (height - 1 - y) * stride;
        row.set(pixels.subarray(top, top + stride));
        pixels.copyWithin(top, bottom, bottom + stride);
        pixels.set(row, bottom);
    }
    return pixels;
}

function alphaModeFromPixels(pixels: Uint8Array): AlphaMode {
    const total = pixels.length / 4;
    let clear = 0, partial = 0;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 8) {
            clear++;
        } else if (pixels[i] < 248) {
            partial++;
        }
    }
    if (clear / total < ALPHA_CLEAR && partial / total < ALPHA_PARTIAL) {
        return AlphaMode.Opaque;
    }
    return partial / total >= ALPHA_PARTIAL ? AlphaMode.Blend : AlphaMode.Mask;
}

function isGlow(pixels: Uint8Array): boolean {
    for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] !== 0xFF) {
            return false;
        }
    }
    return pixels.length > 0;
}

function asOverlay(pixels: Uint8Array, darkening: boolean): void {
    for (let i = 0; i < pixels.length; i += 4) {
        const luminance = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
        if (darkening) {
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
        pixels[i + 3] = luminance;
    }
}

/**
 * Decode one image and give it its alpha treatment.
 * @param data The blob holding the image.
 * @param texture The image to decode.
 * @param isProp Whether the blob is a `.SGP2`.
 * @returns The decoded texture, or `null` when it runs past the end of the blob.
 */
export function prepareTexture(data: ArrayBufferSlice, texture: TextureInfo, isProp: boolean): DecodedTexture | null {
    const pixels = decodeTexture(data, texture);
    if (pixels === null) {
        return null;
    }
    const name = texture.name.split('/').pop()!.toLowerCase();
    let alphaMode = alphaModeFromPixels(pixels);
    if (!isProp) {
        return {
            name, width: texture.width, height: texture.height, pixels,
            alphaMode: texture.blendMode === BlendMode.Default && isGlow(pixels) ? AlphaMode.Glow : alphaMode,
            blendMode: texture.blendMode,
        };
    }
    if (isGlow(pixels)) {
        alphaMode = AlphaMode.Glow;
    } else if (name.startsWith('add_') || name.startsWith('sub_')) {
        asOverlay(pixels, name.startsWith('sub_'));
        alphaMode = AlphaMode.Blend;
    } else if (isProp && alphaMode === AlphaMode.Mask && SKIN_HINTS.some((hint) => name.includes(hint))) {
        alphaMode = AlphaMode.Opaque;
    }
    return { name, width: texture.width, height: texture.height, pixels, alphaMode, blendMode: texture.blendMode };
}
