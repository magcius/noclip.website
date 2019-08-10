
import ArrayBufferSlice from "../ArrayBufferSlice";
import { clamp } from "../MathHelpers";

export enum TextureFormat {
    RGB8,
    RGBA8,
    RGBA5551,
    RGB565,
    RGBA4444,
    LA8,
    HILO8,
    L8,
    A8,
    LA4,
    L4,
    A4,
    ETC1,
    ETC1A4,
}

export interface Texture {
    size: number;
    width: number;
    height: number;
    format: TextureFormat;
    pixels: Uint8Array;
    name: string;
}

export function computeTextureByteSize(format: TextureFormat, width: number, height: number): number {
    switch (format) {
    case TextureFormat.ETC1:
        return width * height / 2;
    case TextureFormat.ETC1A4:
        return width * height;
    case TextureFormat.RGBA4444:
    case TextureFormat.RGBA5551:
    case TextureFormat.RGB565:
    case TextureFormat.LA8:
        return (width * height) * 2;
    case TextureFormat.A8:
    case TextureFormat.L8:
        return (width * height);
    case TextureFormat.L4:
        return (width * height) / 2;
    default:
        throw "whoops";
    }
}

function expand4to8(n: number) {
    return (n << 4) | n;
}

function expand5to8(n: number) {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function expand6to8(n: number) {
    return (n << (8 - 6)) | (n >>> (12 - 8));
}

function decodeTexture_ETC1_4x4_Color(dst: Uint8Array, w1: number, w2: number, dstOffs: number, stride: number): void {
    // w1 = Upper 32-bit word, "control" data
    // w2 = Lower 32-bit word, "pixel" data

    // Table 3.17.2 -- Intensity tables for each codeword.
    const intensityTableMap = [
        [   -8,  -2,  2,   8 ],
        [  -17,  -5,  5,  17 ],
        [  -29,  -9,  9,  29 ],
        [  -42, -13, 13,  42 ],
        [  -60, -18, 18,  60 ],
        [  -80, -24, 24,  80 ],
        [ -106, -33, 33, 106 ],
        [ -183, -47, 48, 183 ],
    ];

    // Table 3.17.3 -- MSB/LSB colors to modifiers.
    //
    //  msb lsb
    //  --- ---
    //   0  0   small positive value (2nd intensity)
    //   0  1   large positive value (3rd intensity)
    //   1  0   small negative value (1st intensity)
    //   1  1   large negative value (0th intensity)
    //
    // Why the spec doesn't lay out the intensity map in this order,
    // I'll never know...
    const pixelToColorIndex = [ 2, 3, 1, 0 ];

    const diff = (w1 & 0x02) !== 0;
    const flip = (w1 & 0x01) !== 0;

    // Intensity tables for each block.
    const intensityIndex1 = (w1 >> 5) & 0x7;
    const intensityIndex2 = (w1 >> 2) & 0x7;
    const intensityTable1 = intensityTableMap[intensityIndex1];
    const intensityTable2 = intensityTableMap[intensityIndex2];

    function signed3(n: number) {
        // Sign-extend.
        return n << 29 >> 29;
    }

    // Get the color table for a given block.
    function getColors(colors: Uint8Array, r: number, g: number, b: number, intensityMap: number[]): void {
        for (let i = 0; i < 4; i++) {
            colors[(i * 3) + 0] = clamp(r + intensityMap[i], 0, 255);
            colors[(i * 3) + 1] = clamp(g + intensityMap[i], 0, 255);
            colors[(i * 3) + 2] = clamp(b + intensityMap[i], 0, 255);
        }
    }

    const colors1 = new Uint8Array(3 * 4);
    const colors2 = new Uint8Array(3 * 4);

    if (diff) {
        const baseR1a = (w1 >>> 27) & 0x1F;
        const baseR2d = signed3((w1 >>> 24) & 0x07);
        const baseG1a = (w1 >>> 19) & 0x1F;
        const baseG2d = signed3((w1 >>> 16) & 0x07);
        const baseB1a = (w1 >>> 11) & 0x1F;
        const baseB2d = signed3((w1 >>>  8) & 0x07);

        const baseR1 = expand5to8(baseR1a);
        const baseR2 = expand5to8(baseR1a + baseR2d);
        const baseG1 = expand5to8(baseG1a);
        const baseG2 = expand5to8(baseG1a + baseG2d);
        const baseB1 = expand5to8(baseB1a);
        const baseB2 = expand5to8(baseB1a + baseB2d);

        getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
        getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
    } else {
        const baseR1 = expand4to8((w1 >>> 28) & 0x0F);
        const baseR2 = expand4to8((w1 >>> 24) & 0x0F);
        const baseG1 = expand4to8((w1 >>> 20) & 0x0F);
        const baseG2 = expand4to8((w1 >>> 16) & 0x0F);
        const baseB1 = expand4to8((w1 >>> 12) & 0x0F);
        const baseB2 = expand4to8((w1 >>>  8) & 0x0F);

        getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
        getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
    }

    // Go through each pixel and copy the color into the right spot...
    for (let i = 0; i < 16; i++) {
        const lsb = (w2 >>> i) & 0x01;
        const msb = (w2 >>> (16 + i)) & 0x01;
        const lookup = (msb << 1) | lsb;
        const colorsIndex = pixelToColorIndex[lookup];

        // Indexes march down and to the right here.
        const y = i & 0x03;
        const x = i >>> 2;
        const dstIndex = dstOffs + ((y * stride) + x) * 4;

        // Whether we're in block 1 or block 2;
        let whichBlock;

        // If flipbit=0, the block is divided into two 2x4
        // subblocks side-by-side.
        if (!flip)
            whichBlock = x & 2;
        else
            whichBlock = y & 2;

        const colors = whichBlock ? colors2 : colors1;
        dst[dstIndex + 0] = colors[(colorsIndex * 3) + 0];
        dst[dstIndex + 1] = colors[(colorsIndex * 3) + 1];
        dst[dstIndex + 2] = colors[(colorsIndex * 3) + 2];
    }
}

function decodeTexture_ETC1_4x4_Alpha(dst: Uint8Array, a1: number, a2: number, dstOffs: number, stride: number) {
    for (let ax = 0; ax < 2; ax++) {
        for (let ay = 0; ay < 4; ay++) {
            const dstIndex = dstOffs + ((ay * stride) + ax) * 4;
            dst[dstIndex + 3] = expand4to8(a2 & 0x0F);
            a2 >>= 4;
        }
    }

    for (let ax = 2; ax < 4; ax++) {
        for (let ay = 0; ay < 4; ay++) {
            const dstIndex = dstOffs + ((ay * stride) + ax) * 4;
            dst[dstIndex + 3] = expand4to8(a1 & 0x0F);
            a1 >>= 4;
        }
    }
}

function decodeTexture_ETC1(width: number, height: number, texData: ArrayBufferSlice, alpha: boolean) {
    const pixels = new Uint8Array(width * height * 4);
    const stride = width;

    const src = texData.createDataView();
    let offs = 0;
    for (let yy = 0; yy < height; yy += 8) {
        for (let xx = 0; xx < width; xx += 8) {
            // Order of each set of 4 blocks: top left, top right, bottom left, bottom right...
            for (let y = 0; y < 8; y += 4) {
                for (let x = 0; x < 8; x += 4) {
                    const dstOffs = ((yy + y) * stride + (xx + x)) * 4;

                    let a1;
                    let a2;
                    if (alpha) {
                        // In ETC1A4 mode, we have 8 bytes of per-pixel alpha data preceeding the tile.
                        a2 = src.getUint32(offs + 0x00, true);
                        a1 = src.getUint32(offs + 0x04, true);
                        offs += 0x08;
                    } else {
                        a2 = 0xFFFFFFFF;
                        a1 = 0xFFFFFFFF;
                    }
                    decodeTexture_ETC1_4x4_Alpha(pixels, a1, a2, dstOffs, stride);

                    const w2 = src.getUint32(offs + 0x00, true);
                    const w1 = src.getUint32(offs + 0x04, true);
                    decodeTexture_ETC1_4x4_Color(pixels, w1, w2, dstOffs, stride);
                    offs += 0x08;
                }
            }
        }
    }

    return pixels;
}

type PixelDecode = (pixels: Uint8Array, dstOffs: number) => void;

function decodeTexture_Tiled(width: number, height: number, decoder: PixelDecode) {
    const pixels = new Uint8Array(width * height * 4);
    const stride = width;

    function morton7(n: number) {
        // 0a0b0c => 000abc
        return ((n >>> 2) & 0x04) | ((n >>> 1) & 0x02) | (n & 0x01);
    }

    for (let yy = 0; yy < height; yy += 8) {
        for (let xx = 0; xx < width; xx += 8) {
            // Iterate in Morton order inside each tile.
            for (let i = 0; i < 0x40; i++) {
                const x = morton7(i);
                const y = morton7(i >>> 1);
                const dstOffs = ((yy + y) * stride + xx + x) * 4;
                decoder(pixels, dstOffs);
            }
        }
    }

    return pixels;
}

function decodeTexture_RGBA4444(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint16(srcOffs, true);
        pixels[dstOffs + 0] = expand4to8((p >>> 12) & 0x0F);
        pixels[dstOffs + 1] = expand4to8((p >>> 8) & 0x0F);
        pixels[dstOffs + 2] = expand4to8((p >>> 4) & 0x0F);
        pixels[dstOffs + 3] = expand4to8((p >>> 0) & 0x0F);
        srcOffs += 2;
    });
}

function decodeTexture_RGBA5551(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint16(srcOffs, true);
        pixels[dstOffs + 0] = expand5to8((p >>> 11) & 0x1F);
        pixels[dstOffs + 1] = expand5to8((p >>> 6) & 0x1F);
        pixels[dstOffs + 2] = expand5to8((p >>> 1) & 0x1F);
        pixels[dstOffs + 3] = (p & 0x01) ? 0xFF : 0x00;
        srcOffs += 2;
    });
}

function decodeTexture_RGB565(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint16(srcOffs, true);
        pixels[dstOffs + 1] = expand6to8((p >>> 5) & 0x3F);
        pixels[dstOffs + 0] = expand5to8((p >>> 11) & 0x1F);
        pixels[dstOffs + 2] = expand5to8(p & 0x1F);
        pixels[dstOffs + 3] = 0xFF;
        srcOffs += 2;
    });
}

function decodeTexture_A8(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const A = src.getUint8(srcOffs++);
        pixels[dstOffs + 0] = 0xFF;
        pixels[dstOffs + 1] = 0xFF;
        pixels[dstOffs + 2] = 0xFF;
        pixels[dstOffs + 3] = A;
    });
}

function decodeTexture_L4(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint8(srcOffs >>> 1);
        const n = (srcOffs & 1) ? (p >>> 4) : (p & 0x0F);
        const L = expand4to8(n);
        pixels[dstOffs + 0] = L;
        pixels[dstOffs + 1] = L;
        pixels[dstOffs + 2] = L;
        pixels[dstOffs + 3] = L;
        srcOffs++;
    });
}

function decodeTexture_L8(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const L = src.getUint8(srcOffs++);
        pixels[dstOffs + 0] = L;
        pixels[dstOffs + 1] = L;
        pixels[dstOffs + 2] = L;
        pixels[dstOffs + 3] = L;
    });
}

function decodeTexture_LA8(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const A = src.getUint8(srcOffs++);
        const L = src.getUint8(srcOffs++);
        pixels[dstOffs + 0] = L;
        pixels[dstOffs + 1] = L;
        pixels[dstOffs + 2] = L;
        pixels[dstOffs + 3] = A;
    });
}

export function decodeTexture(format: TextureFormat, width: number, height: number, texData: ArrayBufferSlice): Uint8Array {
    switch (format) {
    case TextureFormat.ETC1:
        return decodeTexture_ETC1(width, height, texData, false);
    case TextureFormat.ETC1A4:
        return decodeTexture_ETC1(width, height, texData, true);
    case TextureFormat.RGBA4444:
        return decodeTexture_RGBA4444(width, height, texData);
    case TextureFormat.RGBA5551:
        return decodeTexture_RGBA5551(width, height, texData);
    case TextureFormat.RGB565:
        return decodeTexture_RGB565(width, height, texData);
    case TextureFormat.A8:
        return decodeTexture_A8(width, height, texData);
    case TextureFormat.L4:
        return decodeTexture_L4(width, height, texData);
    case TextureFormat.L8:
        return decodeTexture_L8(width, height, texData);
    case TextureFormat.LA8:
        return decodeTexture_LA8(width, height, texData);
    default:
        throw new Error(`Unsupported texture type! ${(format as number).toString(16)}`);
    }
}

export function getTextureFormatName(format: TextureFormat): string {
    switch (format) {
    case TextureFormat.RGB8: return 'RGB8';
    case TextureFormat.RGBA8: return 'RGBA8';
    case TextureFormat.RGBA5551: return 'RGBA5551';
    case TextureFormat.RGB565: return 'RGB565';
    case TextureFormat.RGBA4444: return 'RGBA4444';
    case TextureFormat.LA8: return 'LA8';
    case TextureFormat.HILO8: return 'HILO8';
    case TextureFormat.L8: return 'L8';
    case TextureFormat.A8: return 'A8';
    case TextureFormat.LA4: return 'LA4';
    case TextureFormat.L4: return 'L4';
    case TextureFormat.A4: return 'A4';
    case TextureFormat.ETC1: return 'ETC1';
    case TextureFormat.ETC1A4: return 'ETC1A4';
    }
}

export enum TextureFormatGL {
    ETC1     = 0x0000675A,
    ETC1A4   = 0x0000675B,
    RGBA4444 = 0x80336752,
    RGBA5551 = 0x80346752,
    RGB565   = 0x83636754,
    A8       = 0x14016756,
    L8       = 0x14016757,
    L4       = 0x67616757,
    LA8      = 0x14016758,
}

export function getTextureFormatFromGLFormat(glFormat: TextureFormatGL): TextureFormat {
    switch (glFormat) {
    case TextureFormatGL.ETC1:     return TextureFormat.ETC1;
    case TextureFormatGL.ETC1A4:   return TextureFormat.ETC1A4;
    case TextureFormatGL.RGBA4444: return TextureFormat.RGBA4444;
    case TextureFormatGL.RGBA4444: return TextureFormat.RGBA4444;
    case TextureFormatGL.RGBA5551: return TextureFormat.RGBA5551;
    case TextureFormatGL.RGB565:   return TextureFormat.RGB565;
    case TextureFormatGL.A8:       return TextureFormat.A8;
    case TextureFormatGL.L8:       return TextureFormat.L8;
    case TextureFormatGL.L4:       return TextureFormat.L4;
    case TextureFormatGL.LA8:      return TextureFormat.LA8;
    }
}
