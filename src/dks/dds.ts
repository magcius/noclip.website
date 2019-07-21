
import * as Viewer from '../viewer';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import { GfxDevice, GfxTextureDimension, GfxFormat } from "../gfx/platform/GfxPlatform";
import { decompressBC, surfaceToCanvas, DecodedSurfaceSW } from "../fres/bc_texture";

export interface Level {
    width: number;
    height: number;
    data: ArrayBufferSlice;
}

export interface DDS {
    name: string;
    width: number;
    height: number;
    levels: Level[];
    format: 'DXT1' | 'DXT5';
}

function getCompressedBufferSize(format: 'DXT1' | 'DXT3' | 'DXT5', width: number, height: number): number {
    var numBlocksX = (width + 3) >> 2;
    var numBlocksY = (height + 3) >> 2;
    var numBlocks = numBlocksX * numBlocksY;

    if (format === "DXT1")
        return numBlocks * 8;
    else if (format === "DXT3" || format === "DXT5")
        return numBlocks * 16;
    else
        return 0;
}

export function parse(buffer: ArrayBufferSlice, name: string): DDS {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === 'DDS ');
    assert(view.getUint32(0x04, true) === 0x7C);

    const width = view.getUint32(0x10, true);
    const height = view.getUint32(0x0C, true);
    const linearSize = view.getUint32(0x14, true);

    const numLevels = Math.max(view.getUint32(0x1C, true), 1);

    const pixelFormat = view.getUint32(0x4C, true);
    assert(pixelFormat === 0x20);

    const format_ = readString(buffer, 0x54, 0x04);
    const format = format_ as ('DXT1' | 'DXT5');

    const levels: Level[] = [];

    let dataOffs = 0x80;

    let mipWidth = width, mipHeight = height;
    for (let i = 0; i < numLevels; i++) {
        const size = getCompressedBufferSize(format, mipWidth, mipHeight);
        if (i == 0 && size !== 0)
            assert(size === linearSize);

        const data = buffer.subarray(dataOffs, size);
        dataOffs += size;

        const level: Level = { width: mipWidth, height: mipHeight, data };
        levels.push(level);

        mipWidth >>= 1;
        mipHeight >>= 1;

        mipWidth = Math.max(mipWidth, 1);
        mipHeight = Math.max(mipHeight, 1);
    }

    return { name, width, height, format, levels };
}

function decompressDDSLevel(dds: DDS, level: Level): DecodedSurfaceSW {
    switch (dds.format) {
    case 'DXT1':
        return decompressBC({ type: 'BC1', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: level.data.createTypedArray(Uint8Array) });
    case 'DXT5':
        return decompressBC({ type: 'BC3', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: level.data.createTypedArray(Uint8Array) });
    default:
        // Unknown format type...
        return { type: 'RGBA', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: new Uint8Array(level.width * level.height * 4) };
    }
}

export class DDSTextureHolder extends TextureHolder<DDS> {
    public loadTexture(device: GfxDevice, textureEntry: DDS): LoadedTexture {
        const surfaces: HTMLCanvasElement[] = [];

        const levelDatas: Uint8Array[] = [];
        for (let i = 0; i < textureEntry.levels.length; i++) {
            const level = textureEntry.levels[i];
            const decodedSurface = decompressDDSLevel(textureEntry, level);

            levelDatas.push(decodedSurface.pixels as Uint8Array);

            const canvas = document.createElement('canvas');
            surfaceToCanvas(canvas, decodedSurface, 0);
            surfaces.push(canvas);
        }

        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA_SRGB,
            width: textureEntry.width, height: textureEntry.height, depth: 1, numLevels: textureEntry.levels.length,
        });
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, levelDatas);
        device.submitPass(hostAccessPass);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', textureEntry.format);
        const viewerTexture: Viewer.Texture = { name: textureEntry.name, surfaces, extraInfo };

        return { viewerTexture, gfxTexture };
    }
}
