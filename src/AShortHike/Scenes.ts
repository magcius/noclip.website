
import * as Viewer from '../viewer';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, GfxInputState, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { createUnityRuntime, UnityRuntime, MeshRenderer as UnityMeshRenderer } from '../Common/Unity/GameObject';

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 },
];

class UnityRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public inputState: GfxInputState;

    constructor(private runtime: UnityRuntime) {
        this.renderHelper = new GfxRenderHelper(this.runtime.context.device, this.runtime.context);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.runtime.update();

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(0, 32);
        const mapped = template.mapUniformBufferF32(0);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.viewMatrix);

        const meshRenderers = this.runtime.getComponents(UnityMeshRenderer);
        for (let i = 0; i < meshRenderers.length; i++)
            meshRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.runtime.destroy(device);
        this.renderHelper.destroy();
    }
}

class AShortHikeSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const runtime = await createUnityRuntime(context, `AShortHike`);
        await runtime.loadLevel(this.id);

        const renderer = new UnityRenderer(runtime);
        return renderer;
    }

}

const id = 'AShortHike';
const name = 'A Short Hike';

const sceneDescs = [
    new AShortHikeSceneDesc(`level2`, "The Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: true };
