import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { ModelCache } from "./ModelCache";
import { ModelInst } from "./ModelInst";
import * as SD from "./StagedefTypes";
import * as Gma from "./Gma";
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
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
};

export class World {
    private levelModels: ModelInst[];

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private modelCache: ModelCache, stageData: StageData) {
        // For now, just render all level models referenced by stagedef
        this.levelModels = [];
        for (const levelModelData of stageData.stagedef.levelModels) {
            const modelInst = modelCache.getModel(
                device,
                renderCache,
                levelModelData.modelName
            );
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
