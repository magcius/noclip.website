import AnimationController from "../AnimationController";
import { CameraController } from "../Camera";
import { DataFetcher } from "../DataFetcher";
import {
    makeBackbufferDescSimple,
    opaqueBlackFullClearRenderPassDescriptor,
    pushAntialiasingPostProcessPass,
} from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GXMaterialHacks } from "../gx/gx_material";
import {
    BasicGXRendererHelper,
    fillSceneParamsDataOnTemplate,
    GXTextureHolder,
} from "../gx/gx_render";
import { SceneContext } from "../SceneBase";
import * as UI from "../ui";
import { assertExists, leftPad } from "../util";
import * as Viewer from "../viewer";
import { AVLZ_Type, decompressLZSS } from "./AVLZ";
import * as AVTpl from "./AVTpl";
import { debugDrawColi } from "./DebugDraw";
import * as Gcmf from "./Gcmf";
import { parseStagedefLz } from "./ParseStagedef";
import { StageId, BgType, STAGE_TO_BG_MAP, BG_TO_FILENAME_MAP } from "./StageInfo";
import { StageData, World } from "./World";

// TODO(complexplane): Do we really need a separate World class?
export class Renderer extends BasicGXRendererHelper {
    private world: World;
    private drawColi: boolean = false;
    private materialHacks: GXMaterialHacks;

    constructor(device: GfxDevice, stageData: StageData) {
        super(device);
        this.world = new World(device, this.getCache(), stageData);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");
        // Enable Vertex Color
        const enableVertexColorsCheckbox = new UI.Checkbox("Enable Vertex Colors", true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.materialHacks.disableVertexColors = !enableVertexColorsCheckbox.checked;
            this.world.setMaterialHacks(this.materialHacks);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        // Enable Texture
        const enableTextures = new UI.Checkbox("Enable Textures", true);
        enableTextures.onchanged = () => {
            this.materialHacks.disableTextures = !enableTextures.checked;
            this.world.setMaterialHacks(this.materialHacks);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        // Debug draw collision (eventually do it with polys)
        const drawColi = new UI.Checkbox("Draw Collision", false);
        drawColi.onchanged = () => {
            this.drawColi = drawColi.checked;
        };
        renderHacksPanel.contents.appendChild(drawColi.elem);

        return [renderHacksPanel];
    }

    public override prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);
        // The GXRenderHelper's pushTemplateRenderInst() sets some stuff on the template inst for
        // us. Use it once, then use the underlying GfxRenderInstManager's pushTemplateRenderInst().
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.world.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    // TODO(complexplane): Don't duplicate work in BasicGXRendererHelper?
    public override render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.Color0,
            viewerInput,
            opaqueBlackFullClearRenderPassDescriptor
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
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(
            mainColorTargetID,
            viewerInput.onscreenTexture
        );

        this.prepareToRender(device, viewerInput);

        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public override destroy(device: GfxDevice): void {
        // TODO(complexplane)
    }

    public adjustCameraController(c: CameraController) {
        // TODO(complexplane): Add ability to adjust camera speed range
        c.setKeyMoveSpeed(1);
    }
}
