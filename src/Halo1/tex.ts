
import { BitmapFormat, HaloBitmapMetadata, HaloSceneManager, HaloBitmap, HaloBitmapReader } from "../../rust/pkg";
import { TextureMapping } from "../TextureHolder";
import { makeSolidColorTexture2D } from "../gfx/helpers/TextureHelpers";
import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode, GfxTextureDimension, GfxTextureUsage, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxSampler, GfxTexture } from "../gfx/platform/GfxPlatformImpl";
import { wasm } from "./scenes";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

function getImageFormatBPP(fmt: GfxFormat): number {
    switch (fmt) {
        case GfxFormat.U8_RGBA_NORM: return 4;
        case GfxFormat.U16_RGB_565: return 2;
        default:
            throw new Error(`don't recognize format ${GfxFormat[fmt]}`);
    }
}

function isimageFormatCompressed(format: GfxFormat): boolean {
    return format === GfxFormat.BC1 || format === GfxFormat.BC2 || format === GfxFormat.BC3;
}

function getBitmapTextureFormat(format: BitmapFormat): GfxFormat {
    switch (format) {
        case wasm().BitmapFormat.Dxt1: return GfxFormat.BC1;
        case wasm().BitmapFormat.Dxt3: return GfxFormat.BC2;
        case wasm().BitmapFormat.Dxt5: return GfxFormat.BC3;
        case wasm().BitmapFormat.R5g6b5: return GfxFormat.U16_RGB_565;
        // formats we convert to U8_RGBA_NORM
        case wasm().BitmapFormat.X8r8g8b8:
        case wasm().BitmapFormat.A8r8g8b8:
        case wasm().BitmapFormat.A8:
        case wasm().BitmapFormat.P8:
        case wasm().BitmapFormat.P8Bump:
        case wasm().BitmapFormat.Y8:
        case wasm().BitmapFormat.A8y8:
            return GfxFormat.U8_RGBA_NORM;
        default:
            throw new Error(`couldn't recognize bitmap format ${wasm().BitmapFormat[format]}`);
    }
}

function getImageFormatByteLength(fmt: GfxFormat, width: number, height: number): number {
    if (isimageFormatCompressed(fmt)) {
        width = Math.max(width, 4);
        height = Math.max(height, 4);
        const count = ((width * height) / 16);
        if (fmt === GfxFormat.BC1)
            return count * 8;
        else if (fmt === GfxFormat.BC2)
            return count * 16;
        else if (fmt === GfxFormat.BC3)
            return count * 16;
        else
            throw new Error(`unrecognized compressed format ${GfxFormat[fmt]}`)
    } else {
        return (width * height) * getImageFormatBPP(fmt);
    }
}

function getTextureDimension(type: number): GfxTextureDimension {
    if (type === wasm().BitmapDataType.CubeMap)
        return GfxTextureDimension.Cube;
    else if (type === wasm().BitmapDataType.Tex2D)
        return GfxTextureDimension.n2D;
    else
        throw "whoops";
}

function makeTexture(device: GfxDevice, bitmap: HaloBitmap, mgr: HaloSceneManager, bitmapReader: HaloBitmapReader, submap = 0): GfxTexture {
    const bitmapMetadata = bitmap.get_metadata_for_index(submap);
    let bitmapData;
    if (bitmapMetadata.is_external()) {
        bitmapData = bitmapReader.get_and_convert_bitmap_data(bitmap, submap);
    } else {
        bitmapData = mgr.get_and_convert_bitmap_data(bitmap, submap);
    }
    const format = getBitmapTextureFormat(bitmapMetadata.format);
    const mipmapCount = Math.max(bitmapMetadata.mipmap_count, 1);

    const dimension = getTextureDimension(bitmapMetadata.bitmap_type);
    let depth = 1;
    if (dimension === GfxTextureDimension.Cube)
        depth *= 6;

    const textureDescriptor = {
        dimension,
        pixelFormat: format,
        width: bitmapMetadata.width,
        height: bitmapMetadata.height,
        numLevels: mipmapCount,
        depth,
        usage: GfxTextureUsage.Sampled,
    };

    const texture = device.createTexture(textureDescriptor!);
    const levelDatas = [];
    let byteOffset = 0;
    let w = bitmapMetadata.width;
    let h = bitmapMetadata.height;
    for (let i = 0; i < mipmapCount; i++) {
        const sliceByteLength = getImageFormatByteLength(format, w, h);

        let buffer = new ArrayBufferSlice(bitmapData.buffer, byteOffset, sliceByteLength * depth);
        if (dimension === GfxTextureDimension.Cube) {
            // Rearrange cubemaps. Need to swap 1st and 2nd face.
            // TODO: Maybe it makes more sense to do this in Rust?

            const newData = new Uint8Array(buffer.copyToBuffer());

            const face1Offs = 1 * sliceByteLength;
            const face2Offs = 2 * sliceByteLength;
            newData.set(buffer.subarray(face2Offs, sliceByteLength).createTypedArray(Uint8Array), face1Offs);
            newData.set(buffer.subarray(face1Offs, sliceByteLength).createTypedArray(Uint8Array), face2Offs);

            buffer = new ArrayBufferSlice(newData.buffer);
        }

        let levelData: ArrayBufferView;
        if (format === GfxFormat.U16_RGB_565) {
            levelData = buffer.createTypedArray(Uint16Array);
        } else {
            levelData = buffer.createTypedArray(Uint8Array);
        }

        levelDatas.push(levelData);

        byteOffset += sliceByteLength * depth;
        w = Math.max(w >>> 1, 1);
        h = Math.max(h >>> 1, 1);
    }

    device.uploadTextureData(texture, 0, levelDatas);
    return texture;
}

export interface SamplerSettings {
    wrap: boolean;
}

export class TextureCache {
    public textures: Map<string, GfxTexture>;
    public default2DTexture: GfxTexture;

    constructor(private renderCache: GfxRenderCache, public mgr: HaloSceneManager, public bitmapReader: HaloBitmapReader) {
        this.textures = new Map();
        this.default2DTexture = makeSolidColorTexture2D(renderCache.device, {
            r: 0.5,
            g: 0.5,
            b: 0.5,
            a: 1.0,
        });
    }

    public getTexture(bitmap: HaloBitmap | undefined, submap = 0): GfxTexture {
        if (!bitmap) {
            return this.default2DTexture;
        }

        const key: string = `${bitmap.get_tag_id()}_${submap}`;
        if (this.textures.has(key)) {
            return this.textures.get(key)!;
        } else {
            const texture = makeTexture(this.renderCache.device, bitmap, this.mgr, this.bitmapReader, submap);
            this.textures.set(key, texture);
            return texture;
        }
    }

    public getSampler(samplerSettings: SamplerSettings): GfxSampler {
        return this.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: samplerSettings.wrap ? GfxWrapMode.Repeat : GfxWrapMode.Clamp,
            wrapT: samplerSettings.wrap ? GfxWrapMode.Repeat : GfxWrapMode.Clamp,
        });
    }

    public getTextureMapping(bitmap: HaloBitmap | undefined, submap = 0, samplerSettings: SamplerSettings = { wrap: true }): TextureMapping {
        const mapping = new TextureMapping();
        mapping.gfxTexture = this.getTexture(bitmap, submap);
        mapping.gfxSampler = this.getSampler(samplerSettings);
        return mapping;
    }

    public destroy(device: GfxDevice) {
        device.destroyTexture(this.default2DTexture);
        for (let tex of this.textures.values()) {
            device.destroyTexture(tex);
        }
    }
}
