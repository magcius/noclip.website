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
import AnimationController from "../AnimationController";
import { mat4, vec3 } from "gl-matrix";

const S16_TO_RADIANS = Math.PI / 0x8000;

// Immutable stage/background definition
export type StageData = {
    stagedef: SD.Stage;
    stageGma: Gma.Gma;
    bgGma: Gma.Gma;
};

const scratchVec3a = vec3.create();
class Itemgroup {
    private worldFromIg: mat4;
    private originFromIg: mat4;

    constructor(igData: SD.Itemgroup) {
        this.originFromIg = mat4.create();
        mat4.fromXRotation(this.originFromIg, -igData.originRot[0] * S16_TO_RADIANS);
        mat4.rotateY(this.originFromIg, this.originFromIg, -igData.originRot[1] * S16_TO_RADIANS);
        mat4.rotateZ(this.originFromIg, this.originFromIg, -igData.originRot[2] * S16_TO_RADIANS);
        const negOrigin = scratchVec3a;
        vec3.negate(negOrigin, igData.originPos);
        mat4.translate(this.originFromIg, this.originFromIg, negOrigin);

        // TODO animate
        mat4.copy(this.worldFromIg, this.originFromIg);
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput
    ) {}
}

export class World {
    private levelModels: ModelInst[];

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        private modelCache: ModelCache,
        stageData: StageData
    ) {
        // For now, just render all level models referenced by stagedef
        this.levelModels = [];
        for (const levelModelData of stageData.stagedef.levelModels) {
            const modelInst = modelCache.getModel(device, renderCache, levelModelData.modelName);
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
