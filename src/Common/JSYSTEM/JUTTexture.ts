
import ArrayBufferSlice from "../../ArrayBufferSlice";
import * as GX from '../../gx/gx_enum';
import { assert } from "../../util";
import { GfxSampler, GfxTexture, GfxDevice } from "../../gfx/platform/GfxPlatform";
import { Texture } from "../../viewer";
import { TextureMapping } from "../../TextureHolder";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache";
import { translateTexFilterGfx, translateWrapModeGfx, loadTextureFromMipChain } from "../../gx/gx_render";
import { calcMipChain } from "../../gx/gx_texture";

export interface BTI_Texture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    minLOD: number;
    maxLOD: number;
    lodBias: number;
    mipCount: number;
    data: ArrayBufferSlice | null;

    // Palette data
    paletteFormat: GX.TexPalette;
    paletteData: ArrayBufferSlice | null;
}

export function readBTI_Texture(buffer: ArrayBufferSlice, name: string): BTI_Texture {
    const view = buffer.createDataView();

    const format: GX.TexFormat = view.getUint8(0x00);
    const width: number = view.getUint16(0x02);
    const height: number = view.getUint16(0x04);
    const wrapS: GX.WrapMode = view.getUint8(0x06);
    const wrapT: GX.WrapMode = view.getUint8(0x07);
    const paletteFormat: GX.TexPalette = view.getUint8(0x09);
    const paletteCount: number = view.getUint16(0x0A);
    const paletteOffs: number = view.getUint32(0x0C);
    const minFilter: GX.TexFilter = view.getUint8(0x14);
    const magFilter: GX.TexFilter = view.getUint8(0x15);
    const minLOD: number = view.getInt8(0x16) * 1/8;
    const maxLOD: number = view.getInt8(0x17) * 1/8;
    const mipCount: number = view.getUint8(0x18);
    const lodBias: number = view.getInt16(0x1A) * 1/100;
    const dataOffs: number = view.getUint32(0x1C);

    assert(minLOD === 0);

    let data: ArrayBufferSlice | null = null;
    if (dataOffs !== 0)
        data = buffer.slice(dataOffs);

    let paletteData: ArrayBufferSlice | null = null;
    if (paletteOffs !== 0)
        paletteData = buffer.subarray(paletteOffs, paletteCount * 2);

    return { name, format, width, height, wrapS, wrapT, minFilter, magFilter, minLOD, maxLOD, mipCount, lodBias, data, paletteFormat, paletteData };
}

export class BTI {
    public texture: BTI_Texture;

    public static parse(buffer: ArrayBufferSlice, name: string): BTI {
        const bti = new BTI();
        bti.texture = readBTI_Texture(buffer, name);
        return bti;
    }
}

export interface TEX1_SamplerSub {
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minLOD: number;
    maxLOD: number;
}

export function translateSampler(device: GfxDevice, cache: GfxRenderCache, sampler: TEX1_SamplerSub): GfxSampler {
    const [minFilter, mipFilter] = translateTexFilterGfx(sampler.minFilter);
    const [magFilter]            = translateTexFilterGfx(sampler.magFilter);

    const gfxSampler = cache.createSampler(device, {
        wrapS: translateWrapModeGfx(sampler.wrapS),
        wrapT: translateWrapModeGfx(sampler.wrapT),
        minFilter, mipFilter, magFilter,
        minLOD: sampler.minLOD,
        maxLOD: sampler.maxLOD,
    });

    return gfxSampler;
}

export class BTIData {
    private gfxSampler: GfxSampler;
    private gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    constructor(device: GfxDevice, cache: GfxRenderCache, public btiTexture: BTI_Texture) {
        this.gfxSampler = translateSampler(device, cache, btiTexture);
        const mipChain = calcMipChain(this.btiTexture, this.btiTexture.mipCount);
        const { viewerTexture, gfxTexture } = loadTextureFromMipChain(device, mipChain);
        this.gfxTexture = gfxTexture;
        this.viewerTexture = viewerTexture;
    }

    public fillTextureMapping(m: TextureMapping): boolean {
        m.gfxTexture = this.gfxTexture;
        m.gfxSampler = this.gfxSampler;
        m.lodBias = this.btiTexture.lodBias;
        m.width = this.btiTexture.width;
        m.height = this.btiTexture.height;
        return true;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}
