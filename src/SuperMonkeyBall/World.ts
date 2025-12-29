import { mat4 } from "gl-matrix";
import { Color, TransparentBlack } from "../Color.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import * as GX_Material from "../gx/gx_material.js";
import * as Viewer from "../viewer.js";
import { Background } from "./Background.js";
import { BgObjectInst } from "./BgObject.js";
import * as Gma from "./Gma.js";
import { ModelInst, RenderParams } from "./Model.js";
import { GmaSrc, ModelCache, TextureCache } from "./ModelCache.js";
import * as Nl from "./NaomiLib.js";
import { RenderContext } from "./Render.js";
import * as SD from "./Stagedef.js";
import { BgInfos, StageInfo } from "./StageInfo.js";
import { MkbTime } from "./Utils.js";
import { AnimGroup } from "./AnimGroup.js";
import { Lighting } from "./Lighting.js";

// Immutable parsed stage definition
export type StageData = {
    stageInfo: StageInfo;
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
    commonGma: Gma.Gma;
    nlObj: Nl.Obj; // Extra Naomi model archive from filedrop
};

// Common interface for GMA and NaomiLib models
export interface ModelInterface {
    setMaterialHacks(hacks: GX_Material.GXMaterialHacks): void;
    prepareToRender(ctx: RenderContext, renderParams: RenderParams): void;
    destroy(device: GfxDevice): void;
}

// Mutable, global shared state
export type WorldState = {
    lighting: Lighting;
    modelCache: ModelCache;
    time: MkbTime;
    // TODO(complexplane): Itemgroup animation state (for raycasts)
    // TODO(complexplane): Stage bounding sphere (for asteroids in Space?)
};

export class World {
    private worldState: WorldState;
    private animGroups: AnimGroup[];
    private background: Background;

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private stageData: StageData) {
        this.worldState = {
            modelCache: new ModelCache(device, renderCache, stageData),
            time: new MkbTime(60), // TODO(complexplane): Per-stage time limit
            lighting: new Lighting(stageData.stageInfo.bgInfo),
        };
        this.animGroups = stageData.stagedef.animGroups.map(
            (_, i) => new AnimGroup(this.worldState.modelCache, stageData, i)
        );

        const bgObjects: BgObjectInst[] = [];
        for (const bgObject of stageData.stagedef.bgObjects.concat(stageData.stagedef.fgObjects)) {
            if (!(bgObject.flags & SD.BgModelFlags.Visible)) continue;
            const model = this.worldState.modelCache.getModel(bgObject.modelName, GmaSrc.StageAndBg);
            if (model === null) continue;
            bgObjects.push(new BgObjectInst(model, bgObject));
        }
        this.background = new stageData.stageInfo.bgInfo.bgConstructor(this.worldState, bgObjects);
    }

    public update(viewerInput: Viewer.ViewerRenderInput): void {
        this.worldState.time.updateDeltaTimeSeconds(viewerInput.deltaTime / 1000);
        for (let i = 0; i < this.animGroups.length; i++) {
            this.animGroups[i].update(this.worldState);
        }
        this.background.update(this.worldState);
        this.worldState.lighting.update(viewerInput);
    }

    public prepareToRender(ctx: RenderContext): void {
        for (let i = 0; i < this.animGroups.length; i++) {
            this.animGroups[i].prepareToRender(this.worldState, ctx);
        }
        this.background.prepareToRender(this.worldState, ctx);
    }

    public getClearColor(): Color {
        return this.stageData.stageInfo.bgInfo.clearColor;
    }

    public setMaterialHacks(hacks: GX_Material.GXMaterialHacks): void {
        this.worldState.modelCache.setMaterialHacks(hacks);
    }

    public destroy(device: GfxDevice): void {
        this.worldState.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}
