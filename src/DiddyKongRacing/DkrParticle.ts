// TODO: Figure out how to actually parse particles.
// At the moment this is just a hack to get the ground zippers to show up in the renderer.

import { mat4, vec3, quat, ReadonlyMat4 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { DkrDrawCall, DkrDrawCallParams } from "./DkrDrawCall.js";
import { DkrTexture } from "./DkrTexture.js";
import { DkrTriangleBatch } from "./DkrTriangleBatch.js";
import { createTriangleData, createVertexData } from "./DkrUtil.js";

export class DkrParticle {
    private drawCall: DkrDrawCall;
    private modelMatrix = mat4.create();

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, texture: DkrTexture, modelMatrix: ReadonlyMat4) {
        this.drawCall = new DkrDrawCall(device, renderHelper.renderCache, texture);
        const halfsize = 50.0;
        const vertexData = createVertexData([
            { x: -halfsize*1.3, y: 5.0, z: -halfsize, r: 255, g: 255, b: 255, a: 255 },
            { x: halfsize*1.3, y: 5.0, z: -halfsize, r: 255, g: 255, b: 255, a: 255 },
            { x: -halfsize*1.3, y: 5.0, z: halfsize, r: 255, g: 255, b: 255, a: 255 },
            { x: halfsize*1.3, y: 5.0, z: halfsize, r: 255, g: 255, b: 255, a: 255 },
        ]);
        const triangleData = createTriangleData([
            {
                drawBackface: true,
                v0: 0, v1: 1, v2: 2,
                uv0: [0.0, 0.0], uv1: [1.0, 0.0], uv2: [0.0, 1.0]
            },
            {
                drawBackface: true,
                v0: 1, v1: 2, v2: 3,
                uv0: [1.0, 0.0], uv1: [0.0, 1.0], uv2: [1.0, 1.0]
            },
        ], texture);
        let triangleBatch = new DkrTriangleBatch(triangleData, vertexData, 0, 2, texture);
        this.drawCall.addTriangleBatch(triangleBatch);
        this.drawCall.build();

        mat4.copy(this.modelMatrix, modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const params: DkrDrawCallParams = {
            modelMatrix: this.modelMatrix,
            textureFrame: 0,
            isSkydome: false,
            usesNormals: false,
            overrideAlpha: null,
            objAnim: null,
            objAnimIndex: 0,
        };
        this.drawCall.prepareToRender(device, renderInstManager, viewerInput, params);
    }

    public destroy(device: GfxDevice): void {
        this.drawCall.destroy(device);
    }
}