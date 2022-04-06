import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode } from "../gfx/platform/GfxPlatform";
import { GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { LoadedTexture, TextureMapping } from "../TextureHolder";
import * as Gcmf from "./Gcmf";
import * as GX from "../gx/gx_enum";
import { TextureCache } from "./ModelCache";
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
        texFilter = GfxTexFilterMode.Bilinear; // todo(complexplane): Redundant?
        MipFilter = GfxMipFilterMode.Linear;
    }

    return [texFilter, MipFilter];
}

export class SamplerInst {
    private loadedTex: LoadedTexture;
    private gfxSampler: GfxSampler;

    constructor(device: GfxDevice, public samplerData: Gcmf.Sampler, tplTexCache: TextureCache) {
        const uvWrap = samplerData.uvWrap;
        const wrapS = (uvWrap >> 2) & (0x03 as GX.WrapMode);
        const wrapT = (uvWrap >> 4) & (0x03 as GX.WrapMode);

        const [minFilter, mipFilter] = translateAVTexFilterGfx(samplerData.mipmapAV);
        const [magFilter] = translateAVTexFilterGfx(samplerData.mipmapAV);

        this.gfxSampler = device.createSampler({
            wrapS: translateWrapModeGfx(wrapS),
            wrapT: translateWrapModeGfx(wrapT),
            minFilter,
            mipFilter,
            magFilter,
            minLOD: 0,
            maxLOD: 100,
        });
    }

    public fillTextureMapping(mapping: TextureMapping): void {
        mapping.gfxTexture = this.loadedTex.gfxTexture;
        mapping.gfxSampler = this.gfxSampler;
    }
}
