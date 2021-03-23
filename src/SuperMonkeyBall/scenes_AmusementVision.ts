import * as UI from '../ui';
import * as Viewer from '../viewer';
import * as GMA from './gma';
import * as AVtpl from './AVtpl';

import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from '../SceneBase';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { makeBackbufferDescSimple, GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from '../gx/gx_render';
import { AmusementVisionTextureHolder, GcmfModel, GcmfModelInstance, GMAData } from './render';
import AnimationController from '../AnimationController';
import { AVLZ_Type, decompressLZSS } from './AVLZ';
import { DataFetcher } from '../DataFetcher';
import { assertExists } from '../util';

enum Pass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

export class ModelChache{
    public gcmfChace = new Map<string, GcmfModel>();
    public modelIDChace = new Map<string, number>();

    public registGcmf(device: GfxDevice, renderer: AmusementVisionSceneRenderer, gmaData: GMAData, modelID: number) {
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

export class AmusementVisionSceneRenderer extends BasicGXRendererHelper {
    public renderHelper: GXRenderHelperGfx;

    public textureHolder = new AmusementVisionTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: GcmfModelInstance[] = [];
    public modelData: GcmfModel[] = [];

    public modelCache = new ModelChache();

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

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = this.modelInstances.length-1; i >= 0; i--)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }


    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
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
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

export class AmusementVisionSceneDesc {
    constructor(public id: string, public name: string, public type: AVLZ_Type = AVLZ_Type.NONE) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const sceneRender = new AmusementVisionSceneRenderer(device);
        
        const dataFetcher = context.dataFetcher;

        //load Model
        let modelID = 0;
        const model = await this.loadGMA(dataFetcher, `${this.id}`, modelID, this.type);
        sceneRender.modelCache.registGcmf(device, sceneRender, model, modelID++);
        
        // only show gma
        model.gma.gcmfEntrys.forEach(gcmfEntry => {
            const name = gcmfEntry.name;
            this.instanceModel(sceneRender, name);
        });

        return sceneRender;
    }

    public async loadGMA(dataFetcher: DataFetcher, path: string, modelID: number, type: AVLZ_Type = AVLZ_Type.NONE): Promise<GMAData>{
        let gmaPath = `${path}.gma`;
        let tplPath = `${path}.tpl`;
        const compress = type !== AVLZ_Type.NONE;
        if(compress === true){
            tplPath += `.lz`;
            gmaPath += `.lz`;
        }
        const tplData = await dataFetcher.fetchData(tplPath);
        const gmaData = await dataFetcher.fetchData(gmaPath);
        let rawTpl = tplData.slice(0x00);
        let rawGma = gmaData.slice(0x00);
        if (compress === true){
            rawTpl = decompressLZSS(tplData, type);
            rawGma = decompressLZSS(gmaData, type);
        }
        const tpl = AVtpl.parseAvTpl(rawTpl, modelID);
        const gma = GMA.parse(rawGma);

        return { gma, tpl }
    }

    public instanceModel(sceneRender: AmusementVisionSceneRenderer, name: string): GcmfModelInstance {
        const modelChace =  sceneRender.modelCache;
        const gcmfModel = assertExists(modelChace.gcmfChace.get(name));
        const modelID = assertExists(modelChace.modelIDChace.get(name));
        const modelInstance = new GcmfModelInstance(sceneRender.textureHolder, gcmfModel, modelID);
        modelInstance.passMask = Pass.MAIN;

        sceneRender.modelData.push(gcmfModel);
        sceneRender.modelInstances.push(modelInstance);
        return modelInstance;
    }
}