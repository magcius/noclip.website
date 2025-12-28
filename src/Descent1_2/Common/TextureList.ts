import { vec2 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { TransparentBlack } from "../../Color";
import { makeSolidColorTexture2D } from "../../gfx/helpers/TextureHelpers";
import {
    GfxDevice,
    GfxFormat,
    GfxTexture,
    makeTextureDescriptor2D,
} from "../../gfx/platform/GfxPlatform";
import { Destroyable } from "../../SceneBase";
import { DescentAssetCache, DescentGfxTexture } from "./AssetCache";
import {
    BITMAP_FLAG_SUPER_TRANSPARENT,
    BITMAP_FLAG_TRANSPARENT,
    DescentPalette,
    DescentVClip,
} from "./AssetTypes";
import { CacheMap } from "./Util";

export type StaticTexture = {
    animated?: false;
    textureIndex: number;
    slide: vec2;
};

export type AnimatedTexture = {
    animated: true;
    timeMultiplier: number;
    textureIndices: number[];
    slide: vec2;
};

export type VclipTexture = {
    animated: true;
    timeMultiplier: number;
    textureIndices: number[];
    slide: vec2;
    vclip: DescentVClip;
    aspectRatio: number;
};

export type ResolvedTexture = StaticTexture | AnimatedTexture | VclipTexture;

const NO_SLIDE = vec2.fromValues(0, 0);

export class DescentTextureList implements Destroyable {
    public gfxTextures: DescentGfxTexture[] = [];
    private gpuFallbackTexture: GfxTexture | null = null;
    private gpuTransparentTexture: GfxTexture | null = null;
    private pagedBitmapToTextureIndexCache: CacheMap<number, number> =
        new CacheMap();
    private tmapToTextureIdCache: CacheMap<number, ResolvedTexture> =
        new CacheMap();
    private objBitmapToTextureIdCache: CacheMap<number, ResolvedTexture> =
        new CacheMap();
    private palette: DescentPalette;

    constructor(
        private gfxDevice: GfxDevice,
        private assetCache: DescentAssetCache,
    ) {
        this.palette = this.assetCache.palette;
    }

    /** Returns a default fallback texture. */
    public getFallbackTexture(): GfxTexture {
        if (this.gpuFallbackTexture != null) return this.gpuFallbackTexture;

        const gfxTexture = this.gfxDevice.createTexture(
            makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 64, 64, 1),
        );
        const rgbaData = new Uint8Array(64 * 64 * 4);
        let dstOut = 0;
        for (let i = 0; i < 64; i++) {
            for (let j = 0; j < 64; j++) {
                // Original game uses a crossed out X texture
                const paletteIndex = i === j || i === 63 - j ? 193 : 65;
                const rgb = this.palette.data[paletteIndex];
                rgbaData[dstOut++] = rgb[0];
                rgbaData[dstOut++] = rgb[1];
                rgbaData[dstOut++] = rgb[2];
                rgbaData[dstOut++] = 255;
            }
        }
        this.gfxDevice.uploadTextureData(gfxTexture, 0, [rgbaData]);
        this.gpuFallbackTexture = gfxTexture;
        return gfxTexture;
    }

    /** Returns a transparent fallback texture. */
    public getTransparentTexture(): GfxTexture {
        if (this.gpuTransparentTexture != null)
            return this.gpuTransparentTexture;
        const texture = makeSolidColorTexture2D(
            this.gfxDevice,
            TransparentBlack,
        );
        this.gpuTransparentTexture = texture;
        return texture;
    }

    /** Load and page in bitmap data as a GPU texture. Returns `null` if bitmap not found. */
    public getBitmapAsTexture(bitmapId: number): DescentGfxTexture | null {
        const resultBitmap = this.assetCache.getBitmap(bitmapId);
        if (resultBitmap == null) return null;

        const { bitmap, data: palettizedBuffer } = resultBitmap;
        const rgbaData = new Uint8Array(bitmap.width * bitmap.height * 4);
        const palettizedData = palettizedBuffer.createTypedArray(Uint8Array);
        let dstOut = 0;
        for (let i = 0; i < palettizedData.length; i++) {
            const byte = palettizedData[i];
            const rgb = this.palette.data[byte];

            if (byte === 255 && bitmap.flags & BITMAP_FLAG_TRANSPARENT) {
                // Transparency
                rgbaData[dstOut++] = 0;
                rgbaData[dstOut++] = 0;
                rgbaData[dstOut++] = 0;
                rgbaData[dstOut++] = 0;
            } else if (
                byte === 254 &&
                bitmap.flags & BITMAP_FLAG_SUPER_TRANSPARENT
            ) {
                // Super-transparency (represent with alpha=0.5, this is handled by
                // the fragment shader in DescentMineRenderer)
                rgbaData[dstOut++] = 255;
                rgbaData[dstOut++] = 0;
                rgbaData[dstOut++] = 255;
                rgbaData[dstOut++] = 128;
            } else {
                rgbaData[dstOut++] = rgb[0];
                rgbaData[dstOut++] = rgb[1];
                rgbaData[dstOut++] = rgb[2];
                rgbaData[dstOut++] = 255;
            }
        }

        const gfxTexture = this.gfxDevice.createTexture(
            makeTextureDescriptor2D(
                GfxFormat.U8_RGBA_NORM,
                bitmap.width,
                bitmap.height,
                1,
            ),
        );
        this.gfxDevice.uploadTextureData(gfxTexture, 0, [rgbaData]);
        return {
            bitmap,
            pixels: new ArrayBufferSlice(rgbaData.buffer),
            gfxTexture,
        };
    }

    public pageInBitmap(bitmapId: number): number {
        return this.pagedBitmapToTextureIndexCache.computeIfAbsent(
            bitmapId,
            (_: any) => {
                let texture: DescentGfxTexture | null =
                    this.getBitmapAsTexture(bitmapId);
                if (texture == null) return -1; // constructor pushes fallback texture to this.texture

                const newTextureIndex = this.gfxTextures.length;
                this.gfxTextures.push(texture);
                return newTextureIndex;
            },
        );
    }

    /** Resolve texture from TMAP texture ID. */
    public resolveTmapToTexture(tmapId: number): ResolvedTexture | null {
        return this.tmapToTextureIdCache.computeIfAbsentOrNull(
            tmapId,
            (_: any) => {
                if (tmapId == null) return null;
                const baseBitmapId = this.assetCache.getTmapBitmapIndex(tmapId);

                // Get slide
                const slide = this.assetCache.getTmapSlide(tmapId);

                // Check for animation
                const animation = this.assetCache.getTmapAnimation(tmapId);
                let resolved: ResolvedTexture;
                if (
                    animation != null &&
                    Number.isFinite(animation.timeMultiplier) &&
                    animation.bitmapIds.length > 0
                ) {
                    resolved = {
                        animated: true,
                        timeMultiplier: animation.timeMultiplier,
                        textureIndices: animation.bitmapIds.map((bitmapId) =>
                            this.pageInBitmap(bitmapId),
                        ),
                        slide: vec2.fromValues(...slide),
                    };
                } else {
                    resolved = {
                        textureIndex: this.pageInBitmap(baseBitmapId),
                        slide: vec2.fromValues(...slide),
                    };
                }
                return resolved;
            },
        );
    }

    /** Resolve texture from object bitmap ID. */
    public resolveObjectBitmapToTexture(
        objectBitmapId: number | null,
    ): ResolvedTexture | null {
        if (objectBitmapId == null) return null;
        return this.objBitmapToTextureIdCache.computeIfAbsentOrNull(
            objectBitmapId,
            (_: any) => {
                // Check for animation
                const animation =
                    this.assetCache.getObjectBitmapAnimation(objectBitmapId);
                let resolved: ResolvedTexture;
                if (
                    animation != null &&
                    Number.isFinite(animation.timeMultiplier) &&
                    animation.bitmapIds.length > 0
                ) {
                    resolved = {
                        animated: true,
                        timeMultiplier: animation.timeMultiplier,
                        textureIndices: animation.bitmapIds.map((bitmapId) =>
                            this.pageInBitmap(bitmapId),
                        ),
                        slide: NO_SLIDE,
                    };
                } else {
                    resolved = {
                        textureIndex: this.pageInBitmap(
                            this.assetCache.getObjectBitmapId(objectBitmapId),
                        ),
                        slide: NO_SLIDE,
                    };
                }
                return resolved;
            },
        );
    }

    /** Resolve texture from VCLIP ID. */
    public resolveVclipToTexture(vclipId: number): VclipTexture | null {
        const animation = this.assetCache.getVClipAnimation(vclipId);
        if (
            animation == null ||
            !Number.isFinite(animation.timeMultiplier) ||
            animation.bitmapIds.length === 0
        )
            return null;

        const bitmap = this.assetCache.getBitmap(
            animation.bitmapIds[0],
        )!.bitmap;
        if (bitmap == null) return null;

        return {
            animated: true,
            timeMultiplier: animation.timeMultiplier,
            textureIndices: animation.bitmapIds.map((bitmapId) =>
                this.pageInBitmap(bitmapId),
            ),
            vclip: animation.vclip,
            slide: NO_SLIDE,
            aspectRatio: bitmap.width / bitmap.height,
        };
    }

    /** Returns the GfxTexture to use for the specified ResolvedTexture at a given point in seconds. */
    public pickTexture(
        texture: ResolvedTexture | null | undefined,
        timeSeconds: number,
        fallbackTransparent?: boolean,
    ) {
        const fallback = fallbackTransparent
            ? () => this.getTransparentTexture()
            : () => this.getFallbackTexture();
        if (texture == null) return fallback();
        if (texture.animated) {
            const rollIndex =
                ((timeSeconds * texture.timeMultiplier) %
                    texture.textureIndices.length) |
                0;
            const textureId = texture.textureIndices[rollIndex];
            return this.gfxTextures[textureId]?.gfxTexture ?? fallback();
        } else {
            return (
                this.gfxTextures[texture.textureIndex]?.gfxTexture ?? fallback()
            );
        }
    }

    /** Returns all textures uploaded to the GPU. */
    public getAllTextures() {
        return this.gfxTextures;
    }

    public destroy(device: GfxDevice): void {
        for (const { gfxTexture } of this.gfxTextures)
            if (
                gfxTexture !== this.gpuFallbackTexture &&
                gfxTexture !== this.gpuTransparentTexture
            )
                device.destroyTexture(gfxTexture);
        this.gfxTextures.length = 0;

        if (this.gpuFallbackTexture != null)
            device.destroyTexture(this.gpuFallbackTexture);
        this.gpuFallbackTexture = null;

        if (this.gpuTransparentTexture != null)
            device.destroyTexture(this.gpuTransparentTexture);
        this.gpuTransparentTexture = null;
    }
}
