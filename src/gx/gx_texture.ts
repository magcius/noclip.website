
// GX texture decoding

import ArrayBufferSlice from 'ArrayBufferSlice';

import * as GX from './gx_enum';

export interface Texture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice;
}

export interface DecodedTextureS3TC {
    type: "S3TC";
    pixels: ArrayBufferView;
    width: number;
    height: number;
}

export interface DecodedTextureRGBA {
    type: "RGBA";
    pixels: ArrayBufferView;
    width: number;
    height: number;
}

export type DecodedTexture = DecodedTextureS3TC | DecodedTextureRGBA;

function expand3to8(n: number): number {
    return (n << (8 - 3)) | (n << (8 - 6)) | (n >>> (9 - 8));
}

function expand4to8(n: number): number {
    return (n << 4) | n;
}

function expand5to8(n: number): number {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function expand6to8(n: number): number {
    return (n << (8 - 6)) | (n >>> (12 - 8));
}

// GX uses a HW approximation of 3/8 + 5/8 instead of 1/3 + 2/3.
function s3tcblend(a: number, b: number): number {
    // return (a*3 + b*5) / 8;
    return (((a << 1) + a) + ((b << 2) + b)) >>> 3;
}

export function calcPaletteSize(format: GX.TexFormat, palette: GX.TexPalette) {
    let paletteSize = 0;

    switch (format) {
    case GX.TexFormat.C4:
        paletteSize = 16;
        break;
    case GX.TexFormat.C8:
        paletteSize = 256;
        break;
    case GX.TexFormat.C14X2:
    default:
        throw new Error("whoops");
    }

    // All palette-formats are 16-bit.
    return paletteSize * 2;
}

export function calcTextureSize(format: GX.TexFormat, width: number, height: number) {
    const numPixels = width * height;
    switch (format) {
    case GX.TexFormat.I4:
        return numPixels / 2;
    case GX.TexFormat.I8:
        return numPixels;
    case GX.TexFormat.IA4:
        return numPixels;
    case GX.TexFormat.IA8:
        return numPixels * 2;
    case GX.TexFormat.C4:
        return numPixels / 2;
    case GX.TexFormat.C8:
        return numPixels;
    case GX.TexFormat.RGB565:
        return numPixels * 2;
    case GX.TexFormat.RGB5A3:
        return numPixels * 2;
    case GX.TexFormat.RGBA8:
        return numPixels * 4;
    case GX.TexFormat.CMPR:
        return numPixels / 2;
    default:
        throw new Error("whoops");
    }
}

export function calcFullTextureSize(format: GX.TexFormat, width: number, height: number, mipCount: number) {
    let textureSize = 0;
    while (mipCount--) {
        textureSize += calcTextureSize(format, width, height);
        width /= 2;
        height /= 2;
    }
    return textureSize;
}

// GX's CMPR format is S3TC but using GX's tiled addressing.
function decode_CMPR_to_S3TC(texture: Texture): DecodedTextureS3TC {
    // CMPR goes in 2x2 "macro-blocks" of four S3TC normal blocks.

    function reverseByte(v: number): number {
        // Reverse the order of the four half-nibbles.
        return ((v & 0x03) << 6) | ((v & 0x0c) << 2) | ((v & 0x30) >>> 2) | ((v & 0xc0) >>> 6);
    }

    const pixels = new Uint8Array(texture.width * texture.height / 2);
    const view = texture.data.createDataView();

    // "Macroblocks"
    const w4 = texture.width >>> 2;
    const h4 = texture.height >>> 2;

    let srcOffs = 0;
    for (let yy = 0; yy < h4; yy += 2) {
        for (let xx = 0; xx < w4; xx += 2) {
            // S3TC blocks.
            for (let y = 0; y < 2; y++) {
                for (let x = 0; x < 2; x++) {
                    const dstBlock = (yy + y) * w4 + xx + x;
                    const dstOffs = dstBlock * 8;

                    pixels[dstOffs + 0] = view.getUint8(srcOffs + 1);
                    pixels[dstOffs + 1] = view.getUint8(srcOffs + 0);
                    pixels[dstOffs + 2] = view.getUint8(srcOffs + 3);
                    pixels[dstOffs + 3] = view.getUint8(srcOffs + 2);
                    pixels[dstOffs + 4] = reverseByte(view.getUint8(srcOffs + 4));
                    pixels[dstOffs + 5] = reverseByte(view.getUint8(srcOffs + 5));
                    pixels[dstOffs + 6] = reverseByte(view.getUint8(srcOffs + 6));
                    pixels[dstOffs + 7] = reverseByte(view.getUint8(srcOffs + 7));
                    srcOffs += 8;
                }
            }
        }
    }
    return { type: "S3TC", pixels, width: texture.width, height: texture.height };
}

// Software decodes from standard S3TC (not CMPR!) to RGBA.
function decode_S3TC(texture: DecodedTextureS3TC): DecodedTextureRGBA {
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    const view = new DataView(texture.pixels.buffer);
    const colorTable = new Uint8Array(16);

    let srcOffs = 0;
    for (let yy = 0; yy < texture.height; yy += 4) {
        for (let xx = 0; xx < texture.width; xx += 4) {
            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);

            // Fill in first two colors in color table.
            colorTable[0] = expand5to8((color1 >> 11) & 0x1F);
            colorTable[1] = expand6to8((color1 >> 5) & 0x3F);
            colorTable[2] = expand5to8(color1 & 0x1F);
            colorTable[3] = 0xFF;

            colorTable[4] = expand5to8((color2 >> 11) & 0x1F);
            colorTable[5] = expand6to8((color2 >> 5) & 0x3F);
            colorTable[6] = expand5to8(color2 & 0x1F);
            colorTable[7] = 0xFF;

            if (color1 > color2) {
                // Predict gradients.
                colorTable[8]  = s3tcblend(colorTable[4], colorTable[0]);
                colorTable[9]  = s3tcblend(colorTable[5], colorTable[1]);
                colorTable[10] = s3tcblend(colorTable[6], colorTable[2]);
                colorTable[11] = 0xFF;

                colorTable[12] = s3tcblend(colorTable[0], colorTable[4]);
                colorTable[13] = s3tcblend(colorTable[1], colorTable[5]);
                colorTable[14] = s3tcblend(colorTable[2], colorTable[6]);
                colorTable[15] = 0xFF;
            } else {
                colorTable[8]  = (colorTable[0] + colorTable[4]) >>> 1;
                colorTable[9]  = (colorTable[1] + colorTable[5]) >>> 1;
                colorTable[10] = (colorTable[2] + colorTable[6]) >>> 1;
                colorTable[11] = 0xFF;

                // GX difference: GX fills with an alpha 0 midway point here.
                colorTable[12] = colorTable[8];
                colorTable[13] = colorTable[9];
                colorTable[14] = colorTable[10];
                colorTable[15] = 0x00;
            }

            let bits = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstPx = (yy + y) * texture.width + xx + x;
                    const dstOffs = dstPx * 4;
                    const colorIdx = bits & 0x03;
                    pixels[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                    pixels[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                    pixels[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                    pixels[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                    bits >>= 2;
                }
            }

            srcOffs += 8;
        }
    }
    return { type: "RGBA", pixels, width: texture.width, height: texture.height };
}

function decode_Tiled(texture: Texture, bw: number, bh: number, decoder: (pixels: Uint8Array, dstOffs: number) => void): DecodedTexture {
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    for (let yy = 0; yy < texture.height; yy += bh) {
        for (let xx = 0; xx < texture.width; xx += bw) {
            for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                    const dstPixel = (texture.width * (yy + y)) + xx + x;
                    const dstOffs = dstPixel * 4;
                    decoder(pixels, dstOffs);
                }
            }
        }
    }
    return { type: "RGBA", pixels, width: texture.width, height: texture.height };
}

function decode_RGB565(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;
    return decode_Tiled(texture, 4, 4, (pixels: Uint8Array, dstOffs: number): void => {
        const p = view.getUint16(srcOffs);
        pixels[dstOffs + 0] = expand5to8((p >> 11) & 0x1F);
        pixels[dstOffs + 1] = expand6to8((p >> 5) & 0x3F);
        pixels[dstOffs + 2] = expand5to8(p & 0x1F);
        pixels[dstOffs + 3] = 0xFF;
        srcOffs += 2;
    });
}

function decode_RGB5A3(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;
    return decode_Tiled(texture, 4, 4, (pixels: Uint8Array, dstOffs: number): void => {
        const p = view.getUint16(srcOffs);
        if (p & 0x8000) {
            // RGB5
            pixels[dstOffs + 0] = expand5to8((p >> 10) & 0x1F);
            pixels[dstOffs + 1] = expand5to8((p >> 5) & 0x1F);
            pixels[dstOffs + 2] = expand5to8(p & 0x1F);
            pixels[dstOffs + 3] = 0xFF;
        } else {
            // A3RGB4
            pixels[dstOffs + 0] = expand4to8((p >> 8) & 0x0F);
            pixels[dstOffs + 1] = expand4to8((p >> 4) & 0x0F);
            pixels[dstOffs + 2] = expand4to8(p & 0x0F);
            pixels[dstOffs + 3] = expand3to8(p >> 12);
        }
        srcOffs += 2;
    });
}

function decode_RGBA8(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;
    // RGBA8 is a bit special, so we hand-code this one.
    const bw = 4;
    const bh = 4;
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    for (let yy = 0; yy < texture.height; yy += bh) {
        for (let xx = 0; xx < texture.width; xx += bw) {
            for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                    const dstPixel = (texture.width * (yy + y)) + xx + x;
                    const dstOffs = dstPixel * 4;
                    pixels[dstOffs + 3] = view.getUint8(srcOffs + 0);
                    pixels[dstOffs + 0] = view.getUint8(srcOffs + 1);
                    srcOffs += 2;
                }
            }
            for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                    const dstPixel = (texture.width * (yy + y)) + xx + x;
                    const dstOffs = dstPixel * 4;
                    pixels[dstOffs + 1] = view.getUint8(srcOffs + 0);
                    pixels[dstOffs + 2] = view.getUint8(srcOffs + 1);
                    srcOffs += 2;
                }
            }
        }
    }
    return { type: "RGBA", pixels, width: texture.width, height: texture.height };
}

function decode_I4(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;
    return decode_Tiled(texture, 8, 8, (pixels: Uint8Array, dstOffs: number): void => {
        const ii = view.getUint8(srcOffs >> 1);
        const i4 = ii >>> ((srcOffs & 1) ? 0 : 4) & 0x0F;
        const i = expand4to8(i4);
        pixels[dstOffs + 0] = i;
        pixels[dstOffs + 1] = i;
        pixels[dstOffs + 2] = i;
        pixels[dstOffs + 3] = i;
        srcOffs++;
    });
}

function decode_I8(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;
    return decode_Tiled(texture, 8, 4, (pixels: Uint8Array, dstOffs: number): void => {
        const i = view.getUint8(srcOffs);
        pixels[dstOffs + 0] = i;
        pixels[dstOffs + 1] = i;
        pixels[dstOffs + 2] = i;
        pixels[dstOffs + 3] = i;
        srcOffs++;
    });
}

function decode_IA4(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;

    return decode_Tiled(texture, 8, 4, (pixels: Uint8Array, dstOffs: number): void => {
        const ia = view.getUint8(srcOffs);
        const a = expand4to8(ia >>> 4);
        const i = expand4to8(ia & 0x0F);
        pixels[dstOffs + 0] = i;
        pixels[dstOffs + 1] = i;
        pixels[dstOffs + 2] = i;
        pixels[dstOffs + 3] = a;
        srcOffs++;
    });
}

function decode_IA8(texture: Texture): DecodedTexture {
    const view = texture.data.createDataView();
    let srcOffs = 0;
    return decode_Tiled(texture, 4, 4, (pixels: Uint8Array, dstOffs: number): void => {
        const a = view.getUint8(srcOffs + 0);
        const i = view.getUint8(srcOffs + 1);
        pixels[dstOffs + 0] = i;
        pixels[dstOffs + 1] = i;
        pixels[dstOffs + 2] = i;
        pixels[dstOffs + 3] = a;
        srcOffs += 2;
    });
}

function decode_Dummy(texture: Texture): DecodedTexture {
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    pixels.fill(0xFF);
    return { type: "RGBA", width: texture.width, height: texture.height, pixels };
}

export function decodeTexture(texture: Texture, supportsS3TC: boolean): DecodedTexture {
    if (texture.data === null)
        return decode_Dummy(texture);

    switch (texture.format) {
    case GX.TexFormat.CMPR:
        const s3tc = decode_CMPR_to_S3TC(texture);
        if (supportsS3TC)
            return s3tc;
        else
            return decode_S3TC(s3tc);
    case GX.TexFormat.RGB565:
        return decode_RGB565(texture);
    case GX.TexFormat.RGB5A3:
        return decode_RGB5A3(texture);
    case GX.TexFormat.RGBA8:
        return decode_RGBA8(texture);
    case GX.TexFormat.I4:
        return decode_I4(texture);
    case GX.TexFormat.I8:
        return decode_I8(texture);
    case GX.TexFormat.IA4:
        return decode_IA4(texture);
    case GX.TexFormat.IA8:
        return decode_IA8(texture);
    case GX.TexFormat.C4:
    case GX.TexFormat.C8:
    case GX.TexFormat.C14X2:
    default:
        console.error(`Unsupported texture format ${texture.format} on texture ${texture.name}`);
        return decode_Dummy(texture);
    }
}
