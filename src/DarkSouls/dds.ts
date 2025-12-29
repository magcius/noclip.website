
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDescriptor, GfxTextureDimension, GfxTextureUsage, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { decompressBC, DecodedSurfaceSW } from "../Common/bc_texture.js";

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
    format: 'DXT1' | 'DXT3' | 'DXT5' | 'RGB' | 'RGBA';
    isCubemap: boolean;
    isSRGB: boolean;
}

function getSubresourceSize(format: 'DXT1' | 'DXT3' | 'DXT5' | 'RGB' | 'RGBA', width: number, height: number): number {
    const numBlocksX = (width + 3) >> 2;
    const numBlocksY = (height + 3) >> 2;
    const numBlocks = numBlocksX * numBlocksY;

    if (format === "DXT1")
        return numBlocks * 8;
    else if (format === "DXT3" || format === "DXT5")
        return numBlocks * 16;
    else if (format === "RGB")
        return width * height * 3;
    else if (format === "RGBA")
        return width * height * 4;
    else
        return 0;
}

enum DDS_PIXELFORMAT_FLAGS {
    DDPF_FOURCC = 0x04,
    DDPF_RGB    = 0x40,
}

enum DDS_CAPS2 {
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

    let format: 'DXT1' | 'DXT5' | 'RGB' | 'RGBA';
    const ddpf_dwFlags = view.getUint32(0x50, true) as DDS_PIXELFORMAT_FLAGS;
    if (!!(ddpf_dwFlags & DDS_PIXELFORMAT_FLAGS.DDPF_FOURCC)) {
        const ddpf_dwFourCC = readString(buffer, 0x54, 0x04);
        if (ddpf_dwFourCC !== 'DXT1' && ddpf_dwFourCC !== 'DXT3' && ddpf_dwFourCC !== 'DXT5') {
            console.log(`Unknown texture format ${ddpf_dwFourCC} in file ${name}`);
        }
        format = ddpf_dwFourCC as 'DXT1' | 'DXT5';
    } else if (!!(ddpf_dwFlags & DDS_PIXELFORMAT_FLAGS.DDPF_RGB)) {
        const ddpf_dwRGBBitCount = view.getUint32(0x58, true);
        if (ddpf_dwRGBBitCount === 24) {
            const ddpf_dwRBitMask = view.getUint32(0x5C, true);
            assert(ddpf_dwRBitMask === 0x00FF0000);
            const ddpf_dwGBitMask = view.getUint32(0x60, true);
            assert(ddpf_dwGBitMask === 0x0000FF00);
            const ddpf_dwBBitMask = view.getUint32(0x64, true);
            assert(ddpf_dwBBitMask === 0x000000FF);
            format = 'RGB';
        } else if (ddpf_dwRGBBitCount === 32) {
            const ddpf_dwRBitMask = view.getUint32(0x5C, true);
            assert(ddpf_dwRBitMask === 0x00FF0000);
            const ddpf_dwGBitMask = view.getUint32(0x60, true);
            assert(ddpf_dwGBitMask === 0x0000FF00);
            const ddpf_dwBBitMask = view.getUint32(0x64, true);
            assert(ddpf_dwBBitMask === 0x000000FF);
            const ddpf_dwABitMask = view.getUint32(0x68, true);
            assert(ddpf_dwABitMask === 0xFF000000);
            format = 'RGBA';
        } else {
            throw "whoops";
        }
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
        // if (i == 0 && size !== 0)
        //     assert(size === linearSize);

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

function decodeRGB(level: Level): Uint8Array<ArrayBuffer> {
    const src = level.data.createTypedArray(Uint8Array);
    const dst = new Uint8Array(src.length * 4 / 3);
    let srcOffs = 0;
    for (let dstOffs = 0; dstOffs < dst.length;) {
        dst[dstOffs++] = src[srcOffs + 2];
        dst[dstOffs++] = src[srcOffs + 1];
        dst[dstOffs++] = src[srcOffs + 0];
        dst[dstOffs++] = 0xFF;
        srcOffs += 3;
    }
    return dst;
}

function decodeRGBA(level: Level): Uint8Array<ArrayBuffer> {
    const src = level.data.createTypedArray(Uint8Array);
    const dst = new Uint8Array(src.length);
    let srcOffs = 0;
    for (let dstOffs = 0; dstOffs < dst.length;) {
        dst[dstOffs++] = src[srcOffs + 2];
        dst[dstOffs++] = src[srcOffs + 1];
        dst[dstOffs++] = src[srcOffs + 0];
        dst[dstOffs++] = src[srcOffs + 3];
        srcOffs += 4;
    }
    return dst;
}

function decompressDDSLevel(dds: DDS, level: Level): DecodedSurfaceSW {
    const data = level.data;

    if (dds.format === 'DXT1') {
        return decompressBC({ type: 'BC1', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: data.createTypedArray(Uint8Array) });
    } else if (dds.format === 'DXT3') {
        return decompressBC({ type: 'BC2', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: data.createTypedArray(Uint8Array) });
    } else if (dds.format === 'DXT5') {
        return decompressBC({ type: 'BC3', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: data.createTypedArray(Uint8Array) });
    } else {
        // Unknown format type...
        return { type: 'RGBA', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: new Uint8Array(level.width * level.height * 4) };
    }
}

export function createTexture(device: GfxDevice, dds: DDS): GfxTexture {
    let pixelFormat: GfxFormat;
    if (dds.format === 'DXT1')
        pixelFormat = dds.isSRGB ? GfxFormat.BC1_SRGB : GfxFormat.BC1;
    else if (dds.format === 'DXT3')
        pixelFormat = dds.isSRGB ? GfxFormat.BC2_SRGB : GfxFormat.BC2;
    // TODO(jstpierre): Support native BC3. Seems like texture sizes are too goofy right now?
    // else if (textureEntry.format === 'DXT5' && device.queryTextureFormatSupported(GfxFormat.BC3_SRGB))
    //     pixelFormat = GfxFormat.BC3_SRGB;
    else
        pixelFormat = dds.isSRGB ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;

    if (!device.queryTextureFormatSupported(pixelFormat, dds.width, dds.height))
        pixelFormat = dds.isSRGB ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;

    const levelDatas: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < dds.levels.length; i++) {
        const level = dds.levels[i];

        if (dds.format === 'RGB') {
            levelDatas.push(decodeRGB(level));
        } else if (dds.format === 'RGBA') {
            levelDatas.push(decodeRGBA(level));
        } else if (pixelFormat === GfxFormat.BC1 || pixelFormat === GfxFormat.BC1_SRGB || pixelFormat === GfxFormat.BC2 || pixelFormat === GfxFormat.BC2_SRGB /*|| pixelFormat === GfxFormat.BC3 || pixelFormat === GfxFormat.BC3_SRGB*/) {
            levelDatas.push(level.data.createTypedArray(Uint8Array));
        } else {
            const decodedSurface = decompressDDSLevel(dds, level);
            levelDatas.push(decodedSurface.pixels as Uint8Array<ArrayBuffer>);
            decodedSurface.pixels = null as unknown as Uint8Array<ArrayBuffer>;
        }

        // Delete expensive data
        level.data = null as unknown as ArrayBufferSlice;
    }

    const descriptor: GfxTextureDescriptor = {
        width: dds.width,
        height: dds.height,
        pixelFormat,
        dimension: dds.isCubemap ? GfxTextureDimension.Cube : GfxTextureDimension.n2D,
        depthOrArrayLayers: dds.isCubemap ? 6 : 1,
        numLevels: dds.levels.length,
        usage: GfxTextureUsage.Sampled,
    };

    const tex = device.createTexture(descriptor);
    device.setResourceName(tex, dds.name);
    device.uploadTextureData(tex, 0, levelDatas);
    return tex;
}
