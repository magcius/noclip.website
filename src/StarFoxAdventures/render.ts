import * as Viewer from '../viewer';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxFormat, GfxRenderPass, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { CameraController } from '../Camera';
import { standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor, BasicRenderTarget, ColorTexture } from '../gfx/helpers/RenderTargetHelpers';
import { mat4 } from 'gl-matrix';

import { SFAAnimationController } from './animation';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrTemporalTexture } from '../gfx/render/GfxRenderGraph';
import { TransparentBlack } from '../Color';
import { BillboardMode } from '../rres/brres';

export interface SceneRenderContext {
    getSceneTexture: () => ColorTexture;
    getSceneTextureSampler: () => GfxSampler;
    getPreviousFrameTexture: () => ColorTexture;
    getPreviousFrameTextureSampler: () => GfxSampler;
    viewerInput: Viewer.ViewerRenderInput;
    animController: SFAAnimationController;
}

// Adapted from BasicGXRendererHelper
// export abstract class SFARendererHelper implements Viewer.SceneGfx {
//     public renderTarget = new BasicRenderTarget();
//     public renderHelper: GXRenderHelperGfx;

//     constructor(device: GfxDevice) {
//         this.renderHelper = new GXRenderHelperGfx(device);
//     }

//     public getCache(): GfxRenderCache {
//         return this.renderHelper.renderInstManager.gfxRenderCache;
//     }

//     public abstract render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass;

//     public destroy(device: GfxDevice): void {
//         this.renderTarget.destroy(device);
//         this.renderHelper.destroy(device);
//     }
// }

export class SFARenderer implements Viewer.SceneGfx {
    // protected renderPass: GfxRenderPass;
    // protected viewport: any;
    protected sceneTexture = new ColorTexture();
    private sceneTextureSampler: GfxSampler | null = null;
    protected previousFrameTexture = new ColorTexture();
    private previousFrameTextureSampler: GfxSampler | null = null;

    // private mainColorTemporalTexture = new GfxrTemporalTexture();
    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    private renderHelper: GXRenderHelperGfx;

    constructor(device: GfxDevice, protected animController: SFAAnimationController) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 3); // Slow down the default camera a bit
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        this.animController.update(viewerInput);
    }

    protected addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {}

    protected addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {}
    protected addWorldRenderPasses(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number, mainDepthTargetID: number, sceneCtx: SceneRenderContext) {}

    // protected beginPass(viewerInput: Viewer.ViewerRenderInput, clipSpace: boolean = false) {
    //     const template = this.renderHelper.pushTemplateRenderInst();
    //     let oldProjection: mat4;
    //     if (clipSpace) {
    //         // XXX: clobber the projection matrix to identity
    //         // TODO: there should probably be a better way to do this
    //         oldProjection = mat4.clone(viewerInput.camera.projectionMatrix);
    //         mat4.identity(viewerInput.camera.projectionMatrix);
    //     }
    //     fillSceneParamsDataOnTemplate(template, viewerInput, 0);
    //     if (clipSpace) {
    //         mat4.copy(viewerInput.camera.projectionMatrix, oldProjection!);
    //     }
    // }

    // protected endPass(device: GfxDevice) {
    //     this.renderInstManager.popTemplateRenderInst();

    //     this.renderHelper.prepareToRender(device);

    //     this.renderInstManager.drawOnPassRenderer(device, this.renderPass);
    //     this.renderInstManager.resetRenderInsts();

    //     device.submitPass(this.renderPass);
    //     this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, noClearRenderPassDescriptor, this.sceneTexture.gfxTexture);
    // }

    private getSceneTextureSampler(device: GfxDevice) {
        if (this.sceneTextureSampler === null) {
            this.sceneTextureSampler = device.createSampler({
                wrapS: GfxWrapMode.CLAMP,
                wrapT: GfxWrapMode.CLAMP,
                minFilter: GfxTexFilterMode.BILINEAR,
                magFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.NO_MIP,
                minLOD: 0,
                maxLOD: 100,
            });
        }

        return this.sceneTextureSampler;
    }

    private getPreviousFrameTextureSampler(device: GfxDevice) {
        if (this.previousFrameTextureSampler === null) {
            this.previousFrameTextureSampler = device.createSampler({
                wrapS: GfxWrapMode.CLAMP,
                wrapT: GfxWrapMode.CLAMP,
                minFilter: GfxTexFilterMode.BILINEAR,
                magFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.NO_MIP,
                minLOD: 0,
                maxLOD: 100,
            });
        }

        return this.previousFrameTextureSampler;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        this.update(viewerInput);

        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        const sceneCtx: SceneRenderContext = {
            getSceneTexture: () => this.sceneTexture,
            getSceneTextureSampler: () => this.getSceneTextureSampler(device),
            getPreviousFrameTexture: () => this.previousFrameTexture,
            getPreviousFrameTextureSampler: () => this.getPreviousFrameTextureSampler(device),
            viewerInput,
            animController: this.animController,
        };

        // this.renderSky(device, renderInstManager, sceneCtx);

        this.addWorldRenderInsts(device, renderInstManager, sceneCtx);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        // this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        // this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        // this.viewport = viewerInput.viewport;
        // this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, standardFullClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        if (this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight)) {
            if (this.sceneTextureSampler !== null)
                device.destroySampler(this.sceneTextureSampler);
            this.sceneTextureSampler = null;
        }

        if (this.previousFrameTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight)) {
            if (this.previousFrameTextureSampler !== null)
                device.destroySampler(this.previousFrameTextureSampler);
            this.previousFrameTextureSampler = null;
        }

        this.mainColorDesc.setDimensions(viewerInput.backbufferWidth, viewerInput.backbufferHeight, viewerInput.sampleCount);
        this.mainColorDesc.colorClearColor = TransparentBlack;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue;

        // this.mainColorTemporalTexture.setDescription(device, this.mainColorDesc);

        const mainColorTargetID = builder.createRenderTargetID(this.mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        // builder.pushPass((pass) => {
        //     pass.setDebugName('Skybox');
        //     pass.setViewport(viewerInput.viewport);

        //     pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        //     pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
        //     pass.exec((passRenderer) => {

        //     });
        // });

        this.addWorldRenderPasses(device, builder, renderInstManager, mainColorTargetID, mainDepthTargetID, sceneCtx);

        // builder.pushPass((pass) => {
        //     pass.setDebugName('Main Opaque');
        //     pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        //     pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
        //     pass.exec((passRenderer, scope) => {

        //     });
        // });

        // this.previousFrameTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        // this.renderPass = this.renderTarget.createRenderPass(device, this.viewport, noClearRenderPassDescriptor, this.previousFrameTexture.gfxTexture);

        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        // TODO(jstpierre): Make it so that we don't need an extra pass for this blit in the future?
        // Maybe have copyTextureToTexture as a native device method?
        builder.pushPass((pass) => {
            pass.setDebugName('Copy to Temporal Texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.previousFrameTexture.gfxTexture!);
        // builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.mainColorTemporalTexture.getTextureForResolving());

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);

        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
    }
}
