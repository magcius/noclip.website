// TODO: Figure out how to actually parse particles.
// At the moment this is just a hack to get the ground zippers to show up in the renderer.

import { mat4, ReadonlyMat4 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { DkrDrawCall, DkrDrawCallParams } from "./DkrDrawCall.js";
import { DkrTexture } from "./DkrTexture.js";
import { DkrTriangleBatch, SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX } from "./DkrTriangleBatch.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";

function createVertexData(vertices: { x: number, y: number, z: number, r: number, g: number, b: number, a: number }[]): ArrayBufferSlice {
    const out = new ArrayBuffer(vertices.length * SIZE_OF_VERTEX);
    const view = new DataView(out);

    for(let i = 0; i < vertices.length; i++) {
        let offset = i * SIZE_OF_VERTEX;
        view.setUint16(offset + 0x00, vertices[i].x, true);
        view.setUint16(offset + 0x02, vertices[i].y, true);
        view.setUint16(offset + 0x04, vertices[i].z, true);
        view.setUint8(offset + 0x06, vertices[i].r);
        view.setUint8(offset + 0x07, vertices[i].g);
        view.setUint8(offset + 0x08, vertices[i].b);
        view.setUint8(offset + 0x09, vertices[i].a);
    }

    return new ArrayBufferSlice(out);
}

function createTriangleData(triangles: { drawBackface: boolean, v0: number, v1: number, v2: number, uv0: [number, number], uv1: [number, number], uv2: [number, number] }[], texture: DkrTexture): ArrayBufferSlice {
    const out = new ArrayBuffer(triangles.length * SIZE_OF_TRIANGLE_FACE);
    const view = new DataView(out);

    const uInvScale = texture.getWidth() * 32.0;
    const vInvScale = texture.getHeight() * 32.0;

    for(let i = 0; i < triangles.length; i++) {
        let offset = i * SIZE_OF_TRIANGLE_FACE;
        view.setUint8(offset + 0x00, triangles[i].drawBackface ? 0x40 : 0x00);
        view.setUint8(offset + 0x01, triangles[i].v0);
        view.setUint8(offset + 0x02, triangles[i].v1);
        view.setUint8(offset + 0x03, triangles[i].v2);
        view.setUint16(offset + 0x04, triangles[i].uv0[0] * uInvScale, true);
        view.setUint16(offset + 0x06, triangles[i].uv0[1] * vInvScale, true);
        view.setUint16(offset + 0x08, triangles[i].uv1[0] * uInvScale, true);
        view.setUint16(offset + 0x0A, triangles[i].uv1[1] * vInvScale, true);
        view.setUint16(offset + 0x0C, triangles[i].uv2[0] * uInvScale, true);
        view.setUint16(offset + 0x0E, triangles[i].uv2[1] * vInvScale, true);
    }

    return new ArrayBufferSlice(out);
}

export class DkrParticle {
    private drawCall: DkrDrawCall;
    private modelMatrix = mat4.create();

    constructor(cache: GfxRenderCache, texture: DkrTexture, modelMatrix: ReadonlyMat4) {
        this.drawCall = new DkrDrawCall(texture);
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
        this.drawCall.build(cache);

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