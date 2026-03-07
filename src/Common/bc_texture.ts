
interface DecodedSurfaceBase {
    width: number;
    height: number;
    depth: number;
}

interface DecodedSurfaceUN {
    pixels: Uint8Array<ArrayBuffer>;
}

interface DecodedSurfaceSN {
    flag: 'SNORM';
    pixels: Int8Array<ArrayBuffer>;
}

interface DecodedSurfaceRGBAUN extends DecodedSurfaceBase, DecodedSurfaceUN {
    type: 'RGBA';
    flag: 'UNORM' | 'SRGB';
}

interface DecodedSurfaceRGBASN extends DecodedSurfaceBase, DecodedSurfaceSN {
    type: 'RGBA';
}

interface DecodedSurfaceBC123UN extends DecodedSurfaceBase, DecodedSurfaceUN {
    type: 'BC1' | 'BC2' | 'BC3';
    flag: 'UNORM' | 'SRGB';
}

interface DecodedSurfaceBC45UN extends DecodedSurfaceBase, DecodedSurfaceUN {
    type: 'BC4' | 'BC5';
    flag: 'UNORM';
}

interface DecodedSurfaceBC45SN extends DecodedSurfaceBase, DecodedSurfaceSN {
    type: 'BC4' | 'BC5';
}

interface DecodedSurfaceBC6HUN extends DecodedSurfaceBase, DecodedSurfaceUN {
    type: 'BC6H';
    flag: 'UNORM';
}

type DecodedSurfaceRGBA = DecodedSurfaceRGBAUN | DecodedSurfaceRGBASN;
type DecodedSurfaceBC45 = DecodedSurfaceBC45UN | DecodedSurfaceBC45SN;

export type DecodedSurfaceBC = DecodedSurfaceBC123UN | DecodedSurfaceBC45 | DecodedSurfaceBC6HUN;
export type DecodedSurfaceSW = DecodedSurfaceRGBA;
export type DecodedSurface = DecodedSurfaceBC123UN | DecodedSurfaceBC45UN | DecodedSurfaceBC45SN | DecodedSurfaceBC6HUN | DecodedSurfaceRGBAUN | DecodedSurfaceRGBASN;

// #region Texture Decode
function expand4to8(n: number): number {
    return (n << (8 - 4)) | (n >>> (8 - 8));
}

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

function colorTableBC1(colorTable: Uint8Array, color1: number, color2: number): void {
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
}

// Software decompresses from standard BC1 (DXT1) to RGBA.
function decompressBC1Surface(surface: DecodedSurfaceBC123UN): DecodedSurfaceRGBAUN {
    const bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;
    const depth = surface.depth;
    const dst = new Uint8Array(width * height * depth * bytesPerPixel);
    const view = new DataView(surface.pixels.buffer, surface.pixels.byteOffset, surface.pixels.byteLength);
    const colorTable = new Uint8Array(16);

    let srcOffs = 0;
    const tall = height * depth;
    for (let yy = 0; yy < tall; yy += 4) {
        for (let xx = 0; xx < width; xx += 4) {
            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);
            colorTableBC1(colorTable, color1, color2);

            let colorBits = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                if (yy + y >= height)
                    continue;

                for (let x = 0; x < 4; x++) {
                    if (xx + x >= width)
                        continue;

                    const dstPx = (yy + y) * width + xx + x;
                    const dstOffs = dstPx * 4;
                    const colorIdx = colorBits & 0x03;
                    dst[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                    dst[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                    dst[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                    dst[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                    colorBits >>= 2;
                }
            }

            srcOffs += 0x08;
        }
    }

    const pixels = dst;
    return { type: 'RGBA', flag: surface.flag, width, height, depth, pixels };
}

// Software decompresses from standard BC2 (DXT3) to RGBA.
function decompressBC2Surface(surface: DecodedSurfaceBC123UN): DecodedSurfaceRGBAUN {
    const bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;
    const depth = surface.depth;
    const dst = new Uint8Array(width * height * depth * bytesPerPixel);
    const view = new DataView(surface.pixels.buffer, surface.pixels.byteOffset, surface.pixels.byteLength);
    const colorTable = new Uint8Array(16);

    let srcOffs = 0;
    const tall = height * depth;
    for (let yy = 0; yy < tall; yy += 4) {
        for (let xx = 0; xx < width; xx += 4) {
            const alphaBits0 = view.getUint32(srcOffs + 0x00, true);
            const alphaBits1 = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstIdx = ((yy + y) * width) + xx + x;
                    const dstOffs = (dstIdx * bytesPerPixel);
                    const fullShift = (y * 4 + x) * 4;
                    const alphaBits = fullShift < 32 ? alphaBits0 : alphaBits1;
                    const shift = fullShift % 32;
                    const alpha = (alphaBits >>> shift) & 0x0F;
                    dst[dstOffs + 3] = expand4to8(alpha);
                }
            }

            srcOffs += 0x08;

            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);
            colorTableBC1(colorTable, color1, color2);

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

    const pixels = dst;
    return { type: 'RGBA', flag: surface.flag, width, height, depth, pixels };
}

// Software decompresses from standard BC3 (DXT5) to RGBA.
function decompressBC3Surface(surface: DecodedSurfaceBC123UN): DecodedSurfaceRGBAUN {
    const bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;
    const depth = surface.depth;
    const dst = new Uint8Array(width * height * depth * bytesPerPixel);
    const view = new DataView(surface.pixels.buffer, surface.pixels.byteOffset, surface.pixels.byteLength);
    const colorTable = new Uint8Array(16);
    const alphaTable = new Uint8Array(8);

    let srcOffs = 0;
    const tall = height * depth;
    for (let yy = 0; yy < tall; yy += 4) {
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
            colorTableBC1(colorTable, color1, color2);

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

    const pixels = dst;
    return { type: 'RGBA', flag: surface.flag, width, height, depth, pixels };
}

// Software decompresses from standard BC4/BC5 to RGBA.
function decompressBC45Surface(surface: DecodedSurfaceBC45): DecodedSurfaceRGBA {
    const bytesPerPixel = 4;
    const width = surface.width;
    const height = surface.height;
    const depth = surface.depth;

    const signed = surface.flag === 'SNORM';
    const view = new DataView(surface.pixels.buffer, surface.pixels.byteOffset, surface.pixels.byteLength);
    let dst;
    let colorTable;

    let srcBytesPerPixel;
    if (surface.type === 'BC4')
        srcBytesPerPixel = 1;
    else
        srcBytesPerPixel = 2;

    if (signed) {
        dst = new Int8Array(width * height * depth * bytesPerPixel);
        colorTable = new Int8Array(8);
    } else {
        dst = new Uint8Array(width * height * depth * bytesPerPixel);
        colorTable = new Uint8Array(8);
    }

    let srcOffs = 0;
    const tall = height * depth;
    for (let yy = 0; yy < tall; yy += 4) {
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
                    colorTable[6] = signed ? -128 : 0;
                    colorTable[7] = signed ? 127 : 255;
                }

                const colorBits0 = view.getUint32(srcOffs + 0x02, true) & 0x00FFFFFF;
                const colorBits1 = view.getUint32(srcOffs + 0x04, true) >>> 8;
                for (let y = 0; y < 4; y++) {
                    for (let x = 0; x < 4; x++) {
                        const dstIdx = ((yy + y) * width) + xx + x;
                        const dstOffs = (dstIdx * bytesPerPixel);
                        const fullShift = (y * 4 + x) * 3;
                        const colorBits = fullShift < 24 ? colorBits0 : colorBits1;
                        const shift = fullShift % 24;
                        const index = (colorBits >>> shift) & 0x07;
                        if (srcBytesPerPixel === 1) {
                            dst[dstOffs + 0] = colorTable[index];
                            dst[dstOffs + 1] = colorTable[index];
                            dst[dstOffs + 2] = colorTable[index];
                            dst[dstOffs + 3] = colorTable[index];
                        } else {
                            if (ch === 0) {
                                dst[dstOffs + 0] = colorTable[index];
                            } else if (ch === 1) {
                                dst[dstOffs + 1] = colorTable[index];
                                dst[dstOffs + 2] = signed ? 127 : 255;
                                dst[dstOffs + 3] = signed ? 127 : 255;
                            }
                        }
                    }
                }

                srcOffs += 0x08;
            }
        }
    }

    if (surface.flag === 'SNORM') {
        const pixels = dst as Int8Array<ArrayBuffer>;
        return { type: 'RGBA', flag: surface.flag, width, height, depth, pixels };
    } else {
        const pixels = dst as Uint8Array<ArrayBuffer>;
        return { type: 'RGBA', flag: surface.flag, width, height, depth, pixels };
    }
}

// Software decompresses from standard BC6H to RGBA.
function decompressBC6HSurface(surface: any): DecodedSurfaceRGBAUN {
    // TypeScript adaptation of https://github.com/hglm/detex/blob/master/decompress-bptc-float.c

    const detex_bptc_table_P2 = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1,
        0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
        0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1,
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1,
        0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1,
        0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1,
        0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1,
        0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0,
        0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0,
        0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1,
        0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0,
        0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0,
        0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0,
        0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0,
        0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0,
        0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
        0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1,
        0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0,
        0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0,
        0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0,
        0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0,
        0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1,
        0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1,
        0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0,
        0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0,
        0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0,
        0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
        0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1,
        0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1,
        0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0,
        0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0,
        0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1,
        0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1,
        0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0,
        0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0,
        0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1,
        0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1,
        0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1,
        0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1];
    const detex_bptc_table_anchor_index_second_subset = [15, 15, 15, 15, 15, 15, 15, 15,
        15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15,
        2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15,
        2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2,
        15, 15, 15, 15, 15, 2, 2, 15];

    function decompressBC6HBlock(data0: bigint, data1: bigint): Uint8Array {
        function getBits64(data: bigint, start: number, end: number): number {
            const len = BigInt(end - start + 1);
            const mask = (1n << len) - 1n;
            return Number((data >> BigInt(start)) & mask);
        }
        function getBits64Reversed(data: bigint, start: number, end: number): number {
            let val = 0n;
            for (let i = 0n; i <= start - end; i++) {
                let shift_right = BigInt(start) - 2n * i;
                if (shift_right >= 0)
                    val |= (data & (1n << (BigInt(start) - i))) >> shift_right;
                else
                    val |= (data & (1n << (BigInt(start) - i))) << (-shift_right);
            }
            return Number(val);
        }
        function signExtend(value: number, srcBits: number): number {
            const signBit = 1 << (srcBits - 1);
            if ((value & signBit) === 0) return value;
            return value | (~0 << srcBits);
        }
        function unquantize(x: number, mode: number): number {
            if (mode === 13) return x;
            if (x === 0) return 0;
            const maxVal = (1 << bptc_float_EPB[mode]) - 1;
            if (x === maxVal) return 0xFFFF;
            return ((x << 15) + 0x4000) >> (bptc_float_EPB[mode] - 1);
        }
        function interpolate(e0: number, e1: number, index: number, prec: number): number {
            const aWeight2 = [0, 21, 43, 64];
            const aWeight3 = [0, 9, 18, 27, 37, 46, 55, 64];
            const aWeight4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
            let weight = 0;
            if (prec === 2) weight = aWeight2[index];
            else if (prec === 3) weight = aWeight3[index];
            else weight = aWeight4[index];
            return ((64 - weight) * e0 + weight * e1 + 32) >> 6;
        }
        const map_mode_table = [0, 1, 2, 10, -1, -1, 3, 11, -1, -1, 4, 12, -1, -1, 5, 13, -1, -1, 6, -1, -1, -1, 7, -1, -1, -1, 8, -1, -1, -1, 9, -1];
        const bptc_float_EPB = [10, 7, 11, 11, 11, 9, 8, 8, 8, 6, 10, 11, 12, 16];
        let modeRaw = Number(data0 & 3n);
        let mode = modeRaw < 2 ? modeRaw : map_mode_table[modeRaw | (getBits64(data0, 2, 4) << 2)];
        let r = new Int32Array(4), g = new Int32Array(4), b = new Int32Array(4);
        let partitionId = 0, deltaR = 0, deltaG = 0, deltaB = 0, indexStartBit = 0;

        switch (mode) {
            case 0:
                g[2] = getBits64(data0, 2, 2) << 4;
                b[2] = getBits64(data0, 3, 3) << 4;
                b[3] = getBits64(data0, 4, 4) << 4;
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 39);
                g[3] = getBits64(data0, 40, 40) << 4;
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 49);
                b[3] |= getBits64(data0, 50, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 59);
                b[3] |= getBits64(data0, 60, 60) << 1;
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 5);
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 11);
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaG = deltaB = 5;
                break;
            case 1:
                g[2] = getBits64(data0, 2, 2) << 5;
                g[3] = getBits64(data0, 3, 3) << 4;
                g[3] |= getBits64(data0, 4, 4) << 5;
                r[0] = getBits64(data0, 5, 11);
                b[3] = getBits64(data0, 12, 12);
                b[3] |= getBits64(data0, 13, 13) << 1;
                b[2] = getBits64(data0, 14, 14) << 4;
                g[0] = getBits64(data0, 15, 21);
                b[2] |= getBits64(data0, 22, 22) << 5;
                b[3] |= getBits64(data0, 23, 23) << 2;
                g[2] |= getBits64(data0, 24, 24) << 4;
                b[0] = getBits64(data0, 25, 31);
                b[3] |= getBits64(data0, 32, 32) << 3;
                b[3] |= getBits64(data0, 33, 33) << 5;
                b[3] |= getBits64(data0, 34, 34) << 4;
                r[1] = getBits64(data0, 35, 40);
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 60);
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 6);
                r[3] = getBits64(data1, 7, 12);
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaG = deltaB = 6;
                break;
            case 2:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 39);
                r[0] |= getBits64(data0, 40, 40) << 10;
                g[2] = getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 48);
                g[0] |= getBits64(data0, 49, 49) << 10;
                b[3] = getBits64(data0, 50, 50);
                g[3] = getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 58);
                b[0] |= getBits64(data0, 59, 59) << 10;
                b[3] |= getBits64(data0, 60, 60) << 1;
                b[2] = getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 5);
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 11);
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = 5;
                deltaG = deltaB = 4;
                break;
            case 3:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 38);
                r[0] |= getBits64(data0, 39, 39) << 10;
                g[3] = getBits64(data0, 40, 40) << 4;
                g[2] = getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 49);
                g[0] |= getBits64(data0, 50, 50) << 10;
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 58);
                b[0] |= getBits64(data0, 59, 59) << 10;
                b[3] = getBits64(data0, 60, 60) << 1;
                b[2] = getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 4);
                b[3] |= getBits64(data1, 5, 5);
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 10);
                g[2] |= getBits64(data1, 11, 11) << 4;
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaB = 4;
                deltaG = 5;
                break;
            case 4:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 38);
                r[0] |= getBits64(data0, 39, 39) << 10;
                b[2] = getBits64(data0, 40, 40) << 4;
                g[2] = getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 48);
                g[0] |= getBits64(data0, 49, 49) << 10;
                b[3] = getBits64(data0, 50, 50);
                g[3] = getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 59);
                b[0] |= getBits64(data0, 60, 60) << 10;
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 4);
                b[3] |= getBits64(data1, 5, 5) << 1;
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 10);
                b[3] |= getBits64(data1, 11, 11) << 4;
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaG = 4;
                deltaB = 5;
                break;
            case 5:
                r[0] = getBits64(data0, 5, 13);
                b[2] = getBits64(data0, 14, 14) << 4;
                g[0] = getBits64(data0, 15, 23);
                g[2] = getBits64(data0, 24, 24) << 4;
                b[0] = getBits64(data0, 25, 33);
                b[3] = getBits64(data0, 34, 34) << 4;
                r[1] = getBits64(data0, 35, 39);
                g[3] = getBits64(data0, 40, 40) << 4;
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 49);
                b[3] |= getBits64(data0, 50, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 59);
                b[3] |= getBits64(data0, 60, 60) << 1;
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 5);
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 11);
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaG = deltaB = 5;
                break;
            case 6:
                r[0] = getBits64(data0, 5, 12);
                g[3] = getBits64(data0, 13, 13) << 4;
                b[2] = getBits64(data0, 14, 14) << 4;
                g[0] = getBits64(data0, 15, 22);
                b[3] = getBits64(data0, 23, 23) << 2;
                g[2] = getBits64(data0, 24, 24) << 4;
                b[0] = getBits64(data0, 25, 32);
                b[3] |= getBits64(data0, 33, 33) << 3;
                b[3] |= getBits64(data0, 34, 34) << 4;
                r[1] = getBits64(data0, 35, 40);
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 49);
                b[3] |= getBits64(data0, 50, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 59);
                b[3] |= getBits64(data0, 60, 60) << 1;
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 6);
                r[3] = getBits64(data1, 7, 12);
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = 6;
                deltaG = deltaB = 5;
                break;
            case 7:
                r[0] = getBits64(data0, 5, 12);
                b[3] = getBits64(data0, 13, 13);
                b[2] = getBits64(data0, 14, 14) << 4;
                g[0] = getBits64(data0, 15, 22);
                g[2] = getBits64(data0, 23, 23) << 5;
                g[2] |= getBits64(data0, 24, 24) << 4;
                b[0] = getBits64(data0, 25, 32);
                g[3] = getBits64(data0, 33, 33) << 5;
                b[3] |= getBits64(data0, 34, 34) << 4;
                r[1] = getBits64(data0, 35, 39);
                g[3] |= getBits64(data0, 40, 40) << 4;
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 59);
                b[3] |= getBits64(data0, 60, 60) << 1;
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 5);
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 11);
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaB = 5;
                deltaG = 6;
                break;
            case 8:
                r[0] = getBits64(data0, 5, 12);
                b[3] = getBits64(data0, 13, 13) << 1;
                b[2] = getBits64(data0, 14, 14) << 4;
                g[0] = getBits64(data0, 15, 22);
                b[2] |= getBits64(data0, 23, 23) << 5;
                g[2] = getBits64(data0, 24, 24) << 4;
                b[0] = getBits64(data0, 25, 32);
                b[3] |= getBits64(data0, 33, 33) << 5;
                b[3] |= getBits64(data0, 34, 34) << 4;
                r[1] = getBits64(data0, 35, 39);
                g[3] = getBits64(data0, 40, 40) << 4;
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 49);
                b[3] |= getBits64(data0, 50, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 60);
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 5);
                b[3] |= getBits64(data1, 6, 6) << 2;
                r[3] = getBits64(data1, 7, 11);
                b[3] |= getBits64(data1, 12, 12) << 3;
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                deltaR = deltaG = 5;
                deltaB = 6;
                break;
            case 9:
                r[0] = getBits64(data0, 5, 10);
                g[3] = getBits64(data0, 11, 11) << 4;
                b[3] = getBits64(data0, 12, 13);
                b[2] = getBits64(data0, 14, 14) << 4;
                g[0] = getBits64(data0, 15, 20);
                g[2] = getBits64(data0, 21, 21) << 5;
                b[2] |= getBits64(data0, 22, 22) << 5;
                b[3] |= getBits64(data0, 23, 23) << 2;
                g[2] |= getBits64(data0, 24, 24) << 4;
                b[0] = getBits64(data0, 25, 30);
                g[3] |= getBits64(data0, 31, 31) << 5;
                b[3] |= getBits64(data0, 32, 32) << 3;
                b[3] |= getBits64(data0, 33, 33) << 5;
                b[3] |= getBits64(data0, 34, 34) << 4;
                r[1] = getBits64(data0, 35, 40);
                g[2] |= getBits64(data0, 41, 44);
                g[1] = getBits64(data0, 45, 50);
                g[3] |= getBits64(data0, 51, 54);
                b[1] = getBits64(data0, 55, 60);
                b[2] |= getBits64(data0, 61, 63);
                b[2] |= getBits64(data1, 0, 0) << 3;
                r[2] = getBits64(data1, 1, 6);
                r[3] = getBits64(data1, 7, 12);
                partitionId = getBits64(data1, 13, 17);
                indexStartBit = 64 + 18;
                break;
            case 10:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 44);
                g[1] = getBits64(data0, 45, 54);
                b[1] = getBits64(data0, 55, 63);
                b[1] |= getBits64(data1, 0, 0) << 9;
                partitionId = 0;
                indexStartBit = 65;
                break;
            case 11:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 43);
                r[0] |= getBits64(data0, 44, 44) << 10;
                g[1] = getBits64(data0, 45, 53);
                g[0] |= getBits64(data0, 54, 54) << 10;
                b[1] = getBits64(data0, 55, 63);
                b[0] |= getBits64(data1, 0, 0) << 10;
                partitionId = 0;
                indexStartBit = 65;
                deltaR = deltaG = deltaB = 9;
                break;
            case 12:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 42);
                r[0] |= getBits64Reversed(data0, 44, 43) << 10;
                g[1] = getBits64(data0, 45, 52);
                g[0] |= getBits64Reversed(data0, 54, 53) << 10;
                b[1] = getBits64(data0, 55, 62);
                b[0] |= getBits64(data0, 63, 63) << 11;
                b[0] |= getBits64(data1, 0, 0) << 10;
                partitionId = 0;
                indexStartBit = 65;
                deltaR = deltaG = deltaB = 8;
                break;
            case 13:
                r[0] = getBits64(data0, 5, 14);
                g[0] = getBits64(data0, 15, 24);
                b[0] = getBits64(data0, 25, 34);
                r[1] = getBits64(data0, 35, 38);
                r[0] |= getBits64Reversed(data0, 44, 39) << 10;
                g[1] = getBits64(data0, 45, 48);
                g[0] |= getBits64Reversed(data0, 54, 49) << 10;
                b[1] = getBits64(data0, 55, 58);
                b[0] |= getBits64Reversed(data0, 63, 59) << 11;
                b[0] |= getBits64(data1, 0, 0) << 10;
                partitionId = 0;
                indexStartBit = 65;
                deltaR = deltaG = deltaB = 4;
                break;
        }

        const numSubsets = mode >= 10 ? 1 : 2;

        if (mode !== 9 && mode !== 10) {
            const epb = bptc_float_EPB[mode];
            const mask = (1 << epb) - 1;
            for (let i = 1; i < numSubsets * 2; i++) {
                r[i] = (r[0] + signExtend(r[i], deltaR)) & mask;
                g[i] = (g[0] + signExtend(g[i], deltaG)) & mask;
                b[i] = (b[0] + signExtend(b[i], deltaB)) & mask;
            }
        }

        for (let i = 0; i < numSubsets * 2; i++) {
            r[i] = unquantize(r[i], mode);
            g[i] = unquantize(g[i], mode);
            b[i] = unquantize(b[i], mode);
        }

        const pixels = new Uint8Array(16 * 4);
        const indexPrec = (data0 & 3n) === 3n ? 4 : 3;
        let bitStream = data1 >> BigInt(indexStartBit - 64);
        const anchorSecond = detex_bptc_table_anchor_index_second_subset[partitionId];

        for (let i = 0; i < 16; i++) {
            const subset = numSubsets === 1 ? 0 : detex_bptc_table_P2[partitionId * 16 + i];
            const isAnchor = (subset === 0 && i === 0) || (subset === 1 && i === anchorSecond);
            const bitCount = isAnchor ? indexPrec - 1 : indexPrec;
            const pixelIndex = Number(bitStream & BigInt((1 << bitCount) - 1));
            bitStream >>= BigInt(bitCount);
            const resR = interpolate(r[subset * 2], r[subset * 2 + 1], pixelIndex, indexPrec);
            const resG = interpolate(g[subset * 2], g[subset * 2 + 1], pixelIndex, indexPrec);
            const resB = interpolate(b[subset * 2], b[subset * 2 + 1], pixelIndex, indexPrec);
            pixels[i * 4 + 0] = Math.max(0, Math.min(255, (resR >> 8)));
            pixels[i * 4 + 1] = Math.max(0, Math.min(255, (resG >> 8)));
            pixels[i * 4 + 2] = Math.max(0, Math.min(255, (resB >> 8)));
            pixels[i * 4 + 3] = 255;
        }
        return pixels;
    }

    const width = surface.width;
    const height = surface.height;
    const bytesPerPixel = 4;
    const pixels = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(surface.pixels.buffer, surface.pixels.byteOffset, surface.pixels.byteLength);

    let offset = 0;
    for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 4) {
            const data0 = view.getBigUint64(offset, true);
            const data1 = view.getBigUint64(offset + 8, true);
            offset += 16;
            const decodedPixels = decompressBC6HBlock(data0, data1);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const py = blockY + y;
                    const px = blockX + x;
                    if (px < width && py < height) {
                        const dstIdx = (py * width + px) * bytesPerPixel;
                        const srcIdx = (y * 4 + x) * 4;
                        pixels[dstIdx] = decodedPixels[srcIdx];
                        pixels[dstIdx + 1] = decodedPixels[srcIdx + 1];
                        pixels[dstIdx + 2] = decodedPixels[srcIdx + 2];
                        pixels[dstIdx + 3] = decodedPixels[srcIdx + 3];
                    }
                }
            }
        }
    }

    return { type: 'RGBA', flag: surface.flag, width, height, depth: surface.depth, pixels };
}

export function decompressBC(surface: DecodedSurfaceBC): DecodedSurfaceSW {
    switch (surface.type) {
    case 'BC1':
        return decompressBC1Surface(surface);
    case 'BC2':
        return decompressBC2Surface(surface);
    case 'BC3':
        return decompressBC3Surface(surface);
    case 'BC4':
    case 'BC5':
        return decompressBC45Surface(surface);
    case 'BC6H':
        return decompressBC6HSurface(surface);
    }
}
