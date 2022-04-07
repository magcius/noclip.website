import { ModelInst } from "./ModelInst";
import * as Gcmf from "./Gcmf";
import { calcMipChain, TextureInputGX } from "../gx/gx_texture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { assert, assertExists, nArray } from "../util";
import { LoadedTexture } from "../TextureHolder";
import { loadTextureFromMipChain } from "../gx/gx_render";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { StageData } from "./World";
import { AVTpl } from "./AVTpl";

// Cache loaded models by name and textures by index in TPL. Not much advantage over loading
// everything at once but oh well.

export class TextureCache {
    private cache: Map<number, LoadedTexture>;

    constructor(private tpl: AVTpl) {
        this.cache = new Map();
    }

    public getTexture(device: GfxDevice, idx: number): LoadedTexture {
        const loadedTex = this.cache.get(idx);
        if (loadedTex === undefined) {
            const gxTex = assertExists(this.tpl.get(idx));
            const mipChain = calcMipChain(gxTex, gxTex.mipCount);
            const freshTex = loadTextureFromMipChain(device, mipChain);
            this.cache.set(idx, freshTex);
            return freshTex;
        }
        return loadedTex;
    }

    public destroy(device: GfxDevice): void {
        this.cache.forEach((tex) => device.destroyTexture(tex.gfxTexture));
    }
}

class CacheEntry {
    public modelCache: Map<string, ModelInst>;
    public texCache: TextureCache;

    constructor(public gma: Gcmf.Gma, tpl: AVTpl) {
        this.modelCache = new Map<string, ModelInst>();
        this.texCache = new TextureCache(tpl);
    }
}

export class ModelCache {
    // Earlier appearance in this list is higher search precedence
    private entries: CacheEntry[];

    constructor(stageData: StageData) {
        this.entries = [
            new CacheEntry(stageData.stageGma, stageData.stageTpl),
            new CacheEntry(stageData.bgGma, stageData.bgTpl),
        ];
    }

    public getModel(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        modelName: string
    ): ModelInst | null {
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            const modelData = entry.gma.get(modelName);
            if (modelData !== undefined) {
                const modelInst = entry.modelCache.get(modelName);
                if (modelInst !== undefined) {
                    return modelInst;
                }
                const freshModelInst = new ModelInst(
                    device,
                    renderCache,
                    modelData,
                    entry.texCache
                );
                entry.modelCache.set(modelName, freshModelInst);
                return freshModelInst;
            }
        }

        return null;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.entries.length; i++) {
            this.entries[i].modelCache.forEach((model) => model.destroy(device));
            this.entries[i].texCache.destroy(device);
        }
    }
}
