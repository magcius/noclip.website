// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode } from "../gfx/platform/GfxPlatform";
import { GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { LoadedTexture, TextureMapping } from "../TextureHolder";
import * as Gma from "./Gma";
import * as GX from "../gx/gx_enum";
import { TextureCache } from "./ModelCache";
import { translateWrapModeGfx } from "../gx/gx_render";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

export class TevLayerInst {
    private loadedTex: LoadedTexture;
    private gfxSampler: GfxSampler;

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        public tevLayerData: Gma.TevLayer,
        textureCache: TextureCache
    ) {
        this.loadedTex = textureCache.getTexture(device, tevLayerData.gxTexture);

        const wrapS = ((tevLayerData.flags >> 2) & 0x03) as GX.WrapMode;
        const wrapT = ((tevLayerData.flags >> 4) & 0x03) as GX.WrapMode;

        const width = tevLayerData.gxTexture.width;
        const height = tevLayerData.gxTexture.height;
        let maxLod = (tevLayerData.flags >> 7) & 0xf;
        if (width !== height) {
            maxLod = 0;
        } else if (maxLod === 15) {
            // Use 16x16 as the max LOD
            const minDim = Math.min(width, height);
            maxLod = Math.max(0, Math.log2(minDim) - 4);
        }

        this.gfxSampler = renderCache.createSampler({
            wrapS: translateWrapModeGfx(wrapS),
            wrapT: translateWrapModeGfx(wrapT),
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: maxLod === 0 ? GfxMipFilterMode.NoMip : GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: maxLod,
        });
    }

    public fillTextureMapping(mapping: TextureMapping): void {
        mapping.gfxTexture = this.loadedTex.gfxTexture;
        mapping.gfxSampler = this.gfxSampler;
    }
}
