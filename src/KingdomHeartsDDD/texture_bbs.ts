import ArrayBufferSlice from "../ArrayBufferSlice";
import { BBSParser, BBSPixelFormat } from "./bin_bbs";

function fromIndexed4(image: Uint8Array, clut: Uint8Array): Uint8Array {
    let rgba = new Uint8Array(image.length * 8);
    for (let i = 0; i < image.length; i++) {
        let ci1 = image[i] & 0x0F;
        let ci2 = image[i] >> 4;
        rgba[i * 8 + 0] = clut[ci1 * 4];
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
        rgba[i * 4 + 0] = clut[image[i] * 4];
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
        rgba[dst++] = image[i + 0];
        rgba[dst++] = image[i + 1];
        rgba[dst++] = image[i + 2];
        rgba[dst++] = 255;
    }
    return rgba;
}

function sortClut(clut: Uint8Array, format: BBSPixelFormat, colorCount: number) {
    if (colorCount !== 256) {
        return clut;
    }

    let index = 0;
    let dst = new Uint32Array(clut);
    switch (format) {
        case BBSPixelFormat.RGBA_1555:
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 4; j++) {
                    let tmp = dst[index + 4 + j];
                    dst[index + 4 + j] = dst[index + 8 + j];
                    dst[index + 8 + j] = tmp;
                }
                index += 16;
            }
            break;
        case BBSPixelFormat.RGBA_888:
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 8; j++) {
                    let tmp = dst[index + 8 + j];
                    dst[index + 8 + j] = dst[index + 16 + j];
                    dst[index + 16 + j] = tmp;
                }
                index += 32;
            }
            break;
    }

    return new Uint8Array(dst);
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

export function decodeBBSTIM2(data: ArrayBufferSlice): { rgba: Uint8Array, width: number, height: number, format: BBSPixelFormat } {
    const tim2 = new BBSParser(data).parseTIM2();
    const imageOffset = tim2.dataOffset; 
    const clutOffset = imageOffset + tim2.imageSize;
    const imageBuffer = data.slice(imageOffset, imageOffset + tim2.imageSize);
    const clutBuffer = data.slice(clutOffset, clutOffset + (tim2.clutColorCount * 4));
    const image = imageBuffer.createTypedArray(Uint8Array);
    invertRedBlue(image, tim2.pixelFormat, tim2.width * tim2.height);
    let clut: Uint8Array;
    if ((tim2.clutType & 0x80) === 0) {
        clut = sortClut(clutBuffer.createTypedArray(Uint8Array), tim2.clutFormat, tim2.clutColorCount);
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