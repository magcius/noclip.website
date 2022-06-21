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
import * as SD from "./Stagedef";

// Cache loaded models by name and textures by unique name. Not much advantage over loading
// everything at once but oh well.

export class TextureCache implements UI.TextureListHolder {
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
        this.viewerTextures = nameList.map((name) => assertExists(this.cache.get(name)).viewerTexture);
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

export const enum GmaSrc {
    Stage,
    Bg,
    Common,
    StageAndBg,
}

export class ModelCache {
    // Earlier appearance in this list is higher search precedence
    private stageEntry: CacheEntry;
    private bgEntry: CacheEntry;
    private commonEntry: CacheEntry;
    private allEntries: CacheEntry[];

    private textureCache: TextureCache;

    private blueGoalModel: ModelInst | null = null;
    private greenGoalModel: ModelInst | null = null;
    private redGoalModel: ModelInst | null = null;
    private bumperModel: ModelInst | null = null;

    constructor(private device: GfxDevice, private renderCache: GfxRenderCache, stageData: StageData) {
        this.stageEntry = new CacheEntry(stageData.stageGma);
        this.bgEntry = new CacheEntry(stageData.bgGma);
        this.commonEntry = new CacheEntry(stageData.commonGma);
        this.allEntries = [this.stageEntry, this.bgEntry, this.commonEntry];
        this.textureCache = new TextureCache();

        // TODO(complexplane): Don't do these in modelcache?
        // TODO(complexplane): The game seems to search blue goal using "GOAL" prefix instead of 2
        // different names here, but when I do that it picks green goal for blue on Labyrinth
        // because GOAL_G comes before GOAL in the GMA. How does the game actually do it?!?
        this.blueGoalModel = this.findBgSpecificModel("GOAL") || this.findBgSpecificModel("GOAL_B");
        this.greenGoalModel = this.findBgSpecificModel("GOAL_G");
        this.redGoalModel = this.findBgSpecificModel("GOAL_R");
        this.bumperModel = this.findBgSpecificModel("BUMPER_L1");
    }

    private findBgSpecificModel(postfix: string): ModelInst | null {
        for (let i = 0; i < this.allEntries.length; i++) {
            const entry = this.allEntries[i];
            for (const gma of entry.gma.idMap.values()) {
                if (gma.name.slice(4) === postfix) {
                    return this.getModelFromEntry(gma.name, entry);
                }
            }
        }
        return null;
    }

    private getModelFromEntry(model: string | number, entry: CacheEntry): ModelInst | null {
        let modelData: Gma.Model | undefined;
        if (typeof model === "number") {
            modelData = entry.gma.idMap.get(model);
        } else {
            modelData = entry.gma.nameMap.get(model);
        }
        if (modelData === undefined) {
            return null;
        }
        const modelInst = entry.modelCache.get(modelData.name);
        if (modelInst !== undefined) {
            return modelInst;
        }
        const freshModelInst = new ModelInst(this.device, this.renderCache, modelData, this.textureCache);
        entry.modelCache.set(modelData.name, freshModelInst);
        return freshModelInst;
    }

    public getModel(model: string | number, src: GmaSrc): ModelInst | null {
        switch (src) {
            case GmaSrc.Stage: {
                return this.getModelFromEntry(model, this.stageEntry);
            }
            case GmaSrc.Bg: {
                return this.getModelFromEntry(model, this.bgEntry);
            }
            case GmaSrc.Common: {
                return this.getModelFromEntry(model, this.commonEntry);
            }
            case GmaSrc.StageAndBg: {
                if (typeof model !== "string") {
                    throw new Error("Must request model by name when searching in multiple sources");
                }
                return this.getModelFromEntry(model, this.stageEntry) ?? this.getModelFromEntry(model, this.bgEntry);
            }
        }
    }

    // Screw it, don't make fancy generic prefix whatever lookup just for goals, just do it here

    public getBlueGoalModel(): ModelInst | null {
        return this.blueGoalModel;
    }

    public getGreenGoalModel(): ModelInst | null {
        return this.greenGoalModel;
    }

    public getRedGoalModel(): ModelInst | null {
        return this.redGoalModel;
    }

    public getBumperModel(): ModelInst | null {
        return this.bumperModel;
    }

    public getTextureCache(): TextureCache {
        return this.textureCache;
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.allEntries.length; i++) {
            for (const model of this.allEntries[i].modelCache.values()) {
                model.setMaterialHacks(hacks);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.allEntries.length; i++) {
            this.allEntries[i].modelCache.forEach((model) => model.destroy(device));
        }
        this.textureCache.destroy(device);
    }
}
