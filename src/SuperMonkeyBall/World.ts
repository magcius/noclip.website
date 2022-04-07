import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { ModelCache } from "./ModelCache";
import { ModelInst } from "./ModelInst";
import * as SD from "./StagedefTypes";
import * as Gcmf from "./Gcmf";
import { TextureInputGX } from "../gx/gx_texture";
import { GXMaterialHacks } from "../gx/gx_material";
import * as Viewer from "../viewer";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from "../gx/gx_render";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { AVTpl } from "./AVTpl";

// Immutable stage/background definition
export type StageData = {
    stagedef: SD.Stage;
    stageGma: Gcmf.Gma;
    stageTpl: AVTpl;
    bgGma: Gcmf.Gma;
    bgTpl: AVTpl;
};

export class World {
    private modelCache: ModelCache;
    private levelModels: ModelInst[];

    constructor(device: GfxDevice, renderCache: GfxRenderCache, stageData: StageData) {
        this.modelCache = new ModelCache(stageData);

        // For now, just render all level models referenced by stagedef
        this.levelModels = [];
        for (const levelModelData of stageData.stagedef.levelModels) {
            const modelInst = this.modelCache.getModel(device, renderCache, levelModelData.modelName);
            if (modelInst !== null) {
                this.levelModels.push(modelInst);
            }
        }
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.levelModels.length; i++) {
            this.levelModels[i].setMaterialHacks(hacks);
        }
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput
    ): void {
        // TODO(complexplane): update()

        for (let i = 0; i < this.levelModels.length; i++) {
            this.levelModels[i].prepareToRender(device, renderInstManager, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device); // Destroys GPU resources that transitively exist in cache
    }
}
