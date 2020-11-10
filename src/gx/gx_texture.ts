
// GX texture decoding

import ArrayBufferSlice from '../ArrayBufferSlice';

import * as GX from './gx_enum';
import { align, assertExists } from '../util';
import { gx_texture_asInstance, gx_texture_asExports } from '../wat_modules';
import { WasmMemoryManager } from '../WasmMemoryManager';

type TextureDecoder = (pScratch: number, pDst: number, pSrc: number, width: number, height: number) => void;

declare module "../wat_modules" {
    interface gx_texture_asExports {
        decode_I4: TextureDecoder;
        decode_I8: TextureDecoder;
        decode_IA4: TextureDecoder;
        decode_IA8: TextureDecoder;
        decode_RGB565: TextureDecoder;
        decode_RGB5A3: TextureDecoder;
        decode_RGBA8: TextureDecoder;
        decode_CMPR: TextureDecoder;
    }
}

export interface TextureInputGX {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice | null;
    mipCount: number;
    paletteFormat?: GX.TexPalette | null;
    paletteData?: ArrayBufferSlice | null;
}

export interface DecodedTexture {
    pixels: ArrayBufferView;
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
        paletteSize = 16384;
        break;
    default:
        throw new Error("whoops");
    }

    // All palette-formats are 16-bit.
    return paletteSize * 2;
}

export function calcTextureSize(format: GX.TexFormat, width: number, height: number) {
    const numPixels = align(width, 0x08) * align(height, 0x08);
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
    case GX.TexFormat.C14X2:
        return numPixels * 2;
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

export interface MipChain {
    name: string;
    mipLevels: TextureInputGX[];
    fullTextureSize: number;
}

export function calcMipChain(texture: TextureInputGX, mipCount: number): MipChain {
    const mipLevels: TextureInputGX[] = [];
    const name = texture.name;

    let mipOffs = 0;
    let mipLevel = 0;
    const format = texture.format;
    let width = texture.width;
    let height = texture.height;

    while (mipLevel < mipCount) {
        const data = texture.data !== null ? texture.data.subarray(mipOffs) : null;
        const paletteFormat = texture.paletteFormat;
        const paletteData = texture.paletteData;
        mipLevels.push({ name: `${texture.name} mip level ${mipLevel}`, format, width, height, data, paletteFormat, paletteData, mipCount: 1 });
        mipLevel++;
        const mipSize = calcTextureSize(format, width, height);
        // Mipmap levels are aligned to 32B.
        mipOffs += Math.max(mipSize, 32);
        width /= 2;
        height /= 2;

        // It seems like anything below 4x4 has junk data, at least from evidence from
        // Super Paper Mario. Not sure if this data is even read by GC.
        const sizeLimit = 2;
        if (width <= sizeLimit || height <= sizeLimit)
            break;
    }

    return { name, mipLevels, fullTextureSize: mipOffs };
}

// XXX(jstpierre): Firefox has GC pressure when constructing new WebAssembly.Memory instances
// on 64-bit machines. Construct a global WebAssembly.Memory and use it. Remove this when the
// bug is fixed. https://bugzilla.mozilla.org/show_bug.cgi?id=1459761#c5
const _wasmInstance = gx_texture_asInstance();

function decode_Wasm(wasmInstance: gx_texture_asExports, texture: TextureInputGX, decoder: TextureDecoder, scratchSize: number = 0): DecodedTexture {
    const dstSize = texture.width * texture.height * 4;
    const srcSize = texture.data!.byteLength;

    const pScratch = 0;
    const pDst = align(pScratch + scratchSize, 0x10);
    const pSrc = align(pDst + dstSize, 0x10);
    const heapSize = align(pSrc + srcSize, 0x10);

    const wasmMemory = new WasmMemoryManager(wasmInstance.memory);
    const heap = wasmMemory.resize(heapSize);

    // Copy src buffer.
    heap.set(texture.data!.createTypedArray(Uint8Array), pSrc);

    decoder(pScratch, pDst, pSrc, texture.width, texture.height);

    // Copy the result buffer to a new buffer for memory usage purposes.
    const pixelsBuffer = new ArrayBufferSlice(heap.buffer).copyToBuffer(pDst, dstSize);
    const pixels = new Uint8Array(pixelsBuffer);
    return { pixels };
}

function decode_Dummy(texture: TextureInputGX): DecodedTexture {
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    pixels.fill(0xFF);
    return { pixels };
}

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

function decodePalette_IA8(paletteData: ArrayBufferSlice): Uint8Array {
    const paletteCount = paletteData.byteLength >>> 1;
    const dst = new Uint8Array(paletteCount * 4);
    const view = paletteData.createDataView();
    for (let i = 0; i < paletteCount; i++) {
        const aa = view.getUint8(i * 2 + 0);
        const ii = view.getUint8(i * 2 + 1);
        dst[i * 4 + 0] = ii;
        dst[i * 4 + 1] = ii;
        dst[i * 4 + 2] = ii;
        dst[i * 4 + 3] = aa;
    }
    return dst;
}

function decodePalette_RGB565(paletteData: ArrayBufferSlice): Uint8Array {
    const paletteCount = paletteData.byteLength >>> 1;
    const dst = new Uint8Array(paletteCount * 4);
    const view = paletteData.createDataView();
    for (let i = 0; i < paletteCount; i++) {
        const p = view.getUint16(i * 2 + 0);
        dst[i * 4 + 0] = expand5to8((p >> 11) & 0x1F);
        dst[i * 4 + 1] = expand6to8((p >> 5) & 0x3F);
        dst[i * 4 + 2] = expand5to8(p & 0x1F);
        dst[i * 4 + 3] = 0xFF;
    }
    return dst;
}

function decodePalette_RGB5A3(paletteData: ArrayBufferSlice): Uint8Array {
    const paletteCount = paletteData.byteLength >>> 1;
    const dst = new Uint8Array(paletteCount * 4);
    const view = paletteData.createDataView();
    for (let i = 0; i < paletteCount; i++) {
        const p = view.getUint16(i * 2 + 0);
        if (p & 0x8000) {
            // RGB5
            dst[i * 4 + 0] = expand5to8((p >> 10) & 0x1F);
            dst[i * 4 + 1] = expand5to8((p >> 5) & 0x1F);
            dst[i * 4 + 2] = expand5to8(p & 0x1F);
            dst[i * 4 + 3] = 0xFF;
        } else {
            // A3RGB4
            dst[i * 4 + 0] = expand4to8((p >> 8) & 0x0F);
            dst[i * 4 + 1] = expand4to8((p >> 4) & 0x0F);
            dst[i * 4 + 2] = expand4to8(p & 0x0F);
            dst[i * 4 + 3] = expand3to8(p >> 12);
        }
    }
    return dst;
}

function decodePalette(paletteFormat: GX.TexPalette, paletteData: ArrayBufferSlice): Uint8Array {
    switch (paletteFormat) {
    case GX.TexPalette.IA8:
        return decodePalette_IA8(paletteData);
    case GX.TexPalette.RGB565:
        return decodePalette_RGB565(paletteData);
    case GX.TexPalette.RGB5A3:
        return decodePalette_RGB5A3(paletteData);
    }
}

function decode_Tiled(texture: TextureInputGX, bw: number, bh: number, decoder: (pixels: Uint8Array, dstOffs: number) => void): DecodedTexture {
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
    return { pixels };
}

function decode_C4(texture: TextureInputGX): DecodedTexture {
    if (!texture.paletteData || !texture.paletteFormat) return decode_Dummy(texture);
    const view = texture.data!.createDataView();
    const paletteData: Uint8Array = decodePalette(texture.paletteFormat, texture.paletteData);
    let srcOffs = 0;
    return decode_Tiled(texture, 8, 8, (dst: Uint8Array, dstOffs: number): void => {
        const ii = view.getUint8(srcOffs >> 1);
        const i = ii >>> ((srcOffs & 1) ? 0 : 4) & 0x0F;
        dst[dstOffs + 0] = paletteData[i * 4 + 0];
        dst[dstOffs + 1] = paletteData[i * 4 + 1];
        dst[dstOffs + 2] = paletteData[i * 4 + 2];
        dst[dstOffs + 3] = paletteData[i * 4 + 3];
        srcOffs++;
    });
}

function decode_C8(texture: TextureInputGX): DecodedTexture {
    if (!texture.paletteData || !texture.paletteFormat) return decode_Dummy(texture);
    const view = texture.data!.createDataView();
    const paletteData: Uint8Array = decodePalette(texture.paletteFormat, texture.paletteData);
    let srcOffs = 0;
    return decode_Tiled(texture, 8, 4, (dst: Uint8Array, dstOffs: number): void => {
        const i = view.getUint8(srcOffs);
        dst[dstOffs + 0] = paletteData[i * 4 + 0];
        dst[dstOffs + 1] = paletteData[i * 4 + 1];
        dst[dstOffs + 2] = paletteData[i * 4 + 2];
        dst[dstOffs + 3] = paletteData[i * 4 + 3];
        srcOffs++;
    });
}

function decode_C14X2(texture: TextureInputGX): DecodedTexture {
    if (!texture.paletteData || !texture.paletteFormat) return decode_Dummy(texture);
    const view = texture.data!.createDataView();
    const paletteData: Uint8Array = decodePalette(texture.paletteFormat, texture.paletteData);
    let srcOffs = 0;
    return decode_Tiled(texture, 4, 4, (dst: Uint8Array, dstOffs: number): void => {
        const i = view.getUint16(srcOffs) & 0x3FFF;
        dst[dstOffs + 0] = paletteData[i * 4 + 0];
        dst[dstOffs + 1] = paletteData[i * 4 + 1];
        dst[dstOffs + 2] = paletteData[i * 4 + 2];
        dst[dstOffs + 3] = paletteData[i * 4 + 3];
        srcOffs += 2;
    });
}

function getPaletteFormatName(paletteFormat: GX.TexPalette | undefined | null): string {
    switch (assertExists(paletteFormat)) {
    case GX.TexPalette.IA8:
        return "IA8";
    case GX.TexPalette.RGB565:
        return "RGB565";
    case GX.TexPalette.RGB5A3:
        return "RGB5A3";
    default:
        return "invalid";
    }
}

export function getFormatName(format: GX.TexFormat, paletteFormat?: GX.TexPalette | null): string {
    switch (format) {
    case GX.TexFormat.I4:
        return "I4";
    case GX.TexFormat.I8:
        return "I8";
    case GX.TexFormat.IA4:
        return "IA4";
    case GX.TexFormat.IA8:
        return "IA8";
    case GX.TexFormat.RGB565:
        return "RGB565";
    case GX.TexFormat.RGB5A3:
        return "RGB5A3";
    case GX.TexFormat.RGBA8:
        return "RGBA8";
    case GX.TexFormat.CMPR:
        return "CMPR";
    case GX.TexFormat.C4:
        return `C4 (${getPaletteFormatName(paletteFormat)})`;
    case GX.TexFormat.C8:
        return `C8 (${getPaletteFormatName(paletteFormat)})`;
    case GX.TexFormat.C14X2:
        return `C14X2 (${getPaletteFormatName(paletteFormat)})`;
    default:
        return "invalid";
    }
}

export function decodeTexture(texture: TextureInputGX): Promise<DecodedTexture> {
    if (texture.data === null)
        return Promise.resolve(decode_Dummy(texture));

    return _wasmInstance.then((wasmInstance) => {
        switch (texture.format) {
        case GX.TexFormat.I4:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_I4);
        case GX.TexFormat.I8:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_I8);
        case GX.TexFormat.IA4:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_IA4);
        case GX.TexFormat.IA8:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_IA8);
        case GX.TexFormat.RGB565:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_RGB565);
        case GX.TexFormat.RGB5A3:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_RGB5A3);
        case GX.TexFormat.RGBA8:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_RGBA8);
        case GX.TexFormat.CMPR:
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_CMPR, 0x10);
        case GX.TexFormat.C4:
            return decode_C4(texture);
        case GX.TexFormat.C8:
            return decode_C8(texture);
        case GX.TexFormat.C14X2:
            return decode_C14X2(texture);
        default:
            console.error(`Unsupported texture format ${texture.format} on texture ${texture.name}`);
            return decode_Dummy(texture);
        }
    });
}
