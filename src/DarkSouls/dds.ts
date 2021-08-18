
import * as Viewer from '../viewer';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import { GfxDevice, GfxFormat, GfxTextureDescriptor, GfxTextureDimension, GfxTextureUsage, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { decompressBC, DecodedSurfaceSW } from "../Common/bc_texture";

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
    format: 'DXT1' | 'DXT5' | 'RGB';
    isCubemap: boolean;
    isSRGB: boolean;
}

function getSubresourceSize(format: 'DXT1' | 'DXT3' | 'DXT5' | 'RGB', width: number, height: number): number {
    const numBlocksX = (width + 3) >> 2;
    const numBlocksY = (height + 3) >> 2;
    const numBlocks = numBlocksX * numBlocksY;

    if (format === "DXT1")
        return numBlocks * 8;
    else if (format === "DXT3" || format === "DXT5")
        return numBlocks * 16;
    else if (format === "RGB")
        return width * height * 3;
    else
        return 0;
}

const enum DDS_PIXELFORMAT_FLAGS {
    DDPF_FOURCC = 0x04,
    DDPF_RGB    = 0x40,
}

const enum DDS_CAPS2 {
    CUBEMAP          = 0x0200,
    CUBEMAP_ALLFACES = 0xFC00,
}

export function parse(buffer: ArrayBufferSlice, name: string, isSRGB: boolean): DDS {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === 'DDS ');
    assert(view.getUint32(0x04, true) === 0x7C);

    const height = view.getUint32(0x0C, true);
    const width = view.getUint32(0x10, true);
    const linearSize = view.getUint32(0x14, true);

    const numLevels = Math.max(view.getUint32(0x1C, true), 1);

    const ddpf_dwSize = view.getUint32(0x4C, true);
    assert(ddpf_dwSize === 0x20);

    let format: 'DXT1' | 'DXT5' | 'RGB';
    const ddpf_dwFlags = view.getUint32(0x50, true) as DDS_PIXELFORMAT_FLAGS;
    if (!!(ddpf_dwFlags & DDS_PIXELFORMAT_FLAGS.DDPF_FOURCC)) {
        const ddpf_dwFourCC = readString(buffer, 0x54, 0x04);
        if (ddpf_dwFourCC !== 'DXT1' && ddpf_dwFourCC !== 'DXT5') {
            console.log(`Unknown texture format ${ddpf_dwFourCC} in file ${name}`);
        }
        format = ddpf_dwFourCC as 'DXT1' | 'DXT5';
    } else if (!!(ddpf_dwFlags & DDS_PIXELFORMAT_FLAGS.DDPF_RGB)) {
        const ddpf_dwRGBBitCount = view.getUint32(0x58, true);
        assert(ddpf_dwRGBBitCount === 24);
        const ddpf_dwRBitMask = view.getUint32(0x5C, true);
        assert(ddpf_dwRBitMask === 0x00FF0000);
        const ddpf_dwGBitMask = view.getUint32(0x60, true);
        assert(ddpf_dwGBitMask === 0x0000FF00);
        const ddpf_dwBBitMask = view.getUint32(0x64, true);
        assert(ddpf_dwBBitMask === 0x000000FF);
        format = 'RGB';
    } else {
        throw "whoops";
    }

    const dwCaps = view.getUint32(0x6C, true);
    const dwCaps2: DDS_CAPS2 = view.getUint32(0x70, true);
    const isCubemap = !!(dwCaps2 & DDS_CAPS2.CUBEMAP);
    if (isCubemap)
        assert(!!(dwCaps2 & DDS_CAPS2.CUBEMAP_ALLFACES));

    const levels: Level[] = [];

    let dataOffs = 0x80;

    let mipWidth = width, mipHeight = height;
    for (let i = 0; i < numLevels; i++) {
        const size = getSubresourceSize(format, mipWidth, mipHeight);
        if (i == 0 && size !== 0)
            assert(size === linearSize);

        const numSubresources = isCubemap ? 6 : 1;
        const levelSize = size * numSubresources;

        const data = buffer.subarray(dataOffs, levelSize);
        dataOffs += size;

        const level: Level = { width: mipWidth, height: mipHeight, data };
        levels.push(level);

        mipWidth >>= 1;
        mipHeight >>= 1;

        mipWidth = Math.max(mipWidth, 1);
        mipHeight = Math.max(mipHeight, 1);
    }

    name = name.toLowerCase();

    return { name, width, height, format, levels, isCubemap, isSRGB };
}

function decodeRGB(level: Level): Uint8Array {
    const src = level.data.createTypedArray(Uint8Array);
    const dst = new Uint8Array(src.length * 4 / 3);
    let srcOffs = 0;
    for (let dstOffs = 0; dstOffs < dst.length;) {
        dst[dstOffs++] = src[srcOffs++];
        dst[dstOffs++] = src[srcOffs++];
        dst[dstOffs++] = src[srcOffs++];
        dst[dstOffs++] = 0xFF;
    }
    return dst;
}

function decompressDDSLevel(dds: DDS, level: Level): DecodedSurfaceSW {
    const data = level.data;

    if (dds.format === 'DXT1') {
        return decompressBC({ type: 'BC1', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: data.createTypedArray(Uint8Array) });
    } else if (dds.format === 'DXT5') {
        return decompressBC({ type: 'BC3', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: data.createTypedArray(Uint8Array) });
    } else {
        // Unknown format type...
        return { type: 'RGBA', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: new Uint8Array(level.width * level.height * 4) };
    }
}

export class DDSTextureHolder extends TextureHolder<DDS> {
    public loadTexture(device: GfxDevice, textureEntry: DDS): LoadedTexture {
        const surfaces: HTMLCanvasElement[] = [];

        let pixelFormat: GfxFormat;
        if (textureEntry.format === 'DXT1')
            pixelFormat = textureEntry.isSRGB ? GfxFormat.BC1_SRGB : GfxFormat.BC1;
        // TODO(jstpierre): Support native BC3. Seems like texture sizes are too goofy right now?
        // else if (textureEntry.format === 'DXT5' && device.queryTextureFormatSupported(GfxFormat.BC3_SRGB))
        //     pixelFormat = GfxFormat.BC3_SRGB;
        else
            pixelFormat = textureEntry.isSRGB ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;

        if (!device.queryTextureFormatSupported(pixelFormat, textureEntry.width, textureEntry.height))
            pixelFormat = textureEntry.isSRGB ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;

        const levelDatas: Uint8Array[] = [];
        for (let i = 0; i < textureEntry.levels.length; i++) {
            const level = textureEntry.levels[i];

            if (textureEntry.format === 'RGB') {
                levelDatas.push(decodeRGB(level));
            } else if (pixelFormat === GfxFormat.BC1 || pixelFormat === GfxFormat.BC1_SRGB || pixelFormat === GfxFormat.BC3 || pixelFormat === GfxFormat.BC3_SRGB) {
                levelDatas.push(level.data.createTypedArray(Uint8Array));
            } else {
                const decodedSurface = decompressDDSLevel(textureEntry, level);
                levelDatas.push(decodedSurface.pixels as Uint8Array);
                decodedSurface.pixels = null as unknown as Uint8Array;
            }

            // Delete expensive data
            level.data = null as unknown as ArrayBufferSlice;
        }

        const descriptor: GfxTextureDescriptor = {
            width: textureEntry.width,
            height: textureEntry.height,
            pixelFormat,
            dimension: textureEntry.isCubemap ? GfxTextureDimension.Cube : GfxTextureDimension.n2D,
            depth: textureEntry.isCubemap ? 6 : 1,
            numLevels: textureEntry.levels.length,
            usage: GfxTextureUsage.Sampled,
        };
        const gfxTexture = device.createTexture(descriptor);
        device.uploadTextureData(gfxTexture, 0, levelDatas);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', textureEntry.format);
        const viewerTexture: Viewer.Texture = { name: textureEntry.name, surfaces, extraInfo };

        return { viewerTexture, gfxTexture };
    }
}
