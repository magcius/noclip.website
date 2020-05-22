
import { MDL0Renderer, nnsG3dBindingLayouts } from "./render";
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import { FakeTextureHolder } from "../TextureHolder";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderDynamicUniformBuffer } from "../gfx/render/GfxRenderDynamicUniformBuffer";
import { assertExists } from "../util";
import { parseNSBMD } from "./NNS_G3D";
import { NITRO_Program } from "../SuperMario64DS/render";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";

class BasicNSBMDRenderer implements SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    public mdl0Renderers: MDL0Renderer[] = [];

    constructor(device: GfxDevice, public textureHolder: FakeTextureHolder) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);

        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].prepareToRender(this.renderInstManager, viewerInput);
        this.renderInstManager.popTemplateRenderInst();

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);
        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].destroy(device);
    }
}

export function createBasicNSBMDRendererFromNSBMD(device: GfxDevice, buffer: ArrayBufferSlice) {
    const textureHolder = new FakeTextureHolder([]);
    const renderer = new BasicNSBMDRenderer(device, textureHolder);

    const bmd = parseNSBMD(buffer);
    for (let i = 0; i < bmd.models.length; i++) {
        const mdl0 = bmd.models[0];
        const mdl0Renderer = new MDL0Renderer(device, mdl0, assertExists(bmd.tex0));
        for (let j = 0; j < mdl0Renderer.viewerTextures.length; j++)
            textureHolder.viewerTextures.push(mdl0Renderer.viewerTextures[j]);
        renderer.mdl0Renderers.push(mdl0Renderer);
    }

    return renderer;
}
