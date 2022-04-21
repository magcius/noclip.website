import { mat4 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GXMaterialHacks } from "../gx/gx_material";
import { ViewerRenderInput } from "../viewer";
import * as Gma from "./Gma";
import { TextureHolder } from "./ModelCache";
import { TevLayerInst } from "./TevLayer";
import { ShapeInst } from "./Shape";
import { RenderContext } from "./Render";

export type RenderParams = {
    alpha: number;
    sort: "translucent" | "all" | "none";
};

export class ModelInst {
    private shapes: ShapeInst[];
    private tevLayers: TevLayerInst[]; // Each shape's material uses up to three of these

    constructor(device: GfxDevice, renderCache: GfxRenderCache, private modelData: Gma.Model, texCache: TextureHolder) {
        this.tevLayers = modelData.tevLayers.map((tevLayerData) => new TevLayerInst(device, tevLayerData, texCache));
        this.shapes = modelData.shapes.map(
            (shapeData, i) =>
                new ShapeInst(
                    device,
                    renderCache,
                    shapeData,
                    this.tevLayers,
                    modelData.flags,
                    i >= modelData.opaqueShapeCount
                )
        );
    }

    public setMaterialHacks(hacks: GXMaterialHacks): void {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].setMaterialHacks(hacks);
        }
    }

    public prepareToRender(ctx: RenderContext, viewFromModel: mat4, renderParams: RenderParams) {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].prepareToRender(ctx, viewFromModel, renderParams);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].destroy(device);
        }
        for (let i = 0; i < this.tevLayers.length; i++) {
            this.tevLayers[i].destroy(device);
        }
    }
}
