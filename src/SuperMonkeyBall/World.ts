import { mat4 } from "gl-matrix";
import { Color, TransparentBlack } from "../Color";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import * as GX_Material from "../gx/gx_material";
import * as Viewer from "../viewer";
import { Background } from "./Background";
import { BgObjectInst } from "./BgObject";
import * as Gma from "./Gma";
import { ModelInst, RenderParams } from "./Model";
import { GmaSrc, ModelCache, TextureCache } from "./ModelCache";
import * as Nl from "./NaomiLib";
import { RenderContext } from "./Render";
import * as SD from "./Stagedef";
import { BgInfos, StageInfo } from "./StageInfo";
import { MkbTime } from "./Utils";
import { AnimGroup } from "./AnimGroup";
import { Lighting } from "./Lighting";

const scratchRenderParams = new RenderParams();

// Immutable parsed stage definition
export type StageData = {
    kind: "Stage",
    stageInfo: StageInfo;
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
    commonGma: Gma.Gma;
};

export type GmaData = {
    kind: "Gma",
    gma: Gma.Gma;
}

export type NlData = {
    kind: "Nl",
    obj: Nl.Obj;
}

export type WorldData = StageData | GmaData | NlData;

// Common interface for GMA and NaomiLib models
export interface ModelInterface {
    setMaterialHacks(hacks: GX_Material.GXMaterialHacks): void;
    prepareToRender(ctx: RenderContext, renderParams: RenderParams): void;
    destroy(device: GfxDevice): void;
}

export interface World {
    update(viewerInput: Viewer.ViewerRenderInput): void;
    prepareToRender(ctx: RenderContext): void;
    getTextureCache(): TextureCache;
    getClearColor(): Color;
    setMaterialHacks(hacks: GX_Material.GXMaterialHacks): void;
    destroy(device: GfxDevice): void;
}

export class StageWorld implements World {
    private mkbTime: MkbTime;
    private animGroups: AnimGroup[];
    private background: Background;
    private lighting: Lighting;
    private modelCache: ModelCache;

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private stageData: StageData) {
        this.modelCache = new ModelCache(device, renderCache, stageData);
        this.mkbTime = new MkbTime(60); // TODO(complexplane): Per-stage time limit
        this.animGroups = stageData.stagedef.animGroups.map((_, i) => new AnimGroup(this.modelCache, stageData, i));

        const bgObjects: BgObjectInst[] = [];
        for (const bgObject of stageData.stagedef.bgObjects.concat(stageData.stagedef.fgObjects)) {
            if (!(bgObject.flags & SD.BgModelFlags.Visible)) continue;
            const model = this.modelCache.getModel(bgObject.modelName, GmaSrc.StageAndBg);
            if (model === null) continue;
            bgObjects.push(new BgObjectInst(model, bgObject));
        }
        this.background = new stageData.stageInfo.bgInfo.bgConstructor(bgObjects);

        this.lighting = new Lighting(stageData.stageInfo.bgInfo);
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.mkbTime.updateDeltaTimeSeconds(viewerInput.deltaTime / 1000);
        for (let i = 0; i < this.animGroups.length; i++) {
            this.animGroups[i].update(this.mkbTime);
        }
        this.background.update(this.mkbTime);
        this.lighting.update(viewerInput);
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.animGroups.length; i++) {
            this.animGroups[i].prepareToRender(ctx, this.lighting);
        }
        this.background.prepareToRender(ctx, this.lighting);
    }

    public getTextureCache(): TextureCache {
        return this.modelCache.getTextureCache();
    }

    public getClearColor(): Color {
        return this.stageData.stageInfo.bgInfo.clearColor;
    }

    public setMaterialHacks(hacks: GX_Material.GXMaterialHacks): void {
        this.modelCache.setMaterialHacks(hacks);
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}

// Just render all models in a single GMA or NaomiLib object, not a stage+bg and all
export class FileDropWorld implements World {
    private lighting: Lighting;
    private models: ModelInterface[] = [];
    private textureCache: TextureCache;

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private worldData: GmaData | NlData) {
        this.textureCache = new TextureCache();
        if (worldData.kind === "Gma") {
            for (const model of worldData.gma.idMap.values()) {
                this.models.push(new ModelInst(device, renderCache, model, this.textureCache));
            }
        } else {
            for (const nlModel of worldData.obj.values()) {
                this.models.push(new Nl.ModelInst(device, renderCache, nlModel, this.textureCache));
            }
        }
        this.lighting = new Lighting(BgInfos.Jungle); // Just assume Jungle's lighting, it's used in a few other BGs
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.lighting.update(viewerInput);
    }

    public prepareToRender(ctx: RenderContext): void {
        const renderParams = scratchRenderParams;
        renderParams.reset();
        renderParams.lighting = this.lighting;
        mat4.copy(renderParams.viewFromModel, ctx.viewerInput.camera.viewMatrix);
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].prepareToRender(ctx, renderParams);
        }
    }

    public getTextureCache(): TextureCache {
        return this.textureCache;
    }

    public getClearColor(): Color {
        return TransparentBlack;
    }

    public setMaterialHacks(hacks: GX_Material.GXMaterialHacks): void {
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].setMaterialHacks(hacks);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.models.length; i++) {
            this.models[i].destroy(device);
        }
        this.textureCache.destroy(device);
    }
}
