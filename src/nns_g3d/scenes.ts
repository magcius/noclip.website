
import { MDL0Renderer, nnsG3dBindingLayouts } from "./render.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { FakeTextureHolder } from "../TextureHolder.js";
import { ViewerRenderInput, SceneGfx } from "../viewer.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { assertExists } from "../util.js";
import { BTX0, parseNSBMD, parseNSBTX } from "./NNS_G3D.js";
import { NITRO_Program } from "../SuperMario64DS/render.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";

class BasicNSBMDRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    public mdl0Renderers: MDL0Renderer[] = [];

    constructor(device: GfxDevice, public textureHolder: FakeTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderCache;
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16+32);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy();

        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].destroy(device);
    }
}

export function createBasicNSBMDRendererFromNSBMD(device: GfxDevice, buffers: NamedArrayBufferSlice[]) {
    const textureHolder = new FakeTextureHolder([]);
    const renderer = new BasicNSBMDRenderer(device, textureHolder);

    const texs = buffers.filter((x) => x.name.endsWith('.nsbtx')).map((x) => parseNSBTX(x));
    let btx0: BTX0 | null = null;
    for (let i = 0; i < texs.length; i++) {
        const e = texs[i];
        if (btx0 === null) {
            btx0 = e;
            continue;
        }

        btx0.tex0.textures.push(...e.tex0.textures);
        btx0.tex0.palettes.push(...e.tex0.palettes);
    }

    const bmds = buffers.filter((x) => x.name.endsWith('.nsbmd')).map((x) => parseNSBMD(x));
    for (let i = 0; i < bmds.length; i++) {
        const bmd = bmds[i];
        for (let j = 0; j < bmd.models.length; j++) {
            const mdl0 = bmd.models[j];
            const mdl0Renderer = new MDL0Renderer(renderer.getCache(), mdl0, bmd.tex0 ?? assertExists(btx0).tex0);
            for (let k = 0; k < mdl0Renderer.viewerTextures.length; k++)
                textureHolder.viewerTextures.push(mdl0Renderer.viewerTextures[k]);
            renderer.mdl0Renderers.push(mdl0Renderer);
        }
    }

    return renderer;
}
