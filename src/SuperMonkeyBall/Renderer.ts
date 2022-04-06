import AnimationController from '../AnimationController';
import { CameraController } from '../Camera';
import { DataFetcher } from '../DataFetcher';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXTextureHolder } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import * as UI from '../ui';
import { assertExists, leftPad } from '../util';
import * as Viewer from '../viewer';
import { AVLZ_Type, decompressLZSS } from './AVLZ';
import * as AVTpl from './AVTpl';
import { debugDrawColi } from './DebugDraw';
import * as Gcmf from './Gcmf';
import { parseStagedefLz } from './ParseStagedef';
import { GcmfModel, GcmfModelInstance, StageData as StageData } from './Render';
import { StageId, BgType, STAGE_TO_BG_MAP, BG_TO_FILENAME_MAP } from './StageInfo';

export class Renderer extends BasicGXRendererHelper {


    private drawColi: boolean = false;

    constructor(private device: GfxDevice, private stageData: StageData) {
        super(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        // Enable Vertex Color
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        // Enable Texture
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        // Debug draw collision (eventually do it with polys)
        const drawColi = new UI.Checkbox('Draw Collision', false);
        drawColi.onchanged = () => {
            this.drawColi = drawColi.checked;
        };
        renderHacksPanel.contents.appendChild(drawColi.elem);

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = this.modelInstances.length - 1; i >= 0; i--)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        if (this.stageData.stagedef !== undefined && this.drawColi) {
            debugDrawColi(this.stageData.stagedef, viewerInput.camera);
        }
    }


    public override render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

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

    public override destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy();

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }

    public adjustCameraController(c: CameraController) {
        // todo(complexplane): Add ability to adjust camera speed range
        c.setKeyMoveSpeed(1);
    }
}

