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
}

export class ModelCache {
    // Earlier appearance in this list is higher search precedence
    private entries: CacheEntry[];
    private textureHolder: TextureHolder;

    private blueGoalModel: ModelInst | null = null;
    private greenGoalModel: ModelInst | null = null;
    private redGoalModel: ModelInst | null = null;
    private bumperModel: ModelInst | null = null;

    constructor(private device: GfxDevice, private renderCache: GfxRenderCache, stageData: StageData) {
        this.entries = [
            new CacheEntry(stageData.stageGma),
            new CacheEntry(stageData.bgGma),
            new CacheEntry(stageData.commonGma),
        ];
        this.textureHolder = new TextureHolder();

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
        for (let src = GmaSrc.Stage; src <= GmaSrc.Common; src++) {
            const entry = this.entries[src];
            for (const gma of entry.gma.idMap.values()) {
                if (gma.name.slice(4) === postfix) {
                    return this.getModelFromSrc(gma.name, src);
                }
            }
        }
        return null;
    }

    private getModelFromSrc(model: string | number, src: GmaSrc): ModelInst | null {
        const entry = this.entries[src];
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
        const freshModelInst = new ModelInst(this.device, this.renderCache, modelData, this.textureHolder);
        entry.modelCache.set(modelData.name, freshModelInst);
        return freshModelInst;
    }

    public getModel(model: string | number, src?: GmaSrc): ModelInst | null {
        if (src !== undefined) {
            return this.getModelFromSrc(model, src);
        }
        for (let i = 0; i < this.entries.length; i++) {
            const modelInst = this.getModelFromSrc(model, i as GmaSrc);
            if (modelInst !== null) return modelInst;
        }
        return null;
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
