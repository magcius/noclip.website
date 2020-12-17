import * as Viewer from '../viewer';
import * as  GMA from './gma';
import * as AVtpl from './AVtpl';
import * as LZSS from "../Common/Compression/LZSS"

import { AmusementVisionTextureHolder, GcmfModel, GcmfModelInstance } from './render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { BasicRenderTarget, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';
import AnimationController from '../AnimationController';
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx, } from '../gx/gx_render';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import * as UI from '../ui';

enum FZEROGXPass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

export class FZEROGXSceneRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public renderTarget = new BasicRenderTarget();

    public textureHolder = new AmusementVisionTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: GcmfModelInstance[] = [];
    public modelData: GcmfModel[] = [];
    
    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(this.renderHelper.renderInstManager, device, mainPassRenderer, FZEROGXPass.MAIN);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

const pathBase = `FZEROGX`;
class FZEROGXSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public backGroundName: string, public name: string) {
    }

    // COLI Scene
    public static createSceneFromCOLIScene(device: GfxDevice, lzss: ArrayBufferSlice): FZEROGXSceneRenderer {
        const sceneRenderer = new FZEROGXSceneRenderer(device);





        return sceneRenderer;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        // decompress F-ZERO GX's LZSS
        function decompressLZSS(buffer:ArrayBufferSlice){
            const srcView = buffer.createDataView();
            const uncompressedSize = srcView.getUint32(0x04, true);
            return LZSS.decompress(buffer.slice(8).createDataView(), uncompressedSize);
        }

        const dataFetcher = context.dataFetcher;
        const stageId = `st${this.id}`;
        const gmaPath = `${pathBase}/stage/${stageId}.gma.lz`;
        const tplPath = `${pathBase}/stage/${stageId}.tpl.lz`;
        return Promise.all([dataFetcher.fetchData(gmaPath), dataFetcher.fetchData(tplPath)]).then(([gmaData, tplData]) => {
            const sceneRender = new FZEROGXSceneRenderer(device);
            context.destroyablePool.push(sceneRender);
            const cache = sceneRender.renderHelper.renderInstManager.gfxRenderCache;

            // tpl
            const tpl = AVtpl.parseAvTpl(decompressLZSS(tplData));  
            sceneRender.textureHolder.addAVtplTextures(device, tpl);
            // gma
            const gma = GMA.parse(decompressLZSS(gmaData));
            for(let i = 0; i < gma.gcmfEntrys.length; i++){
                const modelData = new GcmfModel(device, cache, gma.gcmfEntrys[i]);
                const modelInstance = new GcmfModelInstance(sceneRender.textureHolder, modelData);
                modelInstance.passMask = FZEROGXPass.MAIN;

                sceneRender.modelData.push(modelData);
                sceneRender.modelInstances.push(modelInstance);
            }

            return sceneRender;
        });
    }
}

const id = 'fzgx';
const name = 'F-ZERO GX';
const sceneDescs = [
    "Rudy Cup",
    new FZEROGXSceneDesc("01", "mut", "Mute City - Twist Road"),
    new FZEROGXSceneDesc("16", "cas", "Casino Palace - Split Oval"),
    new FZEROGXSceneDesc("26", "san", "Sand Ocean - Surface Slide"), //
    new FZEROGXSceneDesc("08", "lig", "Lightning - Loop Cross"),
    new FZEROGXSceneDesc("05", "tow", "Aeropolis - Multiplex"),
    // new FZEROGXSceneDesc("01", "mut_jp", "[JP]Mute City - Twist Road"),
    "Sapphire Cup",
    new FZEROGXSceneDesc("14", "big", "Big Blue - Drift Highway"),
    new FZEROGXSceneDesc("13", "por", "Port Town - Long Pipe"),
    new FZEROGXSceneDesc("11", "for", "Green Plant - Mobious Ring"), //
    new FZEROGXSceneDesc("07", "por", "Port Town - Aerodive"),
    new FZEROGXSceneDesc("03", "mut", "Mute City - Serial Gaps"),
    // new FZEROGXSceneDesc("03", "mut_jp", "[JP]Mute City - Serial Gaps"),
    "Emerald Cup",
    new FZEROGXSceneDesc("15", "fir", "Fire Field - Cylinder Knot"),
    new FZEROGXSceneDesc("10", "for", "Green Plant - Intersection"), //
    new FZEROGXSceneDesc("29", "cas", "Casino Palace - Double Branches"),
    new FZEROGXSceneDesc("09", "lig", "Lightning - Half-Pipe"),
    new FZEROGXSceneDesc("27", "big", "Big Blue - Ordeal"),
    // new FZEROGXSceneDesc("15", "fir_jp", "[JP]Fire Field Cylinder Knot"),
    "Diamond Cup",
    new FZEROGXSceneDesc("24", "ele", "Cosmo Termial - Trident"),
    new FZEROGXSceneDesc("25", "san", "Sand Ocean - Lateral Shift"), //
    new FZEROGXSceneDesc("17", "fir", "Fire Field - Undulation"),
    new FZEROGXSceneDesc("21", "tow", "Aeropolis - Dragon Slope"),
    new FZEROGXSceneDesc("28", "rai", "Phantom Road - Slim-Line Slits"),
    // new FZEROGXSceneDesc("17", "fir_jp", "[JP]Fire Field - Undulation"),
    "AX Cup",
    new FZEROGXSceneDesc("31", "tow", "Aeropolis - Screw Drive"),
    new FZEROGXSceneDesc("32", "met", "Outer Space - Meteor Stream"), //
    new FZEROGXSceneDesc("33", "por", "Port Town - Cylinder Wave"),
    new FZEROGXSceneDesc("34", "lig", "Lightning - Thunder Road"),
    new FZEROGXSceneDesc("35", "for", "Green Plant - Spiral"), //
    new FZEROGXSceneDesc("36", "com", "Mute City - Sonic Oval"),
    "Story Mode",
    new FZEROGXSceneDesc("37", "com_s", "Chapter 1"),
    new FZEROGXSceneDesc("38", "san_s", "Chapter 2"), //
    new FZEROGXSceneDesc("39", "cas_s", "Chapter 3"),
    new FZEROGXSceneDesc("40", "big_s", "Chapter 4"),
    new FZEROGXSceneDesc("41", "por_s", "Chapter 5"),
    new FZEROGXSceneDesc("42", "lig_s", "Chapter 6"),
    new FZEROGXSceneDesc("43", "mut_s", "Chapter 7"), //
    new FZEROGXSceneDesc("44", "fir_s", "Chapter 8"),
    new FZEROGXSceneDesc("45", "rai_s", "Chapter 9"),
    // new FZEROGXSceneDesc("43", "mut_s_jp", "[JP]Chapter 7"),
    "MISC",
    new FZEROGXSceneDesc("49", "com", "Interview"),
    new FZEROGXSceneDesc("50", "com", "Victory Lap"),
    new FZEROGXSceneDesc("00", "", "st00"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };