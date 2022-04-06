import { GfxDevice } from "../gfx/platform/GfxPlatform";
import * as Gcmf from "./Gcmf";
import { TextureCache } from "./ModelCache";
import { SamplerInst } from "./SamplerInst";
import { ShapeInst } from "./ShapeInst";

export class ModelInst {
    private shapes: ShapeInst[];
    private samplers: SamplerInst[]; // Each shape material uses a subset of these samplers

    constructor(device: GfxDevice, modelData: Gcmf.Model, texCache: TextureCache) {
        this.samplers = modelData.samplers.map(
            (samplerData) => new SamplerInst(device, samplerData, texCache)
        );
        this.shapes = modelData.shapes.map(
            (shapeData, i) =>
                new ShapeInst(
                    device,
                    shapeData,
                    this.samplers,
                    modelData.attrs,
                    i >= modelData.opaqueShapeCount
                )
        );
    }
}
