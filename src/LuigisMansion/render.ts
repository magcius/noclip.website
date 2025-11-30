
import * as Viewer from "../viewer.js";
import * as UI from '../ui.js';
import { BIN, Batch, Material, SceneGraphNode, SceneGraphPart } from "./bin.js";

import * as GX_Texture from '../gx/gx_texture.js';
import { MaterialParams, DrawParams, loadTextureFromMipChain, translateWrapModeGfx, loadedDataCoalescerComboGfx, BasicGXRendererHelper, GXMaterialHelperGfx, GXRenderHelperGfx, fillSceneParamsDataOnTemplate, createInputLayout } from '../gx/gx_render.js';
import { assert } from "../util.js";
import { mat4 } from "gl-matrix";
import { AABB } from "../Geometry.js";
import { GfxTexture, GfxDevice, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxInputLayout } from "../gfx/platform/GfxPlatform.js";
import { GfxBufferCoalescerCombo, GfxCoalescedBuffersCombo } from "../gfx/helpers/BufferHelpers.js";
import { Camera, computeViewMatrix, CameraController } from "../Camera.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";

class MaterialData {
    public materialHelper: GXMaterialHelperGfx;

    constructor(public binData: BinData, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(material.gxMaterial);
    }

    public fillMaterialParams(materialParams: MaterialParams): void {
        // All we care about is textures...
        for (let i = 0; i < this.material.samplerIndexes.length; i++) {
            const samplerIndex = this.material.samplerIndexes[i];
            materialParams.m_TextureMapping[i].reset();
            if (samplerIndex >= 0) {
                materialParams.m_TextureMapping[i].gfxTexture = this.binData.gfxTextures[samplerIndex];
                materialParams.m_TextureMapping[i].gfxSampler = this.binData.gfxSamplers[samplerIndex];
            }
        }
    }
}

class ShapeData {
    private inputLayout: GfxInputLayout;
    private indexCount: number;

    constructor(cache: GfxRenderCache, private coalescedBuffers: GfxCoalescedBuffersCombo, batch: Batch ) {
        this.inputLayout = createInputLayout(cache, batch.loadedVertexLayout);
        assert(batch.loadedVertexData.draws.length === 1);
        assert(batch.loadedVertexData.draws[0].indexOffset === 0);
        this.indexCount = batch.loadedVertexData.draws[0].indexCount;
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, this.coalescedBuffers.vertexBuffers, this.coalescedBuffers.indexBuffer);
        renderInst.setDrawCount(this.indexCount);
    }
}

const bboxScratch = new AABB();
const materialParams = new MaterialParams();
const drawParams = new DrawParams();
class BatchData {
    private shapeData: ShapeData;

    constructor(cache: GfxRenderCache, private materialCommand: MaterialData, private sceneGraphNode: SceneGraphNode, batch: Batch, coalescedBuffers: GfxCoalescedBuffersCombo) {
        this.shapeData = new ShapeData(cache, coalescedBuffers, batch);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.sceneGraphNode.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.sceneGraphNode.bbox !== null) {
            bboxScratch.transform(this.sceneGraphNode.bbox, this.sceneGraphNode.modelMatrix);
            if (!viewerInput.camera.frustum.contains(bboxScratch))
                return;
        }

        const renderInst = renderInstManager.newRenderInst();
        this.shapeData.setOnRenderInst(renderInst);
        this.materialCommand.fillMaterialParams(materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialCommand.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
        this.materialCommand.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.computeModelView(drawParams.u_PosMtx[0], viewerInput.camera);
        this.materialCommand.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
        renderInstManager.submitRenderInst(renderInst);
    }
}

class BinData {
    public name: string;

    private batchData: BatchData[] = [];
    private materialData: MaterialData[] = [];
    private bufferCoalescer: GfxBufferCoalescerCombo;
    private batches: Batch[];

    public gfxSamplers: GfxSampler[] = [];
    public gfxTextures: GfxTexture[] = [];
    public visible: boolean = true;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private bin: BIN) {
        this.name = bin.name;
        this.translateModel(device, renderHelper, bin);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        this.gfxTextures.forEach((t) => device.destroyTexture(t));
        this.bufferCoalescer.destroy(device);
    }

    private translatePart(cache: GfxRenderCache, node: SceneGraphNode, part: SceneGraphPart): void {
        const materialCommand = new MaterialData(this, part.material);
        this.materialData.push(materialCommand);
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);

        const batchCommand = new BatchData(cache, materialCommand, node, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);

        this.batchData.push(batchCommand);
    }

    private translateSceneGraph(cache: GfxRenderCache, node: SceneGraphNode): void {
        for (const part of node.parts)
            this.translatePart(cache, node, part);
        for (const child of node.children)
            this.translateSceneGraph(cache, child);
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, bin: BIN): void {
        for (let i = 0; i < bin.samplers.length; i++) {
            const sampler = bin.samplers[i];
            const texture: GX_Texture.TextureInputGX = { ...sampler.texture, name: `unknown ${i}`, mipCount: 1 };
            const mipChain = GX_Texture.calcMipChain(texture, 1);
            const { gfxTexture, viewerTexture } = loadTextureFromMipChain(device, mipChain);

            // GL texture is bound by loadTextureFromMipChain.
            const gfxSampler = renderHelper.renderCache.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest,
                minLOD: 0,
                maxLOD: 100,
            });

            this.gfxTextures.push(gfxTexture);
            this.gfxSamplers.push(gfxSampler);
        }

        // First, collect all the batches we're rendering.
        this.batches = [];
        this.collectBatches(this.batches, bin.rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, this.batches.map((batch) => batch.loadedVertexData));
        this.translateSceneGraph(renderHelper.renderCache, bin.rootNode);
    }
}

export class LuigisMansionRenderer extends BasicGXRendererHelper {
    private binCommands: BinData[] = [];

    constructor(device: GfxDevice, private bins: BIN[]) {
        super(device);
        for (let i = 0; i < bins.length; i++)
            this.binCommands.push(new BinData(device, this.renderHelper, bins[i]));
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(16/60);
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.binCommands);
        return [layers];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();

        fillSceneParamsDataOnTemplate(template, viewerInput);

        for (let i = 0; i < this.binCommands.length; i++)
            this.binCommands[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public override destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.binCommands.length; i++)
            this.binCommands[i].destroy(device);
    }
}
