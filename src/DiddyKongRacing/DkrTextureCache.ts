
import { DkrTexture } from './DkrTexture.js';
import { DataManager } from "./DataManager.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import ArrayBufferSlice from '../ArrayBufferSlice.js';

export class DkrTextureCache {
    private textures3d: { [k: string]: DkrTexture } = {};
    private textures2d: { [k: string]: DkrTexture } = {};

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private dataManager: DataManager) {
    }

    // Speed up level loading by preloading all the level textures in advance.
    public async preload3dTextures(indices: Array<number>, callback: Function) {
        const imageDatas = await Promise.all(indices.map((index) => {
            return this.dataManager.get3dTexture(index);
        }));

        for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            const header = this.dataManager.get3dTextureHeader(index).createTypedArray(Uint8Array);
            const imageData = imageDatas[i];
            this.textures3d[index] = new DkrTexture(this.device, this.cache, imageData.data, header);
        }

        callback();
    }

    // 3D texture = texture used mainly in 3d geometry.
    public get3dTexture(index: number, callback: Function): void {
        if(!!this.textures3d[index]) {
            // Texture was found in cache, so just return it.
            callback(this.textures3d[index]);
        } else {
            // Texture was not found, so it needs to be loaded.
            this.dataManager.get3dTexture(index).then((tex) => {
                if (!!this.textures3d[index]) {
                    // Texture has already been loaded, so just return it.
                    callback(this.textures3d[index]);
                } else {
                    const headerData = this.dataManager.get3dTextureHeader(index).createTypedArray(Uint8Array);
                    this.textures3d[index] = new DkrTexture(this.device, this.cache, tex.data, headerData);
                    callback(this.textures3d[index]);
                }
            });
        }
    }

    // 2D texture = texture used mainly in sprites & particles.
    public get2dTexture(index: number, callback: Function): void {
        if(!!this.textures2d[index]) {
            // Texture was found in cache, so just return it.
            callback(this.textures2d[index]);
        } else {
            // Texture was not found, so it needs to be loaded.
            this.dataManager.get2dTexture(index).then((tex) => {
                if (!!this.textures2d[index]) {
                    // Texture has already been loaded, so just return it.
                    callback(this.textures2d[index]);
                } else {
                    const headerData = this.dataManager.get2dTextureHeader(index).createTypedArray(Uint8Array);
                    this.textures2d[index] = new DkrTexture(this.device, this.cache, tex.data, headerData);
                    callback(this.textures2d[index]);
                }
            });
        }
    }

    public advanceTextureFrames(deltaTime: number): void {
        const keys = Object.keys(this.textures3d);
        for(const key of keys) {
            this.textures3d[key].advanceFrame(deltaTime);
        }
    }

    public scrollTextures(texScrollers: any, dt: number): void {
        for(const texScroller of texScrollers) {
            if(!!this.textures3d[texScroller.texIndex]){
                const tex: DkrTexture = this.textures3d[texScroller.texIndex];
                tex.scrollTexture(texScroller.scrollU, texScroller.scrollV, dt);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        const keys3d = Object.keys(this.textures3d);
        for(const key of keys3d) {
            this.textures3d[key].destroy(device);
        }
        const keys2d = Object.keys(this.textures2d);
        for(const key of keys2d) {
            this.textures2d[key].destroy(device);
        }
    }
}
