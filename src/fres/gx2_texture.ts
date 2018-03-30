
import { GX2SurfaceFormat, GX2TileMode, GX2AAMode } from './gx2_enum';
import { GX2Surface } from './gx2_surface';
import { deswizzler } from './gx2_swizzle';
import ArrayBufferSlice from 'ArrayBufferSlice';

interface DecodedTextureR {
    type: 'R';
    flag: 'UNORM' | 'SNORM';
    bytesPerPixel: 1;
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureRG {
    type: 'RG';
    flag: 'UNORM' | 'SNORM';
    bytesPerPixel: 2;
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureRGBA {
    type: 'RGBA';
    flag: 'UNORM' | 'SRGB';
    bytesPerPixel: 4;
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureBC13 {
    type: 'BC1' | 'BC3';
    flag: 'UNORM' | 'SRGB';
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureBC45 {
    type: 'BC4' | 'BC5';
    flag: 'UNORM' | 'SNORM';
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

export type DecodedTextureBC = DecodedTextureBC13 | DecodedTextureBC45;
export type DecodedTexture = DecodedTextureR | DecodedTextureRG | DecodedTextureRGBA | DecodedTextureBC;

export function parseGX2Surface(buffer: ArrayBufferSlice, gx2SurfaceOffs: number): GX2Surface {
    const view = buffer.slice(gx2SurfaceOffs, gx2SurfaceOffs + 0x9C).createDataView();

    const dimension = view.getUint32(0x00, false);
    const width = view.getUint32(0x04, false);
    const height = view.getUint32(0x08, false);
    const depth = view.getUint32(0x0C, false);
    const numMips = view.getUint32(0x10, false);
    const format = view.getUint32(0x14, false);
    const aaMode = view.getUint32(0x18, false);

    const texDataSize = view.getUint32(0x20, false);
    const mipDataSize = view.getUint32(0x28, false);
    const tileMode = view.getUint32(0x30, false);
    const swizzle = view.getUint32(0x34, false);
    const align = view.getUint32(0x38, false);
    const pitch = view.getUint32(0x3C, false);

    let mipDataOffsetTableIdx = 0x40;
    const mipDataOffsets = [];
    for (let i = 0; i < 13; i++) {
        mipDataOffsets.push(view.getUint32(mipDataOffsetTableIdx, false));
        mipDataOffsetTableIdx += 0x04;
    }

    const surface = { format, tileMode, swizzle, width, height, depth, pitch, aaMode, texDataSize, mipDataSize };
    return surface;
}

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
function decompressBC1(texture: DecodedTextureBC13): DecodedTextureRGBA {
    const type = 'RGBA';
    const bytesPerPixel = 4;
    const flag = texture.flag;
    const width = texture.width;
    const height = texture.height;
    const dst = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(texture.pixels);
    const colorTable = new Uint8Array(16);

    let srcOffs = 0;
    for (let yy = 0; yy < texture.height; yy += 4) {
        for (let xx = 0; xx < texture.width; xx += 4) {
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
                    const dstPx = (yy + y) * texture.width + xx + x;
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
    return { type, bytesPerPixel, flag, width, height, pixels };
}

// Software decompresses from standard BC3 (DXT5) to RGBA.
function decompressBC3(texture: DecodedTextureBC13): DecodedTextureRGBA {
    const type = 'RGBA';
    const bytesPerPixel = 4;
    const flag = texture.flag;
    const width = texture.width;
    const height = texture.height;
    const dst = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(texture.pixels);
    const colorTable = new Uint8Array(16);
    const alphaTable = new Uint8Array(8);

    let srcOffs = 0;
    for (let yy = 0; yy < texture.height; yy += 4) {
        for (let xx = 0; xx < texture.width; xx += 4) {

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
                    const dstIdx = (yy + y) * texture.width + xx + x;
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
    return { type, bytesPerPixel, flag, width, height, pixels };
}

// Software decompresses from standard BC4/BC5 to R/RG.
function decompressBC45(texture: DecodedTextureBC45): DecodedTexture {
    let bytesPerPixel, type;
    switch (texture.type) {
    case 'BC4':
        type = 'R';
        bytesPerPixel = 1;
        break;
    case 'BC5':
        type = 'RG';
        bytesPerPixel = 2;
        break;
    }

    const signed = texture.flag === 'SNORM';
    const flag = texture.flag;
    const width = texture.width;
    const height = texture.height;
    const view = new DataView(texture.pixels);
    let dst;
    let colorTable;

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
            for (let ch = 0; ch < bytesPerPixel; ch++) {
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
                        dst[dstOffs] = colorTable[index];
                    }
                }

                srcOffs += 0x08;
            }
        }
    }

    const pixels = dst.buffer;
    return { type, flag, bytesPerPixel, width, height, pixels };
}

export function decompressBC(texture: DecodedTextureBC): DecodedTexture {
    switch (texture.type) {
    case 'BC1':
        return decompressBC1(texture);
    case 'BC3':
        return decompressBC3(texture);
    case 'BC4':
    case 'BC5':
        return decompressBC45(texture);
    }
}

export function decodeSurface(surface: GX2Surface, texData: ArrayBufferSlice, mipData: ArrayBufferSlice): Promise<DecodedTexture> {
    const width = surface.width;
    const height = surface.height;

    return deswizzler.deswizzle(surface, texData.castToBuffer()).then((pixels): DecodedTexture => {
        switch (surface.format) {
        case GX2SurfaceFormat.BC1_UNORM:
            return { type: 'BC1', flag: 'UNORM', width, height, pixels };
        case GX2SurfaceFormat.BC1_SRGB:
            return { type: 'BC1', flag: 'SRGB', width, height, pixels };
        case GX2SurfaceFormat.BC3_UNORM:
            return { type: 'BC3', flag: 'UNORM', width, height, pixels };
        case GX2SurfaceFormat.BC3_SRGB:
            return { type: 'BC3', flag: 'SRGB', width, height, pixels };
        case GX2SurfaceFormat.BC4_UNORM:
            return { type: 'BC4', flag: 'UNORM', width, height, pixels };
        case GX2SurfaceFormat.BC4_SNORM:
            return { type: 'BC4', flag: 'SNORM', width, height, pixels };
        case GX2SurfaceFormat.BC5_UNORM:
            return { type: 'BC5', flag: 'UNORM', width, height, pixels };
        case GX2SurfaceFormat.BC5_SNORM:
            return { type: 'BC5', flag: 'SNORM', width, height, pixels };
        case GX2SurfaceFormat.TCS_R8_G8_B8_A8_UNORM:
            return { type: 'RGBA', flag: 'UNORM', bytesPerPixel: 4, width, height, pixels };
        case GX2SurfaceFormat.TCS_R8_G8_B8_A8_SRGB:
            return { type: 'RGBA', flag: 'SRGB', bytesPerPixel: 4, width, height, pixels };
        default:
            throw new Error(`Bad format in decodeSurface: ${surface.format.toString(16)}`);
        }
    });
}

export function textureToCanvas(canvas: HTMLCanvasElement, texture: DecodedTexture) {
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(texture.width, texture.height);

    // Decompress BC if we have it.
    switch (texture.type) {
    case 'BC1':
    case 'BC3':
    case 'BC4':
    case 'BC5':
        texture = decompressBC(texture);
        break;
    }

    switch (texture.type) {
    case 'R':
        if (texture.flag === 'UNORM') {
            const src = new Uint8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i];
                imageData.data[i * 4 + 1] = src[i];
                imageData.data[i * 4 + 2] = src[i];
                imageData.data[i * 4 + 3] = 0xFF;
            }
        } else {
            const src = new Int8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i] + 128;
                imageData.data[i * 4 + 1] = src[i] + 128;
                imageData.data[i * 4 + 2] = src[i] + 128;
                imageData.data[i * 4 + 3] = 0xFF;
            }
        }
        break;
    case 'RG': {
        if (texture.flag === 'UNORM') {
            const src = new Uint8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i * 2 + 0];
                imageData.data[i * 4 + 1] = src[i * 2 + 1];
                imageData.data[i * 4 + 2] = 0xFF;
                imageData.data[i * 4 + 3] = 0xFF;
            }
        } else {
            const src = new Int8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i * 2 + 0] + 128;
                imageData.data[i * 4 + 1] = src[i * 2 + 1] + 128;
                imageData.data[i * 4 + 2] = 0xFF;
                imageData.data[i * 4 + 3] = 0xFF;
            }
        }
        break;
    }
    case 'RGBA':
        const src = new Uint8Array(texture.pixels);
        imageData.data.set(src);
        break;
    default:
        throw new Error(`Unsupported texture type in textureToCanvas ${texture.type}`);
    }
    ctx.putImageData(imageData, 0, 0);
}
// #endregion
