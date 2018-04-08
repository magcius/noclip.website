
import { GX2SurfaceFormat, GX2TileMode, GX2AAMode } from './gx2_enum';
import { GX2Surface, DecodedSurface } from './gx2_surface';
import { deswizzler } from './gx2_swizzle';
import ArrayBufferSlice from 'ArrayBufferSlice';
import { assert } from '../util';

interface DecodedTextureRGBA {
    type: 'RGBA';
    flag: 'UNORM' | 'SNORM' | 'SRGB';
    bytesPerPixel: 4;
    surfaces: DecodedSurface[];
    width: number;
    height: number;
}

interface DecodedTextureBC13 {
    type: 'BC1' | 'BC3';
    flag: 'UNORM' | 'SRGB';
    surfaces: DecodedSurface[];
    width: number;
    height: number;
}

interface DecodedTextureBC45 {
    type: 'BC4' | 'BC5';
    flag: 'UNORM' | 'SNORM';
    surfaces: DecodedSurface[];
    width: number;
    height: number;
}

export type DecodedTextureBC = DecodedTextureBC13 | DecodedTextureBC45;
export type DecodedTextureSW = DecodedTextureRGBA;
export type DecodedTexture = DecodedTextureBC | DecodedTextureSW;

// #region Texture Decode
function expand5to8(n: number): number {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function expand6to8(n: number): number {
    return (n << (8 - 6)) | (n >>> (12 - 8));
}

// Use the fast GX approximation.
function s3tcblend(a: number, b: number): number {
    // return (a*3 + b*5) / 8;
    return (((a << 1) + a) + ((b << 2) + b)) >>> 3;
}

// Software decompresses from standard BC1 (DXT1) to RGBA.
function decompressBC1Surface(surface: DecodedSurface, flag: string): DecodedSurface {
    const bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;
    const dst = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(surface.pixels);
    const colorTable = new Uint8Array(16);

    let srcOffs = 0;
    for (let yy = 0; yy < height; yy += 4) {
        for (let xx = 0; xx < width; xx += 4) {
            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);

            // Fill in first two colors in color table.
            // TODO(jstpierre): SRGB-correct blending.
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

                colorTable[12] = 0x00;
                colorTable[13] = 0x00;
                colorTable[14] = 0x00;
                colorTable[15] = 0x00;
            }

            let bits = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstPx = (yy + y) * width + xx + x;
                    const dstOffs = dstPx * 4;
                    const colorIdx = bits & 0x03;
                    dst[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                    dst[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                    dst[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                    dst[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                    bits >>= 2;
                }
            }

            srcOffs += 0x08;
        }
    }

    const pixels = dst.buffer;
    return { ...surface, pixels };
}

// Software decompresses from standard BC3 (DXT5) to RGBA.
function decompressBC3Surface(surface: DecodedSurface, flag: string): DecodedSurface {
    const bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;
    const dst = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(surface.pixels);
    const colorTable = new Uint8Array(16);
    const alphaTable = new Uint8Array(8);

    let srcOffs = 0;
    for (let yy = 0; yy < height; yy += 4) {
        for (let xx = 0; xx < width; xx += 4) {

            const alpha1 = view.getUint8(srcOffs + 0x00);
            const alpha2 = view.getUint8(srcOffs + 0x01);

            alphaTable[0] = alpha1;
            alphaTable[1] = alpha2;
            if (alpha1 > alpha2) {
                alphaTable[2] = (6 * alpha1 + 1 * alpha2) / 7;
                alphaTable[3] = (5 * alpha1 + 2 * alpha2) / 7;
                alphaTable[4] = (4 * alpha1 + 3 * alpha2) / 7;
                alphaTable[5] = (3 * alpha1 + 4 * alpha2) / 7;
                alphaTable[6] = (2 * alpha1 + 5 * alpha2) / 7;
                alphaTable[7] = (1 * alpha1 + 6 * alpha2) / 7;
            } else {
                alphaTable[2] = (4 * alpha1 + 1 * alpha2) / 5;
                alphaTable[3] = (3 * alpha1 + 2 * alpha2) / 5;
                alphaTable[4] = (2 * alpha1 + 3 * alpha2) / 5;
                alphaTable[5] = (1 * alpha1 + 4 * alpha2) / 5;
                alphaTable[6] = 0;
                alphaTable[7] = 255;
            }

            const alphaBits0 = view.getUint32(srcOffs + 0x02, true) & 0x00FFFFFF;
            const alphaBits1 = view.getUint32(srcOffs + 0x04, true) >>> 8;
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstIdx = ((yy + y) * width) + xx + x;
                    const dstOffs = (dstIdx * bytesPerPixel);
                    const fullShift = (y * 4 + x) * 3;
                    const alphaBits = fullShift < 24 ? alphaBits0 : alphaBits1;
                    const shift = fullShift % 24;
                    const index = (alphaBits >>> shift) & 0x07;
                    dst[dstOffs + 3] = alphaTable[index];
                }
            }

            srcOffs += 0x08;

            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);

            // Fill in first two colors in color table.
            // TODO(jstpierre): SRGB-correct blending.
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

                colorTable[12] = 0x00;
                colorTable[13] = 0x00;
                colorTable[14] = 0x00;
                colorTable[15] = 0xFF;
            }

            let colorBits = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstIdx = (yy + y) * width + xx + x;
                    const dstOffs = (dstIdx * bytesPerPixel);
                    const colorIdx = colorBits & 0x03;
                    dst[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                    dst[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                    dst[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                    colorBits >>= 2;
                }
            }

            srcOffs += 0x08;
        }
    }

    const pixels = dst.buffer;
    return { ...surface, pixels };
}

// Software decompresses from standard BC4/BC5 to RGBA.
function decompressBC45Surface(surface: DecodedSurface, inType: 'BC4' | 'BC5', flag: string): DecodedSurface {
    let bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;

    const signed = flag === 'SNORM';
    const view = new DataView(surface.pixels);
    let dst;
    let colorTable;

    let srcBytesPerPixel;
    if (inType === 'BC4')
        srcBytesPerPixel = 1;
    else
        srcBytesPerPixel = 2;

    if (signed) {
        dst = new Int8Array(width * height * bytesPerPixel);
        colorTable = new Int8Array(8);
    } else {
        dst = new Uint8Array(width * height * bytesPerPixel);
        colorTable = new Uint8Array(8);
    }

    let srcOffs = 0;
    for (let yy = 0; yy < height; yy += 4) {
        for (let xx = 0; xx < width; xx += 4) {
            for (let ch = 0; ch < srcBytesPerPixel; ch++) {
                let red0;
                let red1;
                if (signed) {
                    red0 = view.getInt8(srcOffs + 0x00);
                    red1 = view.getInt8(srcOffs + 0x01);
                } else {
                    red0 = view.getUint8(srcOffs + 0x00);
                    red1 = view.getUint8(srcOffs + 0x01);
                }

                colorTable[0] = red0;
                colorTable[1] = red1;
                if (red0 > red1) {
                    colorTable[2] = (6 * red0 + 1 * red1) / 7;
                    colorTable[3] = (5 * red0 + 2 * red1) / 7;
                    colorTable[4] = (4 * red0 + 3 * red1) / 7;
                    colorTable[5] = (3 * red0 + 4 * red1) / 7;
                    colorTable[6] = (2 * red0 + 5 * red1) / 7;
                    colorTable[7] = (1 * red0 + 6 * red1) / 7;
                } else {
                    colorTable[2] = (4 * red0 + 1 * red1) / 5;
                    colorTable[3] = (3 * red0 + 2 * red1) / 5;
                    colorTable[4] = (2 * red0 + 3 * red1) / 5;
                    colorTable[5] = (1 * red0 + 4 * red1) / 5;
                    colorTable[6] = signed ? -127 : 0;
                    colorTable[7] = signed ? 128 : 255;
                }

                const colorBits0 = view.getUint32(srcOffs + 0x02, true) & 0x00FFFFFF;
                const colorBits1 = view.getUint32(srcOffs + 0x04, true) >>> 8;
                for (let y = 0; y < 4; y++) {
                    for (let x = 0; x < 4; x++) {
                        const dstIdx = ((yy + y) * width) + xx + x;
                        const dstOffs = (dstIdx * bytesPerPixel) + ch;
                        const fullShift = (y * 4 + x) * 3;
                        const colorBits = fullShift < 24 ? colorBits0 : colorBits1;
                        const shift = fullShift % 24;
                        const index = (colorBits >>> shift) & 0x07;
                        if (ch === 0) {
                            dst[dstOffs + 0] = colorTable[index];
                            dst[dstOffs + 1] = colorTable[index];
                            dst[dstOffs + 2] = colorTable[index];
                            dst[dstOffs + 3] = colorTable[index];
                        } else {
                            dst[dstOffs + 3] = colorTable[index];
                        }
                    }
                }

                srcOffs += 0x08;
            }
        }
    }

    const pixels = dst.buffer;
    return { ...surface, pixels };
}

export function decompressBCSurface(type: 'BC1' | 'BC3' | 'BC4' | 'BC5', flag: string, surface: DecodedSurface): DecodedSurface {
    switch (type) {
    case 'BC1':
        return decompressBC1Surface(surface, flag);
    case 'BC3':
        return decompressBC3Surface(surface, flag);
    case 'BC4':
    case 'BC5':
        return decompressBC45Surface(surface, type, flag);
    }
}

export function decompressBC(texture: DecodedTextureBC): DecodedTextureSW {
    let width = texture.width;
    let height = texture.height;

    const surfaces: DecodedSurface[] = texture.surfaces.map((surface, i) => {
        return decompressBCSurface(texture.type, texture.flag, surface);
    });

    return { type: 'RGBA', bytesPerPixel: 4, flag: texture.flag, width: texture.width, height: texture.height, surfaces };
}

export function decodeSurface(surface: GX2Surface, texData: ArrayBufferSlice, mipLevel: number): Promise<DecodedSurface> {
    return deswizzler.deswizzle(surface, texData.castToBuffer(), mipLevel);
}

export function decodeTexture(surface: GX2Surface, texData: ArrayBufferSlice, mipData: ArrayBufferSlice): Promise<DecodedTexture> {
    let surfacePromises: Promise<DecodedSurface>[] = [];

    for (let i = 0; i < surface.numMips; i++) {
        let levelData;
        if (i === 0) {
            levelData = texData;
        } else if (i === 1) {
            levelData = mipData;
        } else {
            const offset = surface.mipDataOffsets[i - 1];
            levelData = mipData.slice(offset);
        }
        surfacePromises.push(decodeSurface(surface, levelData, i));
    }

    const width = surface.width;
    const height = surface.height;

    return Promise.all(surfacePromises).then((surfaces: DecodedSurface[]): DecodedTexture => {
        surfaces = surfaces.filter((surface) => surface.width > 0 && surface.height > 0);
        switch (surface.format) {
        case GX2SurfaceFormat.BC1_UNORM:
            return { type: 'BC1', flag: 'UNORM', width, height, surfaces };
        case GX2SurfaceFormat.BC1_SRGB:
            return { type: 'BC1', flag: 'SRGB', width, height, surfaces };
        case GX2SurfaceFormat.BC3_UNORM:
            return { type: 'BC3', flag: 'UNORM', width, height, surfaces };
        case GX2SurfaceFormat.BC3_SRGB:
            return { type: 'BC3', flag: 'SRGB', width, height, surfaces };
        case GX2SurfaceFormat.BC4_UNORM:
            return { type: 'BC4', flag: 'UNORM', width, height, surfaces };
        case GX2SurfaceFormat.BC4_SNORM:
            return { type: 'BC4', flag: 'SNORM', width, height, surfaces };
        case GX2SurfaceFormat.BC5_UNORM:
            return { type: 'BC5', flag: 'UNORM', width, height, surfaces };
        case GX2SurfaceFormat.BC5_SNORM:
            return { type: 'BC5', flag: 'SNORM', width, height, surfaces };
        case GX2SurfaceFormat.TCS_R8_G8_B8_A8_UNORM:
            return { type: 'RGBA', flag: 'UNORM', bytesPerPixel: 4, width, height, surfaces };
        case GX2SurfaceFormat.TCS_R8_G8_B8_A8_SRGB:
            return { type: 'RGBA', flag: 'SRGB', bytesPerPixel: 4, width, height, surfaces };
        default:
            throw new Error(`Bad format in decodeSurface: ${surface.format.toString(16)}`);
        }
    });
}

export function surfaceToCanvas(canvas: HTMLCanvasElement, texture: DecodedTextureSW, surface: DecodedSurface) {
    canvas.width = surface.width;
    canvas.height = surface.height;
    const ctx = canvas.getContext('2d');
    const width = surface.width;
    const height = surface.height;
    const imageData = new ImageData(width, height);

    switch (texture.type) {
    case 'RGBA':
        if (texture.flag === 'UNORM') {
            const src = new Uint8Array(surface.pixels);
            imageData.data.set(src);
        } else if (texture.flag === 'SRGB') {
            // XXX(jstpierre): SRGB
            const src = new Uint8Array(surface.pixels);
            imageData.data.set(src);
        } else if (texture.flag === 'SNORM') {
            const src = new Int8Array(surface.pixels);
            const data = new Uint8Array(surface.pixels.byteLength);
            for (let i = 0; i < src.length; i++) {
                data[i] = src[i] + 128;
            }
            imageData.data.set(data);
        }
        break;
    }
    ctx.putImageData(imageData, 0, 0);
}

export function decompressTexture(texture: DecodedTexture): DecodedTextureSW {
    switch(texture.type) {
    case 'RGBA':
        return texture;
    case 'BC1':
    case 'BC3':
    case 'BC4':
    case 'BC5':
        return decompressBC(texture);
    }
}
// #endregion
