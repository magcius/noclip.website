
// Valve Texture File

import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxTexture, GfxDevice, GfxFormat, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxTextureDescriptor, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
import { readString, assert } from "../util";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

const enum ImageFormat {
    RGBA8888     = 0x00,
    BGR888       = 0x03,
    ARGB8888     = 0x0B,
    BGRA8888     = 0x0C,
    DXT1         = 0x0D,
    DXT3         = 0x0E,
    DXT5         = 0x0F,
    BGRA5551     = 0x16,
}

function imageFormatIsBlockCompressed(fmt: ImageFormat): boolean {
    if (fmt === ImageFormat.DXT1)
        return true;
    if (fmt === ImageFormat.DXT5)
        return true;

    return false;
}

function imageFormatGetBPP(fmt: ImageFormat): number {
    if (fmt === ImageFormat.RGBA8888)
        return 4;
    if (fmt === ImageFormat.ARGB8888)
        return 4;
    if (fmt === ImageFormat.BGRA8888)
        return 4;
    if (fmt === ImageFormat.BGR888)
        return 3;
    if (fmt === ImageFormat.BGRA5551)
        return 2;
    throw "whoops";
}

function imageFormatCalcLevelSize(fmt: ImageFormat, width: number, height: number, depth: number): number {
    if (imageFormatIsBlockCompressed(fmt)) {
        width = Math.max(width, 4);
        height = Math.max(height, 4);
        const count = ((width * height) / 16) * depth;
        if (fmt === ImageFormat.DXT1)
            return count * 8;
        else if (fmt === ImageFormat.DXT5)
            return count * 16;
        else
            throw "whoops";
    } else {
        return (width * height * depth) * imageFormatGetBPP(fmt);
    }
}

function imageFormatToGfxFormat(device: GfxDevice, fmt: ImageFormat, srgb: boolean): GfxFormat {
    // TODO(jstpierre): Software decode BC1 if necessary.
    if (fmt === ImageFormat.DXT1)
        return srgb ? GfxFormat.BC1_SRGB : GfxFormat.BC1;
    else if (fmt === ImageFormat.DXT3)
        return srgb ? GfxFormat.BC2_SRGB : GfxFormat.BC1;
    else if (fmt === ImageFormat.DXT5)
        return srgb ? GfxFormat.BC3_SRGB : GfxFormat.BC3;
    else if (fmt === ImageFormat.RGBA8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGR888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRA8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRA5551)
        return GfxFormat.U16_RGBA_5551; // TODO(jstpierre): sRGB?
    else
        throw "whoops";
}

function imageFormatConvertData(device: GfxDevice, fmt: ImageFormat, data: ArrayBufferSlice, width: number, height: number): Uint8Array {
    if (fmt === ImageFormat.BGR888) {
        // BGR888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = 255;
            p += 3;
        }
        return dst;
    } else if (fmt === ImageFormat.BGRA8888) {
        // BGRA888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = src.getUint8(p + 3);
            p += 4;
        }
        return dst;
    } else {
        return data.createTypedArray(Uint8Array);
    }
}

const enum VTFFlags {
    POINTSAMPLE   = 0x00000001,
    TRILINEAR     = 0x00000002,
    CLAMPS        = 0x00000004,
    CLAMPT        = 0x00000008,
    SRGB          = 0x00000040,
    NOMIP         = 0x00000100,
    ONEBITALPHA   = 0x00001000,
    EIGHTBITALPHA = 0x00002000,
    ENVMAP        = 0x00004000,
}

export class VTF {
    public gfxTexture: GfxTexture | null = null;
    public gfxSampler: GfxSampler;

    public format: ImageFormat;
    public flags: VTFFlags;
    public width: number;
    public height: number;
    public depth: number;
    public numFrames: number;
    public numLevels: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, private buffer: ArrayBufferSlice | null) {
        if (buffer === null)
            return;

        const view = buffer.createDataView();

        assert(readString(buffer, 0x00, 0x04, false) === 'VTF\0');
        const versionMajor = view.getUint32(0x04, true);
        const versionMinor = view.getUint32(0x08, true);
        const headerSize = view.getUint32(0x0C, true);

        let dataIdx: number;

        if (versionMajor === 0x07) {
            assert(versionMinor >= 0x01);

            this.width = view.getUint16(0x10, true);
            this.height = view.getUint16(0x12, true);
            this.flags = view.getUint32(0x14, true);
            this.numFrames = view.getUint16(0x18, true);
            const startFrame = view.getUint16(0x1A, true);
            const reflectivityR = view.getFloat32(0x20, true);
            const reflectivityG = view.getFloat32(0x24, true);
            const reflectivityB = view.getFloat32(0x28, true);
            const bumpScale = view.getFloat32(0x30, true);
            this.format = view.getUint32(0x34, true);
            this.numLevels = view.getUint8(0x38);
            const lowresImageFormat = view.getUint32(0x39, true);
            const lowresImageWidth = view.getUint8(0x3D);
            const lowresImageHeight = view.getUint8(0x3E);

            if (versionMinor >= 0x02) {
                this.depth = Math.max(view.getUint16(0x41, true), 1);
            } else {
                this.depth = 1;
            }

            if (versionMinor >= 0x03) {
                const numResources = view.getUint32(0x44, true);
                let resourcesIdx = 0x50;

                for (let i = 0; i < numResources; i++) {
                    resourcesIdx += 0x08;
                }

                dataIdx = resourcesIdx;
            } else {
                dataIdx = 0x40;
            }

            if (lowresImageFormat !== 0xFFFFFFFF) {
                const lowresDataSize = imageFormatCalcLevelSize(lowresImageFormat, lowresImageWidth, lowresImageHeight, 1);
                const lowresData = buffer.subarray(dataIdx, lowresDataSize);
                dataIdx += lowresDataSize;
            }
        } else {
            throw "whoops";
        }

        const isCube = !!(this.flags & VTFFlags.ENVMAP);
        const srgb = !!(this.flags & VTFFlags.SRGB);
        const pixelFormat = imageFormatToGfxFormat(device, this.format, srgb);
        const dimension = isCube ? GfxTextureDimension.Cube : GfxTextureDimension.n2D;
        const faceCount = (isCube ? 6 : 1);
        const faceDataCount = (isCube ? 7 : 1);
        const descriptor: GfxTextureDescriptor = {
            dimension, pixelFormat,
            width: this.width,
            height: this.height,
            numLevels: this.numLevels,
            depth: this.depth * faceCount,
        };
        this.gfxTexture = device.createTexture(descriptor);

        const hostAccessPass = device.createHostAccessPass();
        const levelDatas: Uint8Array[] = [];

        // Mipmaps are stored from smallest to largest.
        for (let i = this.numLevels - 1; i >= 0; i--) {
            const mipWidth = Math.max(this.width >>> i, 1);
            const mipHeight = Math.max(this.height >>> i, 1);
            const faceSize = this.calcMipSize(i);
            const size = faceSize * faceCount;
            const levelData = imageFormatConvertData(device, this.format, buffer.subarray(dataIdx, size), mipWidth, mipHeight);
            dataIdx += faceSize * faceDataCount;
            levelDatas.unshift(levelData);
        }

        hostAccessPass.uploadTextureData(this.gfxTexture, 0, levelDatas);
        device.submitPass(hostAccessPass);

        const wrapS = !!(this.flags & VTFFlags.CLAMPS) ? GfxWrapMode.CLAMP : GfxWrapMode.REPEAT;
        const wrapT = !!(this.flags & VTFFlags.CLAMPT) ? GfxWrapMode.CLAMP : GfxWrapMode.REPEAT;

        const texFilter = !!(this.flags & VTFFlags.POINTSAMPLE) ? GfxTexFilterMode.POINT : GfxTexFilterMode.BILINEAR;
        const minFilter = texFilter;
        const magFilter = texFilter;
        const mipFilter = !!(this.flags & VTFFlags.NOMIP) ? GfxMipFilterMode.NO_MIP : !!(this.flags & VTFFlags.TRILINEAR) ? GfxMipFilterMode.LINEAR : GfxMipFilterMode.NEAREST;
        this.gfxSampler = cache.createSampler(device, {
            wrapS, wrapT, minFilter, magFilter, mipFilter,
            minLOD: 0, maxLOD: 100,
        });
    }

    private calcMipSize(i: number, depth: number = this.depth): number {
        const mipWidth = Math.max(this.width >>> i, 1);
        const mipHeight = Math.max(this.height >>> i, 1);
        const mipDepth = Math.max(depth >>> i, 1);
        return imageFormatCalcLevelSize(this.format, mipWidth, mipHeight, mipDepth);
    }

    public fillTextureMapping(m: TextureMapping): void {
        m.gfxTexture = this.gfxTexture;
        m.gfxSampler = this.gfxSampler;
        m.width = this.width;
        m.height = this.height;
    }

    public isTranslucent(): boolean {
        return !!(this.flags & (VTFFlags.ONEBITALPHA | VTFFlags.EIGHTBITALPHA));
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
    }
}
