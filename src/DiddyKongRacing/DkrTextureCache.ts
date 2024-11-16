
import { DkrTexture } from './DkrTexture.js';
import { DataManager } from "./DataManager.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";

export class DkrTextureCache {
    private textures3d = new Map<number, DkrTexture>();
    private textures2d = new Map<number, DkrTexture>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private dataManager: DataManager) {
    }

    // Speed up level loading by preloading all the level textures in advance.
    public async preload3dTextures(indices: number[], callback: Function) {
        const imageDatas = await Promise.all(indices.map((index) => {
            return this.dataManager.get3dTexture(index);
        }));

        for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            if (this.textures3d.has(index))
                continue;

            const header = this.dataManager.get3dTextureHeader(index).createTypedArray(Uint8Array);
            const imageData = imageDatas[i];
            this.textures3d.set(index, new DkrTexture(this.device, this.cache, imageData.data, header, `DkrTexture 3D ${index}`));
        }

        callback();
    }

    // 3D texture = texture used mainly in 3d geometry.
    public get3dTexture(index: number, callback: (texture: DkrTexture) => void): void {
        if (this.textures3d.has(index)) {
            callback(this.textures3d.get(index)!);
        } else {
            this.dataManager.get3dTexture(index).then((tex) => {
                if (!this.textures3d.has(index)) {
                    const headerData = this.dataManager.get3dTextureHeader(index).createTypedArray(Uint8Array);
                    this.textures3d.set(index, new DkrTexture(this.device, this.cache, tex.data, headerData, `DkrTexture 3D ${index}`));
                }

                callback(this.textures3d.get(index)!);
            });
        }
    }

    // 2D texture = texture used mainly in sprites & particles.
    public get2dTexture(index: number, callback: Function): void {
        if (this.textures2d.has(index)) {
            callback(this.textures2d.get(index)!);
        } else {
            this.dataManager.get2dTexture(index).then((tex) => {
                if (!this.textures2d.has(index)) {
                    const headerData = this.dataManager.get2dTextureHeader(index).createTypedArray(Uint8Array);
                    this.textures2d.set(index, new DkrTexture(this.device, this.cache, tex.data, headerData, `DkrTexture 2D ${index}`));
                }

                callback(this.textures2d.get(index)!);
            });
        }
    }

    public advanceTextureFrames(deltaTime: number): void {
        for (const v of this.textures3d.values())
            v.advanceFrame(deltaTime);
    }

    public scrollTextures(texScrollers: { texIndex: number, scrollU: number, scrollV: number }[], dt: number): void {
        for (const texScroller of texScrollers) {
            if (this.textures3d.has(texScroller.texIndex)) {
                const tex = this.textures3d.get(texScroller.texIndex)!;
                tex.scrollTexture(texScroller.scrollU, texScroller.scrollV, dt);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.textures3d.values())
            v.destroy(device);
        for (const v of this.textures2d.values())
            v.destroy(device);
    }
}
