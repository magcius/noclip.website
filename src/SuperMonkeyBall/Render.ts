import { CameraController } from "../Camera.js";
import {
    makeAttachmentClearDescriptor,
    makeBackbufferDescSimple,
    opaqueBlackFullClearRenderPassDescriptor,
} from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from "../gx/gx_render.js";
import * as UI from "../ui.js";
import * as Viewer from "../viewer.js";
import { StageData, World } from "./World.js";

// TODO(complexplane): Put somewhere else
export type RenderContext = {
    device: GfxDevice;
    renderInstManager: GfxRenderInstManager;
    viewerInput: Viewer.ViewerRenderInput;
    opaqueInstList: GfxRenderInstList;
    translucentInstList: GfxRenderInstList;
};

export class Renderer implements Viewer.SceneGfx {
    private renderHelper: GXRenderHelperGfx;
    private world: World;
    public textureCache: UI.TextureListHolder;
    private opaqueInstList = new GfxRenderInstList();
    private translucentInstList = new GfxRenderInstList();

    constructor(device: GfxDevice, private stageData: StageData) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.world = new World(device, this.renderHelper.renderCache, stageData);
        const textureCache = this.world.getTextureCache();
        this.textureCache = textureCache;
        textureCache.updateViewerTextures();
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");
        // Enable Vertex Color
        const enableVertexColorsCheckbox = new UI.Checkbox("Enable Vertex Colors", true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.world.setMaterialHacks({
                disableVertexColors: !enableVertexColorsCheckbox.checked,
            });
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        // Enable Texture
        const enableTextures = new UI.Checkbox("Enable Textures", true);
        enableTextures.onchanged = () => {
            this.world.setMaterialHacks({
                disableTextures: !enableTextures.checked,
            });
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    private prepareToRender(
        device: GfxDevice,
        viewerInput: Viewer.ViewerRenderInput,
        opaqueInstList: GfxRenderInstList,
        translucentInstList: GfxRenderInstList
    ): void {
        this.world.update(viewerInput);

        viewerInput.camera.setClipPlanes(0.1);
        // The GXRenderHelper's pushTemplateRenderInst() sets some stuff on the template inst for
        // us. Use it once, then use the underlying GfxRenderInstManager's pushTemplateRenderInst().
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput, 0);

        const renderCtx: RenderContext = {
            device,
            renderInstManager: this.renderHelper.renderInstManager,
            viewerInput,
            opaqueInstList,
            translucentInstList,
        };
        this.world.prepareToRender(renderCtx);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplate();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.Color0,
            viewerInput,
            makeAttachmentClearDescriptor(this.world.getClearColor())
        );
        const mainDepthDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.DepthStencil,
            viewerInput,
            opaqueBlackFullClearRenderPassDescriptor
        );

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.opaqueInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                this.translucentInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput, this.opaqueInstList, this.translucentInstList);

        this.renderHelper.renderGraph.execute(builder);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.world.destroy(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 32);
        c.setKeyMoveSpeed(20);
    }
}
