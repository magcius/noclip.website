import { CameraController } from "../Camera";
import {
    makeBackbufferDescSimple,
    opaqueBlackFullClearRenderPassDescriptor,
    pushAntialiasingPostProcessPass,
} from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GXMaterialHacks } from "../gx/gx_material";
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from "../gx/gx_render";
import * as UI from "../ui";
import * as Viewer from "../viewer";
import { StageData, World } from "./World";

export class Renderer implements Viewer.SceneGfx {
    private renderHelper: GXRenderHelperGfx;
    private world: World;
    private renderCollision: boolean = false;
    constructor(device: GfxDevice, stageData: StageData) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.world = new World(device, this.renderHelper.getCache(), stageData);
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

        // Debug draw collision (eventually do it with polys)
        const drawColi = new UI.Checkbox("Draw Collision", false);
        drawColi.onchanged = () => {
            this.renderCollision = drawColi.checked;
        };
        renderHacksPanel.contents.appendChild(drawColi.elem);

        return [renderHacksPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);
        // The GXRenderHelper's pushTemplateRenderInst() sets some stuff on the template inst for
        // us. Use it once, then use the underlying GfxRenderInstManager's pushTemplateRenderInst().
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.world.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
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

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.world.destroy(device);
    }

    public adjustCameraController(c: CameraController) {
        // TODO(complexplane): Add ability to adjust camera speed range
        c.setKeyMoveSpeed(1);
    }
}
