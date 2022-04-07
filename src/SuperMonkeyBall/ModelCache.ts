import { ModelInst } from "./ModelInst";
import { StageData } from "./Render";
import * as Gcmf from "./Gcmf";
import { calcMipChain, TextureInputGX } from "../gx/gx_texture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { nArray } from "../util";
import { LoadedTexture } from "../TextureHolder";
import { loadTextureFromMipChain } from "../gx/gx_render";

// Cache loaded models by name and textures by index in TPL. Not much advantage over loading
// everything at once but oh well.

export class TextureCache {
    private cache: (LoadedTexture | null)[];

    constructor(private tpl: TextureInputGX[]) {
        this.cache = nArray(tpl.length, () => null);
    }

    public getTexture(device: GfxDevice, idx: number): LoadedTexture {
        const tex = this.cache[idx];
        if (tex === null) {
            // Load texture
            const mipChain = calcMipChain(this.tpl[idx], this.tpl[idx].mipCount);
            const freshTex = loadTextureFromMipChain(device, mipChain);

            this.cache[idx] = freshTex;
            return freshTex;
        }
        return tex;
    }
}

class CacheEntry {
    public modelCache: Map<string, ModelInst>;
    public texCache: TextureCache;

    constructor(public gma: Gcmf.Gma, tpl: TextureInputGX[]) {
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

    public getModel(device: GfxDevice, modelName: string): ModelInst | null {
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            const modelData = entry.gma.get(modelName);
            if (modelData !== undefined) {
                const modelInst = entry.modelCache.get(modelName);
                if (modelInst !== undefined) {
                    return modelInst;
                }
                const freshModelInst = new ModelInst(device, modelData, entry.texCache);
                entry.modelCache.set(modelName, freshModelInst);
                return freshModelInst;
            }
        }

        return null;
    }
}
