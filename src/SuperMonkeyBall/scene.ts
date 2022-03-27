import AnimationController from '../AnimationController';
import { CameraController } from '../Camera';
import { DataFetcher } from '../DataFetcher';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import * as UI from '../ui';
import { assertExists } from '../util';
import * as Viewer from '../viewer';
import { AVLZ_Type, decompressLZSS } from './AVLZ';
import * as AVtpl from './AVtpl';
import * as GMA from './gma';
import { parseStagedefLz } from './parseStagedef';
import { AmusementVisionTextureHolder, GcmfModel, GcmfModelInstance, GMAData as StageData } from './render';
import {debugDrawColi} from './debugDraw';
import { isOnGround } from '../SuperMarioGalaxy/Collision';

enum Pass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

export class ModelChache {
    public gcmfChace = new Map<string, GcmfModel>();
    public modelIDChace = new Map<string, number>();

    public registGcmf(device: GfxDevice, renderer: SuperMonkeyBallSceneRenderer, gmaData: StageData, modelID: number) {
        renderer.textureHolder.addAVtplTextures(device, gmaData.tpl);
        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
        for (let i = 0; i < gmaData.gma.gcmfEntrys.length; i++) {
            const gcmf = new GcmfModel(device, cache, gmaData.gma.gcmfEntrys[i]);
            this.gcmfChace.set(gcmf.gcmfEntry.name, gcmf);
            this.modelIDChace.set(gcmf.gcmfEntry.name, modelID);
        }
    }

    public destroy(device: GfxDevice): void {
        for (const [, v] of this.gcmfChace.entries())
            v.destroy(device);
    }
}

export class SuperMonkeyBallSceneRenderer extends BasicGXRendererHelper {
    public textureHolder = new AmusementVisionTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: GcmfModelInstance[] = [];
    public modelData: GcmfModel[] = [];

    public modelCache = new ModelChache();
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
    constructor(public id: string, public name: string, public type: AVLZ_Type = AVLZ_Type.NONE) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {

        const dataFetcher = context.dataFetcher;

        //load stage
        let prefix = 0;
        const stageDefn = await this.loadStage(dataFetcher, `${this.id}`, this.name, prefix, this.type);
        const sceneRender = new SuperMonkeyBallSceneRenderer(device, stageDefn);
        sceneRender.modelCache.registGcmf(device, sceneRender, stageDefn, prefix++);

        // only show gma
        stageDefn.gma.gcmfEntrys.forEach(gcmfEntry => {
            const name = gcmfEntry.name;
            this.instanceModel(sceneRender, name);
        });

        return sceneRender;
    }

    public async loadStage(dataFetcher: DataFetcher, dirPath: string, stageName: string, prefix: number, type: AVLZ_Type = AVLZ_Type.NONE): Promise<StageData> {
        // TODO cleanup

        let gmaPath = `${dirPath}/${stageName}.gma`;
        let tplPath = `${dirPath}/${stageName}.tpl`;
        const compress = type !== AVLZ_Type.NONE;
        if (compress) {
            tplPath += ".lz";
            gmaPath += ".lz";
        }
        const [tplData, gmaData] = await Promise.all([
            dataFetcher.fetchData(tplPath),
            dataFetcher.fetchData(gmaPath),
        ]);
        let rawTpl = tplData.slice(0x00);
        let rawGma = gmaData.slice(0x00);
        if (compress) {
            rawTpl = decompressLZSS(tplData, type);
            rawGma = decompressLZSS(gmaData, type);
        }
        const tpl = AVtpl.parseAvTpl(rawTpl, prefix);
        const gma = GMA.parse(rawGma);

        let stagedef = undefined;
        if (!stageName.startsWith("bg_")) {
            const stageIdStr = stageName.slice(-3);
            const stagedefPath = `${dirPath}/STAGE${stageIdStr}.lz`;
            const stagedefData = await dataFetcher.fetchData(stagedefPath);
            stagedef = parseStagedefLz(stagedefData);
        }

        return { gma, tpl, stagedef }
    }

    public instanceModel(sceneRender: SuperMonkeyBallSceneRenderer, name: string): GcmfModelInstance {
        const modelChace = sceneRender.modelCache;
        const gcmfModel = assertExists(modelChace.gcmfChace.get(name));
        const modelID = assertExists(modelChace.modelIDChace.get(name));
        const modelInstance = new GcmfModelInstance(sceneRender.textureHolder, gcmfModel, modelID);
        modelInstance.passMask = Pass.MAIN;

        sceneRender.modelData.push(gcmfModel);
        sceneRender.modelInstances.push(modelInstance);
        return modelInstance;
    }
}
