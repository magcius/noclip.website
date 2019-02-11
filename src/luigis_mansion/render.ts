
import * as Viewer from "../viewer";
import * as UI from '../ui';
import { BIN, Batch, Material, SceneGraphNode, SceneGraphPart } from "./bin";

import * as GX_Texture from '../gx/gx_texture';
import { MaterialParams, PacketParams, loadTextureFromMipChain, GXMaterialHelperGfx, GXRenderHelperGfx, GXShapeHelperGfx, loadedDataCoalescerGfx, translateWrapModeGfx } from '../gx/gx_render';
import { assert } from "../util";
import { mat4 } from "gl-matrix";
import { AABB } from "../Geometry";
import { GfxTexture, GfxDevice, GfxRenderPass, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { GfxCoalescedBuffers, GfxBufferCoalescer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInst, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { Camera, computeViewMatrix } from "../Camera";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";

const materialParamsScratch = new MaterialParams();
class Command_Material {
    private materialHelper: GXMaterialHelperGfx;
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public binCommand: Command_Bin, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(device, renderHelper, material.gxMaterial);
        this.templateRenderInst = this.materialHelper.templateRenderInst;

        // All we care about is textures...
        const materialParams = materialParamsScratch;
        for (let i = 0; i < this.material.samplerIndexes.length; i++) {
            const samplerIndex = this.material.samplerIndexes[i];
            materialParams.m_TextureMapping[i].reset();
            if (samplerIndex >= 0) {
                materialParams.m_TextureMapping[i].gfxTexture = this.binCommand.gfxTextures[samplerIndex];
                materialParams.m_TextureMapping[i].gfxSampler = this.binCommand.gfxSamplers[samplerIndex];
            }
        }

        this.templateRenderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx): void {
        this.materialHelper.fillMaterialParamsRaw(materialParamsScratch, renderHelper);
    }

    public destroy(device: GfxDevice): void {
        this.materialHelper.destroy(device);
    }
}

const bboxScratch = new AABB();
class Command_Batch {
    private shapeHelper: GXShapeHelperGfx;
    private packetParams = new PacketParams();
    private renderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private sceneGraphNode: SceneGraphNode, batch: Batch, coalescedBuffers: GfxCoalescedBuffers) {
        this.shapeHelper = new GXShapeHelperGfx(device, renderHelper, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
        this.renderInst = this.shapeHelper.pushRenderInst(renderHelper.renderInstBuilder);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.sceneGraphNode.modelMatrix);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput, visible: boolean): void {
        this.renderInst.visible = visible;

        if (this.renderInst.visible && this.sceneGraphNode.bbox) {
            bboxScratch.transform(this.sceneGraphNode.bbox, this.sceneGraphNode.modelMatrix);
            this.renderInst.visible = viewerInput.camera.frustum.contains(bboxScratch);
        }

        if (this.renderInst.visible) {
            this.computeModelView(this.packetParams.u_PosMtx[0], viewerInput.camera);
            this.shapeHelper.fillPacketParams(this.packetParams, this.renderInst, renderHelper);
        }
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
    }
}

class Command_Bin {
    public name: string;

    private batchCommands: Command_Batch[] = [];
    private materialCommands: Command_Material[] = [];
    private bufferCoalescer: GfxBufferCoalescer;
    private batches: Batch[];

    public gfxSamplers: GfxSampler[] = [];
    public gfxTextures: GfxTexture[] = [];
    public visible: boolean = true;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private bin: BIN) {
        this.translateModel(device, renderHelper, bin);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].prepareToRender(renderHelper);
        for (let i = 0; i < this.batchCommands.length; i++)
            this.batchCommands[i].prepareToRender(renderHelper, viewerInput, this.visible);
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        this.gfxTextures.forEach((t) => device.destroyTexture(t));
        this.gfxSamplers.forEach((t) => device.destroySampler(t));
        this.batchCommands.forEach((t) => t.destroy(device));
        this.materialCommands.forEach((t) => t.destroy(device));
        this.bufferCoalescer.destroy(device);
    }

    private translatePart(device: GfxDevice, renderHelper: GXRenderHelperGfx, node: SceneGraphNode, part: SceneGraphPart): void {
        const materialCommand = new Command_Material(device, renderHelper, this, part.material);
        this.materialCommands.push(materialCommand);
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);

        renderHelper.renderInstBuilder.pushTemplateRenderInst(materialCommand.templateRenderInst);
        const batchCommand = new Command_Batch(device, renderHelper, node, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        renderHelper.renderInstBuilder.popTemplateRenderInst();

        this.batchCommands.push(batchCommand);
    }

    private translateSceneGraph(device: GfxDevice, renderHelper: GXRenderHelperGfx, node: SceneGraphNode): void {
        for (const part of node.parts)
            this.translatePart(device, renderHelper, node, part);
        for (const child of node.children)
            this.translateSceneGraph(device, renderHelper, child);
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
            const texture: GX_Texture.Texture = { ...sampler.texture, name: `unknown ${i}` };
            const mipChain = GX_Texture.calcMipChain(texture, 1);
            const { gfxTexture, viewerTexture } = loadTextureFromMipChain(device, mipChain);

            // GL texture is bound by loadTextureFromMipChain.
            const gfxSampler = device.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter: GfxTexFilterMode.BILINEAR,
                magFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.NO_MIP,
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
        this.bufferCoalescer = loadedDataCoalescerGfx(device, this.batches.map((batch) => batch.loadedVertexData));
        this.translateSceneGraph(device, renderHelper, bin.rootNode);
    }
}

export class LuigisMansionRenderer implements Viewer.SceneGfx {
    private binCommands: Command_Bin[] = [];
    private renderHelper: GXRenderHelperGfx;
    public viewRenderer: GfxRenderInstViewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice, private bins: BIN[]) {
        this.renderHelper = new GXRenderHelperGfx(device);
        for (let i = 0; i < bins.length; i++)
            this.binCommands.push(new Command_Bin(device, this.renderHelper, bins[i]));
        this.renderHelper.finishBuilder(device, this.viewRenderer);
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.binCommands);
        return [layers];
    }

    private prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.binCommands.length; i++)
            this.binCommands[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.viewRenderer.prepareToRender(device);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, passRenderer);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.binCommands.length; i++)
            this.binCommands[i].destroy(device);
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        this.viewRenderer.destroy(device);
    }
}
