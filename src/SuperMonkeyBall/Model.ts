import { mat4, vec3 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GXMaterialHacks, LightingFudgeParams } from "../gx/gx_material";
import { ViewerRenderInput } from "../viewer";
import * as Gma from "./Gma";
import { TextureHolder } from "./ModelCache";
import { TevLayerInst } from "./TevLayer";
import { ShapeInst } from "./Shape";
import { RenderContext } from "./Render";
import { Color, colorNewFromRGBA } from "../Color";
import { Lighting } from "./World";
import { transformVec3Mat4w1 } from "../MathHelpers";

export const enum RenderSort {
    Translucent, // Depth sort "translucent" shapes only
    All, // Sort both translucent and opaque shapes
    None, // Don't sort any shapes
}

export class RenderParams {
    public viewFromModel = mat4.create();
    public alpha = 1;
    public sort = RenderSort.Translucent;
    public texMtx = mat4.create();
    public lighting: Lighting | null = null;
}

const scratchVec3a = vec3.create();
export class ModelInst {
    private shapes: ShapeInst[];
    private tevLayers: TevLayerInst[]; // Each shape's material uses up to three of these

    constructor(device: GfxDevice, renderCache: GfxRenderCache, public modelData: Gma.Model, texHolder: TextureHolder) {
        this.tevLayers = modelData.tevLayers.map(
            (tevLayerData) => new TevLayerInst(device, renderCache, tevLayerData, texHolder)
        );
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

    public prepareToRender(ctx: RenderContext, renderParams: RenderParams) {
        const scale = scratchVec3a;
        mat4.getScaling(scale, renderParams.viewFromModel);
        const maxScale = Math.max(...scale);

        const center_rt_world = scratchVec3a;
        transformVec3Mat4w1(center_rt_world, renderParams.viewFromModel, this.modelData.boundSphereCenter);
        transformVec3Mat4w1(center_rt_world, ctx.viewerInput.camera.worldMatrix, center_rt_world);
        const inFrustum = ctx.viewerInput.camera.frustum.containsSphere(
            center_rt_world,
            this.modelData.boundSphereRadius * maxScale
        );
        if (!inFrustum) return;

        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].prepareToRender(ctx, renderParams);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapes.length; i++) {
            this.shapes[i].destroy(device);
        }
    }
}
