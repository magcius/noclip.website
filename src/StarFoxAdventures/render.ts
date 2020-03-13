import * as Viewer from '../viewer';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, BasicRenderTarget, ColorTexture } from '../gfx/helpers/RenderTargetHelpers';

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
    protected renderPass: GfxRenderPass;
    protected viewport: any;
    protected sceneTexture = new ColorTexture();

    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    protected copyToSceneTexture(device: GfxDevice) {
        device.submitPass(this.renderPass);
        this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, noClearRenderPassDescriptor, this.sceneTexture.gfxTexture);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.viewport = viewerInput.viewport;
        this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, standardFullClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        this.renderSky(device, renderInstManager, viewerInput);
        this.renderWorld(device, renderInstManager, viewerInput);

        this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, noClearRenderPassDescriptor);
        return this.renderPass;
    }
}
