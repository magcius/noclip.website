import * as Viewer from '../viewer';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, fillSceneParams, GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array } from '../gx/gx_displaylist';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GXMaterial } from '../gx/gx_material';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';

import { SFATexture } from './textures';

// Adapted from BasicGXRendererHelper
export abstract class SFARendererHelper implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected abstract prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void;

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderInstManager.gfxRenderCache;
    }

    public abstract render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass;

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
    }
}

export class SFARenderer extends SFARendererHelper {
    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // Draw sky
        const skyTemplate = this.renderHelper.pushTemplateRenderInst();
        const oldProjection = mat4.create();
        mat4.copy(oldProjection, viewerInput.camera.projectionMatrix);
        mat4.identity(viewerInput.camera.projectionMatrix);
        fillSceneParamsDataOnTemplate(skyTemplate, viewerInput, false);
        this.renderSky(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        mat4.copy(viewerInput.camera.projectionMatrix, oldProjection);

        let hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        
        let passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        device.submitPass(passRenderer);

        // Draw world
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput, false);
        this.renderWorld(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, noClearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        // Pass will be submitted by the caller
        return passRenderer;
    }
}
