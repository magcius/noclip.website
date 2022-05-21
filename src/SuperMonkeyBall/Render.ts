import { Camera, CameraController } from "../Camera";
import {
    makeAttachmentClearDescriptor,
    makeBackbufferDescSimple,
    opaqueBlackFullClearRenderPassDescriptor,
    pushAntialiasingPostProcessPass,
} from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GXMaterialHacks } from "../gx/gx_material";
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from "../gx/gx_render";
import * as Viewer from "../viewer";
import { ModelCache } from "./ModelCache";
import { StageData, World } from "./World";
import * as UI from "../ui";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { S16_TO_RADIANS, Sphere } from "./Utils";
import { mat4, vec3 } from "gl-matrix";
import { MathConstants } from "../MathHelpers";

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
    private modelCache: ModelCache;
    public textureHolder: UI.TextureListHolder;
    private opaqueInstList = new GfxRenderInstList();
    private translucentInstList = new GfxRenderInstList();
    private firstRender = true;

    constructor(device: GfxDevice, private stageData: StageData) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.modelCache = new ModelCache(device, this.renderHelper.getCache(), stageData);
        this.world = new World(device, this.renderHelper.getCache(), this.modelCache, stageData);
        this.textureHolder = this.modelCache.getTextureHolder();
        this.modelCache.getTextureHolder().updateViewerTextures();
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");
        // Enable Vertex Color
        const enableVertexColorsCheckbox = new UI.Checkbox("Enable Vertex Colors", true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.modelCache.setMaterialHacks({
                disableVertexColors: !enableVertexColorsCheckbox.checked,
            });
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        // Enable Texture
        const enableTextures = new UI.Checkbox("Enable Textures", true);
        enableTextures.onchanged = () => {
            this.modelCache.setMaterialHacks({
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

        if (this.firstRender) {
            this.firstRender = false;
        }

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
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.disableSimpleMode();

        const mainColorDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.Color0,
            viewerInput,
            makeAttachmentClearDescriptor(this.stageData.stageInfo.bgInfo.clearColor)
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
                this.opaqueInstList.drawOnPassRenderer(this.renderHelper.getCache(), passRenderer);
                this.translucentInstList.drawOnPassRenderer(this.renderHelper.getCache(), passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput, this.opaqueInstList, this.translucentInstList);

        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
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
