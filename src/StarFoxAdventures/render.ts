import * as Viewer from '../viewer';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, BasicRenderTarget, ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { mat4 } from 'gl-matrix';
import { SFAAnimationController } from './animation';

// Adapted from BasicGXRendererHelper
export abstract class SFARendererHelper implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

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
    protected renderPass: GfxRenderPass;
    protected viewport: any;
    protected sceneTexture = new ColorTexture();
    protected renderInstManager: GfxRenderInstManager;

    constructor(device: GfxDevice, protected animController: SFAAnimationController) {
        super(device);
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        this.animController.update(viewerInput);
    }

    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected beginPass(viewerInput: Viewer.ViewerRenderInput, clipSpace: boolean = false) {
        const template = this.renderHelper.pushTemplateRenderInst();
        let oldProjection: mat4;
        if (clipSpace) {
            // XXX: clobber the projection matrix to identity
            // TODO: there should probably be a better way to do this
            oldProjection = mat4.clone(viewerInput.camera.projectionMatrix);
            mat4.identity(viewerInput.camera.projectionMatrix);
        }
        fillSceneParamsDataOnTemplate(template, viewerInput, false);
        if (clipSpace) {
            mat4.copy(viewerInput.camera.projectionMatrix, oldProjection!);
        }
    }

    protected endPass(device: GfxDevice) {
        this.renderInstManager.popTemplateRenderInst();

        let hostAccessPass = device.createHostAccessPass();
        this.renderHelper.prepareToRender(device, hostAccessPass);
        device.submitPass(hostAccessPass);
        
        this.renderInstManager.drawOnPassRenderer(device, this.renderPass);
        this.renderInstManager.resetRenderInsts();

        device.submitPass(this.renderPass);
        this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, noClearRenderPassDescriptor, this.sceneTexture.gfxTexture);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.update(viewerInput);

        this.renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.viewport = viewerInput.viewport;
        this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, standardFullClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        this.renderSky(device, this.renderInstManager, viewerInput);
        this.renderWorld(device, this.renderInstManager, viewerInput);

        this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, noClearRenderPassDescriptor);
        return this.renderPass;
    }
}
