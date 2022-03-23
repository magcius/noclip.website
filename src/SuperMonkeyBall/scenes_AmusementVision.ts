import * as UI from '../ui';
import * as Viewer from '../viewer';
import * as GMA from './gma';
import * as AVtpl from './AVtpl';

import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext } from '../SceneBase';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
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

export class ModelChache {
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
        for (let i = this.modelInstances.length - 1; i >= 0; i--)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
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
}

export class AmusementVisionSceneDesc {
    constructor(public id: string, public name: string, public type: AVLZ_Type = AVLZ_Type.NONE) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const sceneRender = new AmusementVisionSceneRenderer(device);

        const dataFetcher = context.dataFetcher;

        //load Model
        let prefix = 0;
        const model = await this.loadGMA(dataFetcher, `${this.id}`, prefix, this.type);
        sceneRender.modelCache.registGcmf(device, sceneRender, model, prefix++);

        // only show gma
        model.gma.gcmfEntrys.forEach(gcmfEntry => {
            const name = gcmfEntry.name;
            this.instanceModel(sceneRender, name);
        });

        return sceneRender;
    }

    public async loadGMA(dataFetcher: DataFetcher, path: string, prefix: number, type: AVLZ_Type = AVLZ_Type.NONE): Promise<GMAData> {
        let gmaPath = `${path}.gma`;
        let tplPath = `${path}.tpl`;
        const compress = type !== AVLZ_Type.NONE;
        if (compress === true) {
            tplPath += `.lz`;
            gmaPath += `.lz`;
        }
        const tplData = await dataFetcher.fetchData(tplPath);
        const gmaData = await dataFetcher.fetchData(gmaPath);
        let rawTpl = tplData.slice(0x00);
        let rawGma = gmaData.slice(0x00);
        if (compress === true) {
            rawTpl = decompressLZSS(tplData, type);
            rawGma = decompressLZSS(gmaData, type);
        }
        const tpl = AVtpl.parseAvTpl(rawTpl, prefix);
        const gma = GMA.parse(rawGma);

        return { gma, tpl }
    }

    public instanceModel(sceneRender: AmusementVisionSceneRenderer, name: string): GcmfModelInstance {
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

const id = 'supermonkeyball'
const name = 'Super Monkey Ball'

const sceneDescs = [
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_bns', 'bg_bns'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_bow', 'bg_bow'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_ending', 'bg_ending'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_ice', 'bg_ice'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_jun', 'bg_jun'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_mst', 'bg_mst'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_nig', 'bg_nig'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_pil', 'bg_pil'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_snd', 'bg_snd'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_snd', 'bg_spa'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_stm', 'bg_stm'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_sun', 'bg_sun'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/bg/bg_wat', 'bg_wat'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st001/st001', 'st001'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st002/st002', 'st002'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st003/st003', 'st003'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st004/st004', 'st004'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st005/st005', 'st005'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st006/st006', 'st006'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st007/st007', 'st007'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st008/st008', 'st008'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st009/st009', 'st009'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st010/st010', 'st010'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st011/st011', 'st011'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st012/st012', 'st012'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st013/st013', 'st013'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st014/st014', 'st014'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st015/st015', 'st015'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st016/st016', 'st016'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st017/st017', 'st017'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st018/st018', 'st018'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st019/st019', 'st019'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st020/st020', 'st020'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st021/st021', 'st021'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st022/st022', 'st022'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st023/st023', 'st023'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st024/st024', 'st024'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st025/st025', 'st025'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st026/st026', 'st026'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st027/st027', 'st027'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st028/st028', 'st028'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st029/st029', 'st029'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st030/st030', 'st030'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st031/st031', 'st031'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st032/st032', 'st032'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st033/st033', 'st033'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st034/st034', 'st034'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st035/st035', 'st035'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st036/st036', 'st036'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st037/st037', 'st037'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st038/st038', 'st038'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st039/st039', 'st039'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st040/st040', 'st040'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st041/st041', 'st041'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st042/st042', 'st042'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st043/st043', 'st043'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st044/st044', 'st044'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st045/st045', 'st045'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st046/st046', 'st046'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st047/st047', 'st047'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st048/st048', 'st048'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st049/st049', 'st049'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st050/st050', 'st050'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st051/st051', 'st051'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st052/st052', 'st052'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st053/st053', 'st053'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st054/st054', 'st054'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st055/st055', 'st055'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st056/st056', 'st056'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st057/st057', 'st057'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st058/st058', 'st058'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st059/st059', 'st059'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st060/st060', 'st060'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st061/st061', 'st061'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st062/st062', 'st062'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st063/st063', 'st063'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st064/st064', 'st064'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st065/st065', 'st065'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st066/st066', 'st066'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st067/st067', 'st067'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st068/st068', 'st068'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st069/st069', 'st069'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st070/st070', 'st070'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st071/st071', 'st071'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st072/st072', 'st072'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st073/st073', 'st073'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st074/st074', 'st074'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st075/st075', 'st075'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st076/st076', 'st076'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st077/st077', 'st077'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st078/st078', 'st078'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st079/st079', 'st079'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st080/st080', 'st080'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st081/st081', 'st081'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st082/st082', 'st082'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st083/st083', 'st083'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st084/st084', 'st084'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st085/st085', 'st085'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st086/st086', 'st086'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st087/st087', 'st087'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st088/st088', 'st088'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st089/st089', 'st089'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st090/st090', 'st090'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st091/st091', 'st091'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st092/st092', 'st092'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st093/st093', 'st093'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st094/st094', 'st094'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st095/st095', 'st095'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st096/st096', 'st096'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st097/st097', 'st097'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st098/st098', 'st098'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st099/st099', 'st099'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st100/st100', 'st100'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st101/st101', 'st101'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st102/st102', 'st102'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st103/st103', 'st103'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st104/st104', 'st104'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st105/st105', 'st105'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st106/st106', 'st106'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st107/st107', 'st107'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st108/st108', 'st108'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st109/st109', 'st109'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st110/st110', 'st110'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st111/st111', 'st111'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st112/st112', 'st112'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st113/st113', 'st113'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st114/st114', 'st114'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st115/st115', 'st115'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st116/st116', 'st116'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st117/st117', 'st117'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st118/st118', 'st118'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st119/st119', 'st119'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st120/st120', 'st120'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st121/st121', 'st121'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st122/st122', 'st122'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st123/st123', 'st123'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st124/st124', 'st124'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st125/st125', 'st125'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st126/st126', 'st126'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st127/st127', 'st127'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st128/st128', 'st128'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st129/st129', 'st129'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st130/st130', 'st130'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st131/st131', 'st131'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st132/st132', 'st132'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st133/st133', 'st133'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st134/st134', 'st134'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st135/st135', 'st135'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st136/st136', 'st136'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st137/st137', 'st137'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st138/st138', 'st138'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st139/st139', 'st139'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st140/st140', 'st140'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st141/st141', 'st141'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st142/st142', 'st142'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st143/st143', 'st143'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st144/st144', 'st144'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st145/st145', 'st145'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st146/st146', 'st146'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st147/st147', 'st147'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st148/st148', 'st148'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st149/st149', 'st149'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st150/st150', 'st150'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st151/st151', 'st151'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st152/st152', 'st152'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st153/st153', 'st153'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st154/st154', 'st154'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st155/st155', 'st155'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st156/st156', 'st156'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st157/st157', 'st157'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st158/st158', 'st158'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st159/st159', 'st159'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st160/st160', 'st160'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st161/st161', 'st161'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st162/st162', 'st162'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st163/st163', 'st163'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st164/st164', 'st164'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st165/st165', 'st165'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st166/st166', 'st166'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st167/st167', 'st167'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st168/st168', 'st168'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st169/st169', 'st169'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st170/st170', 'st170'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st171/st171', 'st171'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st172/st172', 'st172'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st173/st173', 'st173'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st174/st174', 'st174'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st175/st175', 'st175'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st176/st176', 'st176'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st177/st177', 'st177'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st178/st178', 'st178'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st179/st179', 'st179'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st180/st180', 'st180'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st181/st181', 'st181'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st182/st182', 'st182'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st183/st183', 'st183'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st184/st184', 'st184'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st185/st185', 'st185'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st186/st186', 'st186'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st187/st187', 'st187'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st188/st188', 'st188'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st189/st189', 'st189'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st190/st190', 'st190'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st191/st191', 'st191'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st192/st192', 'st192'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st193/st193', 'st193'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st194/st194', 'st194'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st195/st195', 'st195'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st196/st196', 'st196'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st197/st197', 'st197'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st198/st198', 'st198'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st199/st199', 'st199'),
    new AmusementVisionSceneDesc('SuperMonkeyBall/test/st200/st200', 'st200'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
