
import { saturate } from "../../MathHelpers.js";
import { TextureMapping } from "../../TextureHolder.js";
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxWrapMode } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { assert, nArray } from "../../util.js";
import { LightmapPacker, LightmapPackerPage, FaceLightmapData } from "../BSPFile.js";
import { SourceRenderContext } from "../Main.js";
import { RGBM_SCALE } from "./MaterialBase.js";

class LightmapPage {
    public gfxTexture: GfxTexture;
    public data: Uint8Array;
    public uploadDirty = false;

    constructor(device: GfxDevice, public page: LightmapPackerPage) {
        const width = this.page.width, height = this.page.height, numSlices = 4;

        // RGBM seems to be good enough for all devices
        const pixelFormat = GfxFormat.U8_RGBA_NORM;
        this.data = new Uint8Array(width * height * numSlices * 4);

        this.gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2DArray,
            usage: GfxTextureUsage.Sampled,
            pixelFormat,
            width: page.width,
            height: page.height,
            depthOrArrayLayers: numSlices,
            numLevels: 1,
        });

        const fillEmptySpaceWithPink = false;
        if (fillEmptySpaceWithPink) {
            for (let i = 0; i < width * height * numSlices * 4; i += 4) {
                this.data[i+0] = 0xFF;
                this.data[i+1] = 0x00;
                this.data[i+2] = 0xFF;
                this.data[i+3] = 0xFF;
            }
        }
    }

    public prepareToRender(device: GfxDevice): void {
        const data = this.data;

        if (this.uploadDirty) {
            // TODO(jstpierre): Sub-data resource uploads? :/
            device.uploadTextureData(this.gfxTexture, 0, [data]);
            this.uploadDirty = false;
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class LightmapManager {
    private lightmapPages: LightmapPage[] = [];
    public gfxSampler: GfxSampler;
    public scratchpad = new Float32Array(4 * 128 * 128 * 3);
    public pageWidth = 2048;
    public pageHeight = 2048;

    constructor(private device: GfxDevice, cache: GfxRenderCache) {
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    public fillTextureMapping(m: TextureMapping, lightmapPageIndex: number | null): void {
        if (lightmapPageIndex === null)
            return;

        m.gfxTexture = this.getPageTexture(lightmapPageIndex);
        m.gfxSampler = this.gfxSampler;
    }

    public appendPackerPages(manager: LightmapPacker): number {
        const startPage = this.lightmapPages.length;
        for (let i = 0; i < manager.pages.length; i++)
            this.lightmapPages.push(new LightmapPage(this.device, manager.pages[i]));
        return startPage;
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].prepareToRender(device);
    }

    public getPage(pageIndex: number): LightmapPage {
        return this.lightmapPages[pageIndex];
    }

    public getPageTexture(pageIndex: number): GfxTexture {
        return this.lightmapPages[pageIndex].gfxTexture;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].destroy(device);
    }
}

// Convert from RGBM-esque storage to linear light
export function unpackColorRGBExp32(v: number, exp: number): number {
    // exp comes in unsigned, sign extend
    exp = (exp << 24) >> 24;
    const m = Math.pow(2.0, exp) / 0xFF;
    return v * m;
}

function lightmapAccumLight(dst: Float32Array, dstOffs: number, src: Uint8Array, srcOffs: number, size: number, m: number): void {
    if (m <= 0.0)
        return;

    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], exp = src[srcOffs + i + 3];
        dst[dstOffs++] += m * unpackColorRGBExp32(sr, exp);
        dst[dstOffs++] += m * unpackColorRGBExp32(sg, exp);
        dst[dstOffs++] += m * unpackColorRGBExp32(sb, exp);
    }
}

function packRGBM(dst: Uint8Array, dstOffs: number, r: number, g: number, b: number): number {
    const scale = 1.0 / RGBM_SCALE;
    r = saturate(r * scale);
    g = saturate(g * scale);
    b = saturate(b * scale);

    const mul = Math.ceil(saturate(Math.max(r, g, b, 1.0e-6)) * 255.0) / 255.0;
    const m = 1.0 / mul;
    r *= m;
    g *= m;
    b *= m;

    dst[dstOffs++] = r * 0xFF;
    dst[dstOffs++] = g * 0xFF;
    dst[dstOffs++] = b * 0xFF;
    dst[dstOffs++] = mul * 0xFF;
    return 4;
}

function lightmapPackRuntime(dstPage: LightmapPage, location: Readonly<FaceLightmapData>, src: Float32Array, srcOffs: number): void {
    const dst = dstPage.data;
    const dstWidth = dstPage.page.width;

    for (let dstY = 0; dstY < location.height; dstY++) {
        for (let dstX = 0; dstX < location.width; dstX++) {
            let sr = src[srcOffs++], sg = src[srcOffs++], sb = src[srcOffs++];
            let dstOffs = ((location.pagePosY + dstY) * dstWidth + location.pagePosX + dstX) * 4;
            dstOffs += packRGBM(dst, dstOffs, sr, sg, sb);
        }
    }
}

function lightmapPackRuntimeWhite(dstPage: LightmapPage, location: Readonly<FaceLightmapData>): void {
    const dst = dstPage.data;
    const dstWidth = dstPage.page.width;

    for (let dstY = 0; dstY < location.height; dstY++) {
        for (let dstX = 0; dstX < location.width; dstX++) {
            let dstOffs = ((location.pagePosY + dstY) * dstWidth + location.pagePosX + dstX) * 4;
            dstOffs += packRGBM(dst, dstOffs, 1.0, 1.0, 1.0);
        }
    }
}

function lightmapPackRuntimeBumpmap(dstPage: LightmapPage, location: Readonly<FaceLightmapData>, src: Float32Array, srcOffs: number): void {
    const dst = dstPage.data;
    const srcTexelCount = location.width * location.height;
    const srcSize = srcTexelCount * 3;
    const dstWidth = dstPage.page.width, dstHeight = dstPage.page.height;
    const dstSize = dstWidth * dstHeight * 4;

    let srcOffs0 = srcOffs, srcOffs1 = srcOffs + srcSize * 1, srcOffs2 = srcOffs + srcSize * 2, srcOffs3 = srcOffs + srcSize * 3;
    for (let dstY = 0; dstY < location.height; dstY++) {
        for (let dstX = 0; dstX < location.width; dstX++) {
            let dstOffs = ((location.pagePosY + dstY) * dstWidth + location.pagePosX + dstX) * 4;
            let dstOffs0 = dstOffs, dstOffs1 = dstOffs + dstSize * 1, dstOffs2 = dstOffs + dstSize * 2, dstOffs3 = dstOffs + dstSize * 3;

            const s0r = src[srcOffs0++], s0g = src[srcOffs0++], s0b = src[srcOffs0++];

            // Lightmap 0 is easy (unused tho).
            dstOffs0 += packRGBM(dst, dstOffs0, s0r, s0g, s0b);

            // Average the bumped colors to normalize (this math is very wrong, but it's what Valve appears to do)
            let s1r = src[srcOffs1++], s1g = src[srcOffs1++], s1b = src[srcOffs1++];
            let s2r = src[srcOffs2++], s2g = src[srcOffs2++], s2b = src[srcOffs2++];
            let s3r = src[srcOffs3++], s3g = src[srcOffs3++], s3b = src[srcOffs3++];

            let sr = (s1r + s2r + s3r) / 3.0;
            let sg = (s1g + s2g + s3g) / 3.0;
            let sb = (s1b + s2b + s3b) / 3.0;

            if (sr !== 0.0)
                sr = s0r / sr;
            if (sg !== 0.0)
                sg = s0g / sg;
            if (sb !== 0.0)
                sb = s0b / sb;

            dstOffs1 += packRGBM(dst, dstOffs1, s1r * sr, s1g * sg, s1b * sb);
            dstOffs2 += packRGBM(dst, dstOffs2, s2r * sr, s2g * sg, s2b * sb);
            dstOffs3 += packRGBM(dst, dstOffs3, s3r * sr, s3g * sg, s3b * sb);
        }
    }
}


export class FaceLightmap {
    // The styles that we built our lightmaps for.
    public lightmapStyleIntensities: number[];

    constructor(public lightmapData: FaceLightmapData, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.lightmapStyleIntensities = nArray(this.lightmapData.styles.length, () => -1);
    }

    public checkDirty(renderContext: SourceRenderContext): boolean {
        const worldLightingState = renderContext.worldLightingState;

        if (!this.wantsLightmap)
            return false;

        for (let i = 0; i < this.lightmapData.styles.length; i++) {
            const styleIdx = this.lightmapData.styles[i];
            if (worldLightingState.styleIntensities[styleIdx] !== this.lightmapStyleIntensities[i])
                return true;
        }

        return false;
    }

    public buildLightmap(renderContext: SourceRenderContext, managerPageIndex: number): void {
        const worldLightingState = renderContext.worldLightingState;
        const scratchpad = renderContext.lightmapManager.scratchpad;

        const dstPage = renderContext.lightmapManager.getPage(managerPageIndex);
        const hasLightmap = this.lightmapData.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const texelCount = this.lightmapData.width * this.lightmapData.height;
            const srcNumLightmaps = (this.wantsBumpmap && this.lightmapData.hasBumpmapSamples) ? 4 : 1;
            const srcSize = srcNumLightmaps * texelCount * 4;

            scratchpad.fill(0);
            assert(scratchpad.byteLength >= srcSize);

            let srcOffs = 0;
            for (let i = 0; i < this.lightmapData.styles.length; i++) {
                const styleIdx = this.lightmapData.styles[i];
                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lightmapData.samples!, srcOffs, srcSize, intensity);
                srcOffs += srcSize;
                this.lightmapStyleIntensities[i] = intensity;
            }

            if (this.wantsBumpmap && !this.lightmapData.hasBumpmapSamples) {
                // Game wants bumpmap samples but has none. Copy from primary lightsource.
                const src = new Float32Array(scratchpad.buffer, 0, srcSize * 3);
                for (let i = 1; i < 4; i++) {
                    const dst = new Float32Array(scratchpad.buffer, i * srcSize * 3, srcSize * 3);
                    dst.set(src);
                }
            }

            if (this.wantsBumpmap) {
                lightmapPackRuntimeBumpmap(dstPage, this.lightmapData, scratchpad, 0);
            } else {
                lightmapPackRuntime(dstPage, this.lightmapData, scratchpad, 0);
            }
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
            lightmapPackRuntimeWhite(dstPage, this.lightmapData);
        }

        dstPage.uploadDirty = true;
        renderContext.debugStatistics.lightmapsBuilt++;
    }
}
