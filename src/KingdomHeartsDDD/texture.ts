import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform";
import { clamp } from "../MathHelpers";
import { DreamDropCTRT } from "./bin";

// Credit: https://github.com/OpenKH/OpenKh/tree/master/OpenKh.Ddd
// Decoding logic adapated from src/OcarinaOfTime3D/pica_texture.ts

/**
 * All possible CTR texture formats for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export enum DreamDropTextureFormat {
    RGBA_8888,
    RGB_888,
    RGBA_5551,
    RGB_565,
    RGBA_4444, // unused
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

/**
 * Processed texture for _Kingdom Hearts 3D: Dream Drop Distance_. Uploaded to device upon creation
 */
export class DreamDropTexture {
    public gfxTexture: GfxTexture;

    constructor(device: GfxDevice, public name: string, public format: DreamDropTextureFormat, width: number, height: number, data: Uint8Array) {
        const gfxTexture = device.createTexture({
            width, height,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1, numLevels: 1
        });
        device.setResourceName(gfxTexture, name);
        device.uploadTextureData(gfxTexture, 0, [data]);
        this.gfxTexture = gfxTexture;
    }
}

/**
 * Decodes CTR texture for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export function dreamDropDecodeCTRT(ctrt: DreamDropCTRT): Uint8Array {
    switch (ctrt.format) {
        case DreamDropTextureFormat.RGBA_8888:
            return decodeRGBA8888(ctrt);
        case DreamDropTextureFormat.RGB_888:
            return decodeRGB888(ctrt);
        case DreamDropTextureFormat.RGBA_5551:
            return decodeRGBA5551(ctrt);
        case DreamDropTextureFormat.RGB_565:
            return decodeRGB565(ctrt);
        case DreamDropTextureFormat.LA8:
            return decodeLA8(ctrt);
        case DreamDropTextureFormat.L8:
            return decodeL8(ctrt);
        case DreamDropTextureFormat.A8:
            return decodeA8(ctrt);
        case DreamDropTextureFormat.ETC1:
            return decodeETC1(ctrt.width, ctrt.height, ctrt.data, false);
        case DreamDropTextureFormat.ETC1A4:
            return decodeETC1(ctrt.width, ctrt.height, ctrt.data, true);
        default:
            console.warn("Unimplemented texture format", ctrt.format);
            return new Uint8Array(0);
    }
}

export function dreamDropTranslateTextureFormat(format: DreamDropTextureFormat): string {
    switch (format) {
        case DreamDropTextureFormat.RGBA_8888: return "RGBA_8888";
        case DreamDropTextureFormat.RGB_888: return "RGB_888";
        case DreamDropTextureFormat.RGBA_5551: return "RGBA_5551";
        case DreamDropTextureFormat.RGB_565: return "RGB_565";
        case DreamDropTextureFormat.RGBA_4444: return "RGBA_4444";
        case DreamDropTextureFormat.LA8: return "LA8";
        case DreamDropTextureFormat.HILO8: return "HILO8";
        case DreamDropTextureFormat.L8: return "L8";
        case DreamDropTextureFormat.A8: return "A8";
        case DreamDropTextureFormat.LA4: return "LA4";
        case DreamDropTextureFormat.L4: return "L4";
        case DreamDropTextureFormat.A4: return "A4";
        case DreamDropTextureFormat.ETC1: return "ETC1";
        case DreamDropTextureFormat.ETC1A4: return "ETC1A4";
    }
}

function decodeRGBA8888(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const p = view.getUint32(offset, true);
        pixels[dest] = ((p >>> 24) & 0xFF);
        pixels[dest + 1] = ((p >>> 16) & 0xFF);
        pixels[dest + 2] = ((p >>> 8) & 0xFF);
        pixels[dest + 3] = ((p >>> 0) & 0xFF);
        offset += 4;
    });
}

function decodeRGB888(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const pixel = view.getInt16(offset, true);
        pixels[dest] = view.getUint8(offset + 0x02);
        pixels[dest + 1] = ((pixel >>> 8) & 0xFF);
        pixels[dest + 2] = ((pixel >>> 0) & 0xFF);
        pixels[dest + 3] = 0xFF;
        offset += 3;
    });
}

function decodeRGBA5551(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const pixel = view.getInt16(offset, true);
        pixels[dest] = expand5to8((pixel >>> 11) & 0x1F);
        pixels[dest + 1] = expand5to8((pixel >>> 6) & 0x1F);
        pixels[dest + 2] = expand5to8((pixel >>> 1) & 0x1F);
        pixels[dest + 3] = (pixel & 0x01) ? 0xFF : 0x00;
        offset += 2;
    });
}

function decodeRGB565(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const pixel = view.getInt16(offset, true);
        pixels[dest] = expand5to8((pixel >>> 11) & 0x1F);
        pixels[dest + 1] = expand6to8((pixel >>> 5) & 0x3F);
        pixels[dest + 2] = expand5to8(pixel & 0x1F);
        pixels[dest + 3] = 0xFF;
        offset += 2;
    });
}

function decodeLA8(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const a = view.getUint8(offset++);
        const l = view.getUint8(offset++);
        pixels[dest] = l;
        pixels[dest + 1] = l;
        pixels[dest + 2] = l;
        pixels[dest + 3] = a;
    });
}

function decodeL8(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const l = view.getUint8(offset++);
        pixels[dest] = l;
        pixels[dest + 1] = l;
        pixels[dest + 2] = l;
        pixels[dest + 3] = l;
    });
}

function decodeA8(ctrt: DreamDropCTRT): Uint8Array {
    const view = ctrt.data.createDataView();
    let offset = 0;
    return decodeTiled(ctrt.width, ctrt.height, (pixels, dest) => {
        const a = view.getUint8(offset++);
        pixels[dest] = 0xFF;
        pixels[dest + 1] = 0xFF;
        pixels[dest + 2] = 0xFF;
        pixels[dest + 3] = a;
    });
}

function decodeETC1(width: number, height: number, data: ArrayBufferSlice, alpha: boolean) {
    const pixels = new Uint8Array(width * height * 4);
    const view = data.createDataView();
    let offset = 0;
    for (let yy = 0; yy < height; yy += 8) {
        for (let xx = 0; xx < width; xx += 8) {
            for (let y = 0; y < 8; y += 4) {
                for (let x = 0; x < 8; x += 4) {
                    const dest = ((yy + y) * width + (xx + x)) * 4;
                    let a1;
                    let a2;
                    if (alpha) {
                        a2 = view.getUint32(offset + 0x00, true);
                        a1 = view.getUint32(offset + 0x04, true);
                        offset += 0x08;
                    } else {
                        a2 = 0xFFFFFFFF;
                        a1 = 0xFFFFFFFF;
                    }
                    decodeETC1_4x4_Alpha(pixels, a1, a2, dest, width);
                    const w2 = view.getUint32(offset + 0x00, true);
                    const w1 = view.getUint32(offset + 0x04, true);
                    decodeETC1_4x4_Color(pixels, w1, w2, dest, width);
                    offset += 0x08;
                }
            }
        }
    }
    return pixels;
}

function decodeTiled(width: number, height: number, decoder: (pixels: Uint8Array, dest: number) => void) {
    const pixels = new Uint8Array(width * height * 4);
    for (let yy = 0; yy < height; yy += 8) {
        for (let xx = 0; xx < width; xx += 8) {
            for (let i = 0; i < 0x40; i++) {
                const x = morton7(i);
                const y = morton7(i >>> 1);
                const dest = ((yy + y) * width + xx + x) * 4;
                decoder(pixels, dest);
            }
        }
    }
    return pixels;
}

function decodeETC1_4x4_Alpha(dest: Uint8Array, a1: number, a2: number, destOffset: number, stride: number) {
    for (let ax = 0; ax < 2; ax++) {
        for (let ay = 0; ay < 4; ay++) {
            const destIndex = destOffset + ((ay * stride) + ax) * 4;
            dest[destIndex + 3] = expand4to8(a2 & 0x0F);
            a2 >>= 4;
        }
    }
    for (let ax = 2; ax < 4; ax++) {
        for (let ay = 0; ay < 4; ay++) {
            const destIndex = destOffset + ((ay * stride) + ax) * 4;
            dest[destIndex + 3] = expand4to8(a1 & 0x0F);
            a1 >>= 4;
        }
    }
}

function decodeETC1_4x4_Color(dest: Uint8Array, w1: number, w2: number, destOffset: number, stride: number): void {
    const intensityTableMap = [
        [2, 8, -2, -8],
        [5, 17, -5, -17],
        [9, 29, -9, -29],
        [13, 42, -13, -42],
        [18, 60, -18, -60],
        [24, 80, -24, -80],
        [33, 106, -33, -106],
        [47, 183, -47, -183]
    ];

    const diff = (w1 & 2) !== 0;
    const flip = (w1 & 1) !== 0;
    const intensityTable1 = intensityTableMap[(w1 >> 5) & 7];
    const intensityTable2 = intensityTableMap[(w1 >> 2) & 7];

    function signed3(n: number) {
        return n << 29 >> 29;
    }

    function getColors(colors: Uint8Array, r: number, g: number, b: number, intensityMap: number[]): void {
        for (let i = 0; i < 4; i++) {
            colors[(i * 3)] = clamp(r + intensityMap[i], 0, 255);
            colors[(i * 3) + 1] = clamp(g + intensityMap[i], 0, 255);
            colors[(i * 3) + 2] = clamp(b + intensityMap[i], 0, 255);
        }
    }

    const colors1 = new Uint8Array(3 * 4);
    const colors2 = new Uint8Array(3 * 4);

    if (diff) {
        const baseR1a = (w1 >>> 27) & 0x1F;
        const baseR2d = signed3((w1 >>> 24) & 7);
        const baseG1a = (w1 >>> 19) & 0x1F;
        const baseG2d = signed3((w1 >>> 16) & 7);
        const baseB1a = (w1 >>> 11) & 0x1F;
        const baseB2d = signed3((w1 >>> 8) & 7);
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
        const baseB2 = expand4to8((w1 >>> 8) & 0x0F);
        getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
        getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
    }

    for (let i = 0; i < 16; i++) {
        const lsb = (w2 >>> i) & 1;
        const msb = (w2 >>> (16 + i)) & 1;
        const lookup = (msb << 1) | lsb;
        const y = i & 3;
        const x = i >>> 2;
        const destIndex = destOffset + ((y * stride) + x) * 4;
        let whichBlock;
        if (!flip) {
            whichBlock = x & 2;
        } else {
            whichBlock = y & 2;
        }
        const colors = whichBlock ? colors2 : colors1;
        dest[destIndex] = colors[(lookup * 3)];
        dest[destIndex + 1] = colors[(lookup * 3) + 1];
        dest[destIndex + 2] = colors[(lookup * 3) + 2];
    }
}

function morton7(n: number) {
    return ((n >>> 2) & 4) | ((n >>> 1) & 2) | (n & 1);
}

function expand4to8(n: number) {
    return (n << 4) | n;
}

function expand5to8(n: number) {
    return (n << 3) | (n >>> 2);
}

function expand6to8(n: number) {
    return (n << 2) | (n >>> 4);
}
