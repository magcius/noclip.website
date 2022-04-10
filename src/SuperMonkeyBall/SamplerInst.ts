// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode } from "../gfx/platform/GfxPlatform";
import { GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { LoadedTexture, TextureMapping } from "../TextureHolder";
import * as Gcmf from "./Gcmf";
import * as GX from "../gx/gx_enum";
import { TextureHolder } from "./ModelCache";
import { translateWrapModeGfx } from "../gx/gx_render";

function translateAVTexFilterGfx(mipmapAV: number): [GfxTexFilterMode, GfxMipFilterMode] {
    // "Debug Mode" Menu showing like this
    // 0x00: "LINER & MIPMAP NEAR, LINER"  (mipmap: 0) linear?
    // 0x01: "LINER & MIPMAP LINER, LINER" (mipmap: 1) binear?
    // 0x02: "LINER & MIPMAP LINER, LINER" (mipmap: 3) trilinear?
    // 0x04: "LINER & MIPMAP LINER, LINER"
    // 0x08: "NEAR & MIPMAP NEAR, NEAR (NEAR FLAG)" (mipmap: 0)
    // 0x10: "LINER & MIPMAP NEAR, LINER"
    let texFilter = GfxTexFilterMode.Bilinear;
    let MipFilter = GfxMipFilterMode.NoMip;

    if ((mipmapAV & (1 << 1)) !== 0) {
        texFilter = GfxTexFilterMode.Bilinear; // TODO(complexplane): Redundant?
        MipFilter = GfxMipFilterMode.Linear;
    }

    return [texFilter, MipFilter];
}

export class SamplerInst {
    private loadedTex: LoadedTexture;
    private gfxSampler: GfxSampler;

    constructor(device: GfxDevice, public samplerData: Gcmf.Sampler, textureHolder: TextureHolder) {
        this.loadedTex = textureHolder.getTexture(device, samplerData.gxTexture);

        const uvWrap = samplerData.uvWrap;
        const wrapS = (uvWrap >> 2) & (0x03 as GX.WrapMode);
        const wrapT = (uvWrap >> 4) & (0x03 as GX.WrapMode);

        const [minFilter, mipFilter] = translateAVTexFilterGfx(samplerData.mipmapAV);
        const [magFilter] = translateAVTexFilterGfx(samplerData.mipmapAV);

        const width = samplerData.gxTexture.width;
        const height = samplerData.gxTexture.height;
        let maxLod;
        if (width !== height) {
            maxLod = 0;
        } else if (samplerData.maxMipLod === 15) {
            // Use 16x16 as the max LOD
            const minDim = Math.min(width, height);
            maxLod = Math.max(0, Math.log2(minDim) - 4);
        } else {
            maxLod = samplerData.maxMipLod;
        }

        this.gfxSampler = device.createSampler({
            wrapS: translateWrapModeGfx(wrapS),
            wrapT: translateWrapModeGfx(wrapT),
            minFilter,
            mipFilter,
            magFilter,
            minLOD: 0,
            maxLOD: maxLod,
        });
    }

    public fillTextureMapping(mapping: TextureMapping): void {
        mapping.gfxTexture = this.loadedTex.gfxTexture;
        mapping.gfxSampler = this.gfxSampler;
    }

    public destroy(device: GfxDevice): void {
        // GfxTexture is destroyed in TextureCache
        device.destroySampler(this.gfxSampler);
    }
}
