
// Code ported and subsequently butchered from https://github.com/halogenica/FezViewer
import { vec3 } from 'gl-matrix';
import { GfxDevice, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../../gfx/platform/GfxPlatform';
import { makeTextureFromXNA_Texture2D } from './Texture';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { Fez_TrileSet, Fez_Trile } from './XNB_Fez';
import { GeometryData } from './GeometryData';

export class TrileData {
    public geometry: GeometryData;

    constructor(device: GfxDevice, cache: GfxRenderCache, public trile: Fez_Trile) {
        this.geometry = new GeometryData(device, cache, trile.geometry);
    }

    public destroy(device: GfxDevice): void {
        this.geometry.destroy(device);
    }
}

export class TrilesetData {
    public triles = new Map<number, TrileData>();
    public texture: GfxTexture;
    public sampler: GfxSampler;

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, trileset: Fez_TrileSet) {
        this.texture = makeTextureFromXNA_Texture2D(device, trileset.textureAtlas);

        this.sampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        for (const [k, v] of trileset.triles.entries())
            this.triles.set(k, new TrileData(device, cache, v));
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);

        for (const v of this.triles.values())
            v.destroy(device);
    }
}
