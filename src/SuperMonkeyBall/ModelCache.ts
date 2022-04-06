import { ModelInst } from "./ModelInst";
import { StageData } from "./Render";
import * as Gcmf from "./Gcmf";
import { calcMipChain, TextureInputGX } from "../gx/gx_texture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { nArray } from "../util";
import { LoadedTexture } from "../TextureHolder";
import { loadTextureFromMipChain } from "../gx/gx_render";

export class TextureCache {
    private cache: (LoadedTexture | null)[];

    constructor(private tpl: TextureInputGX[]) {
        this.cache = nArray(tpl.length, () => null);
    }

    public getTexture(device: GfxDevice, idx: number): LoadedTexture {
        const tex = this.cache[idx];
        if (tex === null) {
            // Load texture
            const mipChain = calcMipChain(
                this.tpl[idx],
                this.tpl[idx].mipCount
            );
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
        // todo(complexplane): Actually add models
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (entry.gma.has(modelName)) {
                if (entry.modelCache.has(modelName)) {
                    return entry.modelCache.get(modelName);
                }
                // todo(complexplane): Create model and return it
            }
        }

        return null;
    }
}
