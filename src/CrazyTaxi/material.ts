import { mat4 } from "gl-matrix";
import * as Viewer from '../viewer.js';
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxBufferUsage, GfxBufferFrequencyHint, GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxInputLayout } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { LoadedVertexLayout, LoadedVertexData } from "../gx/gx_displaylist";
import { GXMaterialHelperGfx, MaterialParams, GXTextureMapping, createInputLayout, GXTextureHolder, DrawParams } from "../gx/gx_render";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from '../gx/gx_enum.js';
import { setMatrixTranslation, scaleMatrix } from "../MathHelpers";
import { assert, assertExists } from "../util";
import { Shape, ShapeDrawCall } from "./shape";


export interface MaterialDrawBatch {
    shapes: Shape[],

    vertexBuffers: ArrayBufferLike[],
    totalVertexCount: number;
    totalVertexByteCount: number,
    vertexBufferDescriptor?: GfxVertexBufferDescriptor,

    indexBuffers: ArrayBufferLike[],
    totalIndexCount: number,
    totalIndexByteCount: number;
    indexBufferDescriptor?: GfxIndexBufferDescriptor,
}

function patchPNMTXIDX(layout: LoadedVertexLayout, data: LoadedVertexData, idx: number): void {
    const stride = layout.vertexBufferStrides[0];
    let offs = layout.vertexAttributeOffsets[GX.Attr.POS]; // should always be 0, but, well, you know
    const view = new DataView(data.vertexBuffers[0]);
    for (let i = 0; i < data.totalVertexCount; i++) {
        // PNMTXIDX is stored in the fourth float of position data.
        view.setFloat32(offs + 0x0c, idx, true);
        offs += stride;
    }
}

function concatBuffers(bufs: ArrayBufferLike[], totalByteSize: number): Uint8Array {
    const result = new Uint8Array(totalByteSize);
    let offs = 0
    for (const buf of bufs) {
        result.set(new Uint8Array(buf), offs);
        offs += buf.byteLength;
    }
    return result;
}

const drawParams = new DrawParams();

export class Material {
    public batches: MaterialDrawBatch[] = [];

    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private inputLayout: GfxInputLayout;
    private finished = false;

    constructor(private cache: GfxRenderCache, public name: string, texture: GXTextureMapping, public gxLayout: LoadedVertexLayout) {
        this.inputLayout = createInputLayout(cache, gxLayout);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(true);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
        this.materialParams.m_TextureMapping[0] = texture;
    }

    public usesLayout(layout: LoadedVertexLayout): boolean {
        return JSON.stringify(this.gxLayout) === JSON.stringify(layout);
    }

    private getCurrentBatch(): MaterialDrawBatch {
        let batch = this.batches[this.batches.length - 1];
        if (this.batches.length === 0 || batch.shapes.length === 10) {
            batch = {
                shapes: [],
                totalIndexCount: 0,
                totalIndexByteCount: 0,
                totalVertexCount: 0,
                totalVertexByteCount: 0,
                vertexBuffers: [],
                indexBuffers: [],
            };
            this.batches.push(batch);
        }
        return batch;
    }

    public addDraw(shape: Shape, draw: ShapeDrawCall) {
        const vertexData = draw.vertexData;
        const batch = this.getCurrentBatch();
        batch.shapes.push(shape);

        // update the PNMTXIDX value for each vertex, which lets us use instancing
        patchPNMTXIDX(draw.vertexLayout, vertexData, batch.shapes.length - 1);

        // update the index values to the current total vertex count
        const indexBuffer = new Uint16Array(vertexData.indexData);
        for (let i = 0; i < indexBuffer.length; i++) {
            indexBuffer[i] += batch.totalVertexCount;
        }
        batch.totalVertexCount += vertexData.totalVertexCount;
        batch.indexBuffers.push(indexBuffer.buffer);
        batch.totalIndexByteCount += vertexData.indexData.byteLength;
        batch.vertexBuffers.push(vertexData.vertexBuffers[0]);
        batch.totalVertexByteCount += vertexData.vertexBuffers[0].byteLength;
        batch.totalIndexCount += vertexData.totalIndexCount;
    }

    public finish() {
        for (let batchIdx = 0; batchIdx < this.batches.length; batchIdx++) {
            const batch = this.batches[batchIdx];
            const indexBuffer = createBufferFromData(
                this.cache.device,
                GfxBufferUsage.Index,
                GfxBufferFrequencyHint.Static,
                concatBuffers(batch.indexBuffers, batch.totalIndexByteCount).buffer
            );
            batch.indexBufferDescriptor = { buffer: indexBuffer };

            const combinedVertexBuffer = concatBuffers(batch.vertexBuffers, batch.totalVertexByteCount);
            const vertexBuffer = createBufferFromData(
                this.cache.device,
                GfxBufferUsage.Vertex,
                GfxBufferFrequencyHint.Static,
                combinedVertexBuffer.buffer,
            );
            this.cache.device.uploadBufferData(
                vertexBuffer,
                0,
                combinedVertexBuffer,
            );
            batch.vertexBufferDescriptor = { buffer: vertexBuffer };
        }
        this.finished = true;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        assert(this.finished);
        for (const batch of this.batches) {
            if (batch.totalIndexCount === 0) continue;
            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.setOnRenderInst(this.cache, renderInst);
            for (let i = 0; i < batch.shapes.length; i++) {
                const shape = batch.shapes[i];
                const m = mat4.create();
                setMatrixTranslation(m, shape.pos);
                scaleMatrix(m, m, shape.scale[0]);
                if (shape.isSkybox) {
                    m[15] = 0;
                }
                mat4.mul(drawParams.u_PosMtx[i], viewerInput.camera.viewMatrix, m);
            }
            this.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
            this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
            renderInst.setVertexInput(
                this.inputLayout,
                [assertExists(batch.vertexBufferDescriptor)],
                assertExists(batch.indexBufferDescriptor)
            );
            renderInst.setDrawCount(batch.totalIndexCount);
            renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice) {
        assert(this.finished);
        // Do not destroy inputLayout; it is owned by the render cache.
        for (const batch of this.batches) {
            device.destroyBuffer(batch.vertexBufferDescriptor!.buffer);
            device.destroyBuffer(batch.indexBufferDescriptor!.buffer);
        }
    }
}

export class MaterialCache {
    public materials: Map<string, Material[]> = new Map();

    constructor(private cache: GfxRenderCache, private textureHolder: GXTextureHolder) {
    }

    public addShape(shape: Shape) {
        for (const draw of shape.draws) {
            const textureName = shape.textures[draw.textureIndex];
            let materials = this.materials.get(textureName);
            if (materials === undefined) {
                materials = [];
                this.materials.set(textureName, materials);
            }

            let material = materials.find(m => m.usesLayout(draw.vertexLayout));

            if (material === undefined) {
                const textureMapping = new GXTextureMapping();
                this.textureHolder.fillTextureMapping(textureMapping, textureName);
                material = new Material(
                    this.cache,
                    textureName,
                    textureMapping,
                    draw.vertexLayout
                );
                materials.push(material);
            }
            material.addDraw(shape, draw);
        }
    }

    public finish() {
        for (const materials of this.materials.values()) {
            for (const material of materials) {
                material.finish();
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (const materials of this.materials.values()) {
            for (const material of materials) {
                material.prepareToRender(renderInstManager, viewerInput);
            }
        }
    }

    public destroy(device: GfxDevice) {
        for (const materials of this.materials.values()) {
            for (const material of materials) {
                material.destroy(device);
            }
        }
    }
}
