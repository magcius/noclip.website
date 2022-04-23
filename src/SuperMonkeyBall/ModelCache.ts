import { ModelInst } from "./Model";
import * as Gma from "./Gma";
import { calcMipChain, TextureInputGX } from "../gx/gx_texture";
import { GfxCullMode, GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { assert, assertExists, nArray } from "../util";
import { LoadedTexture } from "../TextureHolder";
import { loadTextureFromMipChain } from "../gx/gx_render";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { StageData } from "./World";
import { AVTpl } from "./AVTpl";
import * as UI from "../ui";
import * as Viewer from "../viewer";
import { GXMaterialHacks } from "../gx/gx_material";

// Cache loaded models by name and textures by unique name. Not much advantage over loading
// everything at once but oh well.

export class TextureHolder implements UI.TextureListHolder {
    public viewerTextures: Viewer.Texture[] = [];
    public onnewtextures: (() => void) | null = null;
    private cache: Map<string, LoadedTexture> = new Map();

    getTexture(device: GfxDevice, gxTexture: TextureInputGX): LoadedTexture {
        const loadedTex = this.cache.get(gxTexture.name);
        if (loadedTex === undefined) {
            const mipChain = calcMipChain(gxTexture, gxTexture.mipCount);
            const freshTex = loadTextureFromMipChain(device, mipChain);
            this.cache.set(gxTexture.name, freshTex);
            return freshTex;
        }
        return loadedTex;
    }

    public updateViewerTextures(): void {
        const nameList = Array.from(this.cache.keys()).sort();
        this.viewerTextures = nameList.map(
            (name) => assertExists(this.cache.get(name)).viewerTexture
        );
        if (this.onnewtextures !== null) {
            this.onnewtextures();
        }
    }

    public destroy(device: GfxDevice): void {
        for (const loadedTex of this.cache.values()) {
            device.destroyTexture(loadedTex.gfxTexture);
        }
    }
}

class CacheEntry {
    public modelCache: Map<string, ModelInst>;

    constructor(public gma: Gma.Gma) {
        this.modelCache = new Map();
    }
}

export class ModelCache {
    // Earlier appearance in this list is higher search precedence
    private entries: CacheEntry[];
    private textureHolder: TextureHolder;

    constructor(stageData: StageData) {
        this.entries = [new CacheEntry(stageData.stageGma), new CacheEntry(stageData.bgGma)];
        this.textureHolder = new TextureHolder();
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
                    this.textureHolder
                );
                entry.modelCache.set(modelName, freshModelInst);
                return freshModelInst;
            }
        }

        return null;
    }

    public getTextureHolder(): TextureHolder {
        return this.textureHolder;
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.entries.length; i++) {
            for (const model of this.entries[i].modelCache.values()) {
                model.setMaterialHacks(hacks);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.entries.length; i++) {
            this.entries[i].modelCache.forEach((model) => model.destroy(device));
        }
        this.textureHolder.destroy(device);
    }
}
