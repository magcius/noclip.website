import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxTexture, GfxDevice, makeTextureDescriptor2D, GfxFormat } from "../gfx/platform/GfxPlatform";
import { readString, assert } from "../util";
import { TextureMapping } from "../TextureHolder";

const enum ImageFormat {
    RGBA8888     = 0x00,
    DXT1         = 0x0D,
    DXT3         = 0x0E,
    DXT5         = 0x0F,
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

function imageFormatToGfxFormat(fmt: ImageFormat): GfxFormat {
    if (fmt === ImageFormat.DXT1)
        return GfxFormat.BC1;
    else if (fmt === ImageFormat.DXT3)
        return GfxFormat.BC2;
    else if (fmt === ImageFormat.DXT5)
        return GfxFormat.BC3;
    else if (fmt === ImageFormat.RGBA8888)
        return GfxFormat.U8_RGBA_NORM;
    else
        throw "whoops";
}

export class VTF {
    public gfxTexture: GfxTexture | null = null;

    public format: ImageFormat;
    public flags: number;
    public width: number;
    public height: number;
    public depth: number;
    public numLevels: number;

    constructor(device: GfxDevice, buffer: ArrayBufferSlice | null) {
        if (buffer === null)
            return;

        const view = buffer.createDataView();

        assert(readString(buffer, 0x00, 0x04, false) === 'VTF\0');
        const versionMajor = view.getUint32(0x04, true);
        const versionMinor = view.getUint32(0x08, true);
        const headerSize = view.getUint32(0x0C, true);

        let dataOffs: number;
        if (versionMajor === 0x07 && versionMinor === 0x01) {
            this.width = view.getUint16(0x10, true);
            this.height = view.getUint16(0x12, true);
            this.flags = view.getUint32(0x14, true);
            const numFrames = view.getUint16(0x18, true);
            const startFrame = view.getUint16(0x1A, true);
            const reflectivityR = view.getFloat32(0x20, true);
            const reflectivityG = view.getFloat32(0x24, true);
            const reflectivityB = view.getFloat32(0x28, true);
            const bumpScale = view.getFloat32(0x30, true);
            this.format = view.getUint32(0x34, true);
            this.numLevels = view.getUint8(0x38);
            const lowresImageFormat = view.getUint32(0x39, true);
            assert(lowresImageFormat === ImageFormat.DXT1);
            const lowresImageWidth = view.getUint8(0x3D);
            const lowresImageHeight = view.getUint8(0x3E);

            let dataIdx = 0x40;

            const lowresDataSize = imageFormatCalcLevelSize(lowresImageFormat, lowresImageWidth, lowresImageHeight, 1);
            const lowresData = buffer.subarray(dataIdx, lowresDataSize);
            dataIdx += lowresDataSize;

            this.depth = 1;
            dataOffs = dataIdx;
        } else {
            throw "whoops";
        }

        const gfxFormat = imageFormatToGfxFormat(this.format);
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(gfxFormat, this.width, this.height, this.numLevels));

        const hostAccessPass = device.createHostAccessPass();
        const levelDatas: Uint8Array[] = [];

        // Mipmaps are stored from smallest to largest.
        for (let i = this.numLevels - 1; i >= 0; i--) {
            const size = this.calcMipSize(i);
            const levelData = buffer.subarray(dataOffs, size);
            dataOffs += size;
            levelDatas.unshift(levelData.createTypedArray(Uint8Array));
        }

        hostAccessPass.uploadTextureData(this.gfxTexture, 0, levelDatas);
        device.submitPass(hostAccessPass);
    }

    private calcMipSize(i: number, depth: number = this.depth): number {
        const mipWidth = Math.max(this.width >>> i, 1);
        const mipHeight = Math.max(this.height >>> i, 1);
        const mipDepth = Math.max(depth >>> i, 1);
        return imageFormatCalcLevelSize(this.format, mipWidth, mipHeight, mipDepth);
    }

    public fillTextureMapping(m: TextureMapping): void {
        m.gfxTexture = this.gfxTexture;
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
    }
}
