import { mat4 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GXMaterialHacks } from "../gx/gx_material";
import { ViewerRenderInput } from "../viewer";
import * as Gma from "./Gma";
import { TextureHolder } from "./ModelCache";
import { SamplerInst } from "./SamplerInst";
import { ShapeInst } from "./ShapeInst";

export class ModelInst {
    private shapes: ShapeInst[];
    private samplers: SamplerInst[]; // Each shape material uses a subset of these samplers

    constructor(
        device: GfxDevice,
        renderCache: GfxRenderCache,
        modelData: Gma.Model,
        texCache: TextureHolder
    ) {
        this.samplers = modelData.samplers.map(
            (samplerData) => new SamplerInst(device, samplerData, texCache)
        );
        this.shapes = modelData.shapes.map(
            (shapeData, i) =>
                new ShapeInst(
                    device,
                    renderCache,
                    shapeData,
                    this.samplers,
                    modelData.attrs,
                    i >= modelData.opaqueShapeCount
                )
        );
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].setMaterialHacks(hacks);
        }
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        viewFromModel: mat4
    ) {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].prepareToRender(device, renderInstManager, viewerInput, viewFromModel);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].destroy(device);
        }
        for (let i = 0; i < this.samplers.length; i++) {
            this.samplers[i].destroy(device);
        }
    }
}
