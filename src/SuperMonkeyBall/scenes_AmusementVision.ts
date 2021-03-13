import * as UI from '../ui';
import * as Viewer from '../viewer';
import * as GMA from './gma';
import * as AVtpl from './AVtpl';

import { GfxDevice } from "../gfx/platform/GfxPlatform";
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
        // this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
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
    constructor(public id: string, public backGroundName: string, public name: string) {
    }

    public async loadGMA(dataFetcher: DataFetcher, path: string, modelID: number, compress: boolean = false, type: AVLZ_Type = AVLZ_Type.NONE): Promise<GMAData>{
        let gmaPath = `${path}.gma`;
        let tplPath = `${path}.tpl`;
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