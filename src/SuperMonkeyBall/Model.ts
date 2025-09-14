import { mat4, vec3 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { GXMaterialHacks, LightingFudgeParams } from "../gx/gx_material.js";
import { ViewerRenderInput } from "../viewer.js";
import * as Gma from "./Gma.js";
import { TextureCache } from "./ModelCache.js";
import { TevLayerInst } from "./TevLayer.js";
import { ShapeInst } from "./Shape.js";
import { RenderContext } from "./Render.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { ModelInterface } from "./World.js";
import { transformVec3Mat4w1 } from "../MathHelpers.js";
import { Lighting } from "./Lighting.js";

export enum RenderSort {
    Translucent, // Depth sort "translucent" shapes only
    All, // Sort both translucent and opaque shapes
    None, // Don't sort any shapes
}

export class RenderParams {
    public viewFromModel = mat4.create();
    public alpha: number;
    public sort: RenderSort;
    public texMtx = mat4.create();
    public lighting: Lighting | null;
    public depthOffset: number;

    constructor() {
        this.reset();
    }

    public reset(): void {
        mat4.identity(this.viewFromModel);
        this.alpha = 1;
        this.sort = RenderSort.Translucent;
        mat4.identity(this.texMtx);
        this.lighting = null;
        this.depthOffset = 0;
    }
}

const scratchVec3a = vec3.create();
export class ModelInst implements ModelInterface {
    private shapes: ShapeInst[];
    private tevLayers: TevLayerInst[]; // Each shape's material uses up to three of these

    constructor(device: GfxDevice, renderCache: GfxRenderCache, public modelData: Gma.Model, texHolder: TextureCache) {
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

        const centerWorldSpace = scratchVec3a;
        transformVec3Mat4w1(centerWorldSpace, renderParams.viewFromModel, this.modelData.boundSphereCenter);
        transformVec3Mat4w1(centerWorldSpace, ctx.viewerInput.camera.worldMatrix, centerWorldSpace);
        const inFrustum = ctx.viewerInput.camera.frustum.containsSphere(
            centerWorldSpace,
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
