import AnimationController from '../AnimationController';
import { CameraController } from '../Camera';
import { DataFetcher } from '../DataFetcher';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import * as UI from '../ui';
import { assertExists, leftPad } from '../util';
import * as Viewer from '../viewer';
import { AVLZ_Type, decompressLZSS } from './AVLZ';
import * as AVtpl from './AVtpl';
import { debugDrawColi } from './DebugDraw';
import * as GMA from './Gcmf';
import { parseStagedefLz } from './ParseStagedef';
import { AmusementVisionTextureHolder, GcmfModel, GcmfModelInstance, StageData as StageData } from './Render';
import { StageId, BgType, STAGE_TO_BG_MAP, BG_TO_FILENAME_MAP } from './StageInfo';

enum Pass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

export class ModelCache {
    public gcmfCache = new Map<string, GcmfModel>();
    public modelIdCache = new Map<string, number>();

    public registGcmf(device: GfxDevice, renderer: SuperMonkeyBallSceneRenderer, gmaData: StageData, modelID: number) {
        renderer.textureHolder.addAVtplTextures(device, gmaData.stageTpl);
        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
        for (let i = 0; i < gmaData.stageGma.gcmfEntries.length; i++) {
            const gcmf = new GcmfModel(device, cache, gmaData.stageGma.gcmfEntries[i]);
            this.gcmfCache.set(gcmf.gcmfEntry.name, gcmf);
            this.modelIdCache.set(gcmf.gcmfEntry.name, modelID);
        }
    }

    public destroy(device: GfxDevice): void {
        for (const [, v] of this.gcmfCache.entries())
            v.destroy(device);
    }
}

export class SuperMonkeyBallSceneRenderer extends BasicGXRendererHelper {
    public textureHolder = new AmusementVisionTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: GcmfModelInstance[] = [];
    public modelData: GcmfModel[] = [];

    public modelCache = new ModelCache();
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
        c.setKeyMoveSpeed(1);
    }
}
export class SuperMonkeyBallSceneDesc {
    public id: string;
    public name: string;
    private stageId: StageId;

    constructor(stageId: StageId, name: string) {
        this.stageId = stageId;
        this.id = name;
        this.name = name;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        //load stage
        let prefix = 0;
        const stageDefn = await this.loadStage(dataFetcher, this.stageId);
        const sceneRender = new SuperMonkeyBallSceneRenderer(device, stageDefn);
        sceneRender.modelCache.registGcmf(device, sceneRender, stageDefn, prefix++);

        // only show gma
        stageDefn.stageGma.gcmfEntries.forEach(gcmfEntry => {
            const name = gcmfEntry.name;
            this.instanceModel(sceneRender, name);
        });

        return sceneRender;
    }

    public async loadStage(dataFetcher: DataFetcher, stageId: StageId): Promise<StageData> {
        const gameFilesPath = 'SuperMonkeyBall/test';
        const stageIdStr = leftPad(stageId.toString(), 3, '0');
        const stagedefPath = `${gameFilesPath}/st${stageIdStr}/STAGE${stageIdStr}.lz`;
        const stageGmaPath = `${gameFilesPath}/st${stageIdStr}/st${stageIdStr}.gma`;
        const stageTplPath = `${gameFilesPath}/st${stageIdStr}/st${stageIdStr}.tpl`;
        const bgFilename = BG_TO_FILENAME_MAP[STAGE_TO_BG_MAP[stageId]];
        const bgGmaPath = `${gameFilesPath}/bg/${bgFilename}.gma`;
        const bgTplPath = `${gameFilesPath}/bg/${bgFilename}.tpl`;

        const [stagedefBuf, stageGmaBuf, stageTplBuf, bgGmaBuf, bgTplBuf] = await Promise.all([
            dataFetcher.fetchData(stagedefPath),
            dataFetcher.fetchData(stageGmaPath),
            dataFetcher.fetchData(stageTplPath),
            dataFetcher.fetchData(bgGmaPath),
            dataFetcher.fetchData(bgTplPath),
        ]);

        const stagedef = parseStagedefLz(stagedefBuf);
        const stageGma = GMA.parse(stageGmaBuf);
        const stageTpl = AVtpl.parseAvTpl(stageTplBuf, 0);
        const bgGma = GMA.parse(bgGmaBuf);
        const bgTpl = AVtpl.parseAvTpl(bgTplBuf, 0);

        return { stagedef, stageGma, stageTpl, bgGma, bgTpl };
    }

    public instanceModel(sceneRender: SuperMonkeyBallSceneRenderer, name: string): GcmfModelInstance {
        const modelCache = sceneRender.modelCache;
        const gcmfModel = assertExists(modelCache.gcmfCache.get(name));
        const modelId = assertExists(modelCache.modelIdCache.get(name));
        const modelInstance = new GcmfModelInstance(sceneRender.textureHolder, gcmfModel, modelId);
        modelInstance.passMask = Pass.MAIN;

        sceneRender.modelData.push(gcmfModel);
        sceneRender.modelInstances.push(modelInstance);
        return modelInstance;
    }
}
