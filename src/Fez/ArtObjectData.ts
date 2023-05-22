
import { GfxTexture, GfxDevice, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import { makeTextureFromXNA_Texture2D } from "./Texture";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { Fez_ArtObject } from "./XNB_Fez";
import { GeometryData } from "./GeometryData";

export class ArtObjectData {
    public indexCount: number;
    public texture: GfxTexture;
    public sampler: GfxSampler;
    public geometry: GeometryData;

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, data: Fez_ArtObject) {
        this.texture = makeTextureFromXNA_Texture2D(device, data.futureCubeMap);
        this.sampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        this.geometry = new GeometryData(device, cache, data.geometry);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
        this.geometry.destroy(device);
    }
}
