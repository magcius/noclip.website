
// GX texture decoding

import ArrayBufferSlice from 'ArrayBufferSlice';

import * as GX from './gx_enum';
import { align } from '../util';
import { gx_texture_asInstance, gx_texture_asExports } from '../wat_modules';
import WasmMemoryManager from '../WasmMemoryManager';

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

export interface Texture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice;
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

// XXX(jstpierre): Firefox has GC pressure when constructing new WebAssembly.Memory instances
// on 64-bit machines. Construct a global WebAssembly.Memory and use it. Remove this when the
// bug is fixed. https://bugzilla.mozilla.org/show_bug.cgi?id=1459761#c5
const _wasmInstance = gx_texture_asInstance();

function decode_Wasm(wasmInstance: gx_texture_asExports, texture: Texture, decoder: TextureDecoder, scratchSize: number = 0): DecodedTexture {
    const dstSize = texture.width * texture.height * 4;
    const srcSize = texture.data.byteLength;

    const pScratch = 0;
    const pDst = align(pScratch + scratchSize, 0x10);
    const pSrc = align(pDst + dstSize, 0x10);
    const heapSize = align(pSrc + srcSize, 0x10);

    const wasmMemory = new WasmMemoryManager(wasmInstance.memory);
    const heap = wasmMemory.resize(heapSize);

    // Copy src buffer.
    heap.set(texture.data.createTypedArray(Uint8Array), pSrc);

    decoder(pScratch, pDst, pSrc, texture.width, texture.height);

    // Copy the result buffer to a new buffer for memory usage purposes.
    const pixelsBuffer = new ArrayBufferSlice(heap.buffer).copyToBuffer(pDst, dstSize);
    const pixels = new Uint8Array(pixelsBuffer);
    return { pixels };
}

function decode_Dummy(texture: Texture): DecodedTexture {
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    pixels.fill(0xFF);
    return { pixels };
}

export function decodeTexture(texture: Texture): Promise<DecodedTexture> {
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
            return decode_Wasm(wasmInstance, texture, wasmInstance.decode_CMPR, 16);
        case GX.TexFormat.C4:
        case GX.TexFormat.C8:
        case GX.TexFormat.C14X2:
        default:
            console.error(`Unsupported texture format ${texture.format} on texture ${texture.name}`);
            return decode_Dummy(texture);
        }
    })
}
