
import * as Viewer from '../viewer';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import { GfxDevice, GfxTextureDimension, GfxFormat } from "../gfx/platform/GfxPlatform";
import { DecodedSurfaceSW, decompressBC, surfaceToCanvas } from "../fres/bc_texture";

export const enum TEXTextureFormat {
    PALETTE,
    DXT1,
    DXT2,
    DXT3,
    DXT4,
    DXT5,
}

interface TEXTextureLevel {
    width: number;
    height: number;
    data: ArrayBufferSlice;
}

export interface TEXTexture {
    name: string;
    width: number;
    height: number;
    format: TEXTextureFormat;
    levels: TEXTextureLevel[];
}

export interface TEX {
    textures: TEXTexture[];
}

export function parse(buffer: ArrayBufferSlice): TEX {
    const view = buffer.createDataView();

    const version = view.getUint32(0x00, true);
    const numTextures = view.getUint32(0x04, true);
    let textureTableIdx = 0x08;
    const textures: TEXTexture[] = [];
    for (let i = 0; i < numTextures; i++) {
        const checksum = view.getUint32(textureTableIdx + 0x00, true);
        const width = view.getUint32(textureTableIdx + 0x04, true);
        const height = view.getUint32(textureTableIdx + 0x08, true);
        const numMipmaps = view.getUint32(textureTableIdx + 0x0C, true);
        const texelDepth = view.getUint32(textureTableIdx + 0x10, true);
        const paletteDepth = view.getUint32(textureTableIdx + 0x14, true);
        const format: TEXTextureFormat = view.getUint32(textureTableIdx + 0x18, true);
        const paletteSize = view.getUint32(textureTableIdx + 0x1C, true);
        textureTableIdx += 0x20;

        if (paletteSize) {
            console.log(paletteDepth, paletteSize);
            throw "whoops";
        }

        const levels: TEXTextureLevel[] = [];
        let mipWidth = width;
        let mipHeight = height;
        for (let j = 0; j < numMipmaps; j++) {
            const dataSize = view.getUint32(textureTableIdx + 0x00, true);
            textureTableIdx += 0x04;

            const levelData = buffer.subarray(textureTableIdx + 0x00, dataSize);
            textureTableIdx += dataSize;
            levels.push({ width: mipWidth, height: mipHeight, data: levelData });

            mipWidth = Math.max(mipWidth >>> 1, 1);
            mipHeight = Math.max(mipHeight >>> 1, 1);
        }

        const name = checksum.toString(16);
        textures.push({ name, width, height, format, levels });
    }

    return { textures };
}

function decompressLevel(tex: TEXTexture, level: TEXTextureLevel): DecodedSurfaceSW {
    switch (tex.format) {
    case TEXTextureFormat.DXT1:
        return decompressBC({ type: 'BC1', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: level.data.createTypedArray(Uint8Array) });
    case TEXTextureFormat.DXT5:
        return decompressBC({ type: 'BC3', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: level.data.createTypedArray(Uint8Array) });
    default:
        // Unknown format type...
        return { type: 'RGBA', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: new Uint8Array(level.width * level.height * 4) };
    }
}

export class TEXTextureHolder extends TextureHolder<TEXTexture> {
    public loadTexture(device: GfxDevice, textureEntry: TEXTexture): LoadedTexture {
        const surfaces: HTMLCanvasElement[] = [];

        const levelDatas: Uint8Array[] = [];
        for (let i = 0; i < textureEntry.levels.length; i++) {
            const level = textureEntry.levels[i];
            const decodedSurface = decompressLevel(textureEntry, level);

            levelDatas.push(decodedSurface.pixels as Uint8Array);

            const canvas = document.createElement('canvas');
            surfaceToCanvas(canvas, decodedSurface, 0);
            surfaces.push(canvas);
        }

        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: textureEntry.width, height: textureEntry.height, depth: 1, numLevels: textureEntry.levels.length,
        });
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, levelDatas);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = { name: textureEntry.name, surfaces };
        return { viewerTexture, gfxTexture };
    }

    public addTEX(device: GfxDevice, tex: TEX): void {
        this.addTextures(device, tex.textures);
    }
}
