import ArrayBufferSlice from "../ArrayBufferSlice";
import { decodeTexture, TextureFormat } from "../Common/CTR/pica_texture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { DreamDropCTRT } from "./bin";
import { BBSParser, BBSPixelFormat } from "./bin_bbs";
import { LuxTexture } from "./lux";

export enum CTRTFormat {
    RGBA_8888,
    RGB_888,
    RGBA_5551,
    RGB_565,
    RGBA_4444,
    LA8,
    HILO8, // unused
    L8,
    A8,
    LA4, // unused
    L4, // unused
    A4, // unused
    ETC1,
    ETC1A4
}

export class CTRTexture extends LuxTexture {
    constructor(device: GfxDevice, name: string, width: number, height: number, data: Uint8Array, public format: CTRTFormat) {
        super(device, name, width, height, data);
    }
}

/**
 * Decodes CTR texture for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export function decodeDreamDropCTRT(ctrt: DreamDropCTRT): Uint8Array {
    switch (ctrt.format) {
        case CTRTFormat.RGBA_8888:
            return decodeTexture(TextureFormat.RGBA8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGB_888:
            return decodeTexture(TextureFormat.RGB8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGBA_5551:
            return decodeTexture(TextureFormat.RGBA5551, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGB_565:
            return decodeTexture(TextureFormat.RGB565, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.RGBA_4444:
            return decodeTexture(TextureFormat.RGBA4444, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.LA8:
            return decodeTexture(TextureFormat.LA8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.L8:
            return decodeTexture(TextureFormat.L8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.A8:
            return decodeTexture(TextureFormat.A8, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.ETC1:
            return decodeTexture(TextureFormat.ETC1, ctrt.width, ctrt.height, ctrt.data);
        case CTRTFormat.ETC1A4:
            return decodeTexture(TextureFormat.ETC1A4, ctrt.width, ctrt.height, ctrt.data);
        default:
            console.warn("Unimplemented texture format", ctrt.format);
            return new Uint8Array(0);
    }
}

// Credit: https://github.com/OpenKH/OpenKh/blob/master/OpenKh.Imaging/Tm2.cs

function fromIndexed4(image: Uint8Array, clut: Uint8Array): Uint8Array {
    let rgba = new Uint8Array(image.length * 8);
    for (let i = 0; i < image.length; i++) {
        let ci1 = image[i] & 0x0F;
        let ci2 = image[i] >> 4;
        rgba[i * 8] = clut[ci1 * 4];
        rgba[i * 8 + 1] = clut[ci1 * 4 + 1];
        rgba[i * 8 + 2] = clut[ci1 * 4 + 2];
        rgba[i * 8 + 3] = clut[ci1 * 4 + 3];
        rgba[i * 8 + 4] = clut[ci2 * 4];
        rgba[i * 8 + 5] = clut[ci2 * 4 + 1];
        rgba[i * 8 + 6] = clut[ci2 * 4 + 2];
        rgba[i * 8 + 7] = clut[ci2 * 4 + 3];
    }
    return rgba;
}

function fromIndexed8(image: Uint8Array, clut: Uint8Array): Uint8Array {
    let rgba = new Uint8Array(image.length * 4);
    for (let i = 0; i < image.length; i++) {
        rgba[i * 4] = clut[image[i] * 4];
        rgba[i * 4 + 1] = clut[image[i] * 4 + 1];
        rgba[i * 4 + 2] = clut[image[i] * 4 + 2];
        rgba[i * 4 + 3] = clut[image[i] * 4 + 3];
    }
    return rgba;
}

function fromRGB888(image: Uint8Array): Uint8Array {
    let rgba = new Uint8Array(image.length / 3 * 4);
    let dst = 0;
    for (let i = 0; i < image.length; i += 3) {
        rgba[dst++] = image[i];
        rgba[dst++] = image[i + 1];
        rgba[dst++] = image[i + 2];
        rgba[dst++] = 255;
    }
    return rgba;
}

function toNumberArray(a: Uint8Array): number[] {
    const b = Array(a.length / 4);
    for (let i = 0; i < b.length; i++) {
        b[i] = a[i * 4] | (a[i * 4 + 1] << 8) | (a[i * 4 + 2] << 16) | (a[i * 4 + 3] << 24);
    }
    return b;
}

function toByteArray(src: number[]): Uint8Array {
    const dst = new Uint8Array(src.length * 4);
    for (let i = 0; i < src.length; i++) {
        dst[i * 4] = src[i];
        dst[i * 4 + 1] = src[i] >> 8;
        dst[i * 4 + 2] = src[i] >> 16;
        dst[i * 4 + 3] = src[i] >> 24;
    }
    return dst;
}

function sortClut(clut: Uint8Array, format: BBSPixelFormat): Uint8Array {
    let index = 0;
    const dst = toNumberArray(clut);
    switch (format) {
        case BBSPixelFormat.RGBA_1555:
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 4; j++) {
                    const tmp = dst[index + 4 + j];
                    dst[index + 4 + j] = dst[index + 8 + j];
                    dst[index + 8 + j] = tmp;
                }
                index += 16;
            }
            break;
        case BBSPixelFormat.RGBA_888:
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 8; j++) {
                    const tmp = dst[index + 8 + j];
                    dst[index + 8 + j] = dst[index + 16 + j];
                    dst[index + 16 + j] = tmp;
                }
                index += 32;
            }
            break;
    }
    return toByteArray(dst);
}

function invertRedBlue(data: Uint8Array, format: BBSPixelFormat, length: number) {
    switch (format) {
        case BBSPixelFormat.RGB_888:
            for (var i = 0; i < length; i++) {
                let tmp = data[i * 3 + 0];
                data[i * 3 + 0] = data[i * 3 + 2];
                data[i * 3 + 2] = tmp;
            }
            break;
        case BBSPixelFormat.RGBA_888:
            for (let i = 0; i < length; i++) {
                let tmp = data[i * 4 + 0];
                data[i * 4 + 0] = data[i * 4 + 2];
                data[i * 4 + 2] = tmp;
            }
            break;
    }
}

export class TIM2Texture extends LuxTexture {
    constructor(device: GfxDevice, name: string, width: number, height: number, data: Uint8Array, public format: BBSPixelFormat) {
        super(device, name, width, height, data);
    }
}

export function decodeBBSTIM2(data: ArrayBufferSlice): { rgba: Uint8Array, width: number, height: number, format: BBSPixelFormat } {
    const tim2 = new BBSParser(data).parseTIM2();
    const imageOffset = tim2.dataOffset;
    const clutOffset = imageOffset + tim2.imageSize;
    const imageBuffer = data.slice(imageOffset, imageOffset + tim2.imageSize);
    const clutBuffer = data.slice(clutOffset, clutOffset + (tim2.clutColorCount * 4));
    const image = imageBuffer.createTypedArray(Uint8Array);
    invertRedBlue(image, tim2.pixelFormat, tim2.width * tim2.height);
    let clut: Uint8Array;
    if ((tim2.clutType & 0x80) === 0 && tim2.clutColorCount === 256) {
        clut = sortClut(clutBuffer.createTypedArray(Uint8Array), tim2.clutFormat);
    } else {
        clut = clutBuffer.createTypedArray(Uint8Array);
    }
    let rgba: Uint8Array;
    switch(tim2.pixelFormat) {
        case BBSPixelFormat.INDEXED_4:
            rgba = fromIndexed4(image, clut);
            break;
        case BBSPixelFormat.INDEXED_8:
            rgba = fromIndexed8(image, clut);
            break;
        case BBSPixelFormat.RGB_888:
            rgba = fromRGB888(image);
            break;
        default:
            rgba = imageBuffer.createTypedArray(Uint8Array);
            break;
    }
    return { rgba, width: tim2.width, height: tim2.height, format: tim2.pixelFormat };
}

