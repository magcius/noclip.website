
import { mat4, vec3 } from "gl-matrix";
import { CameraController } from '../Camera.js';
import { colorNewFromRGBA } from "../Color.js";
import { SceneContext } from '../SceneBase.js';
import { FakeTextureHolder, TextureHolder } from '../TextureHolder.js';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxProgram } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import * as SINFO from "./sceneInfo.js";
import * as UI from '../ui.js';
import * as Viewer from '../viewer.js';
import * as BUNDLE from "./bundle.js";
import * as CHR from './chr.js';
import * as IMG from './img.js';
import * as MAP from './map.js';
import * as MDS from './mds.js';
import { CHRRenderer, DQ8Program, MAPRenderer, MDSInstance, fillSceneParamsDataOnTemplate, textureToCanvas } from './render.js';
import * as STB from "./stb.js";
import { assert } from "../util.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 }, // ub_SceneParams, ub_SubmeshParams
];

export class DQ8Renderer implements Viewer.SceneGfx {
    public MAPRenderers: MAPRenderer[] = [];
    public CHRRenderers: CHRRenderer[] = [];
    public MDSRenderers: MDSInstance[] = [];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>, public sceneDesc: SceneDesc, public texNameToTextureData: Map<string, IMG.TextureData>) {
        this.renderHelper = new GfxRenderHelper(device);
        SINFO.gDQ8SINFO.reset();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 30);
    }

    public getRenderCache(): GfxRenderCache {
        return this.renderHelper.renderCache;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);
        if(SINFO.gDQ8SINFO.bWireframe)
            template.setMegaStateFlags({ wireframe: true });

        this.renderHelper.renderInstManager.setCurrentRenderInstList(this.renderInstListMain);

        //Renderers
        for (let i = 0; i < this.MAPRenderers.length; i++)
            this.MAPRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.CHRRenderers.length; i++)
            this.CHRRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.MDSRenderers.length; i++)
            this.MDSRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        let clearColor = colorNewFromRGBA(1, 0, 0);

        SINFO.UpdateSceneInfo(SINFO.gDQ8SINFO, viewerInput.deltaTime);

        if (SINFO.gDQ8SINFO.currentLightSet)
            clearColor = SINFO.gDQ8SINFO.currentLightSet!.bgcolor;
        const passDescriptor = makeAttachmentClearDescriptor(clearColor);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, passDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, passDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');

        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
        renderInstManager.resetRenderInsts();
    }

    private createProgressPanel(sceneDesc: SceneDesc): UI.Panel {
        const progressPanel = new UI.Panel();
        progressPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        progressPanel.setTitle(UI.SAND_CLOCK_ICON, 'Game Progress');
        const progressSelect = new UI.SingleSelect();
        progressSelect.setStrings(sceneDesc.progressFList);
        progressSelect.onselectionchange = (strIndex: number) => {
            SINFO.gDQ8SINFO.currentGameProgress = sceneDesc.indexToProgress[strIndex];
        };
        progressSelect.selectItem(0);
        progressPanel.contents.appendChild(progressSelect.elem);
        return progressPanel;
    }

    private createDayHourPanel(): UI.Panel {
        const hourPanel = new UI.Panel();
        hourPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        hourPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Time Of Day');
        const hourSelect = new UI.SingleSelect();
        const indexToUserHour = [-1, 1.5, 6.5, 9.5, 17.5, 18.5, 19.5];
        hourSelect.setStrings(["Dynamic", "1:30", "6:30", "9:30", "17:30", "18:30", "19:30"]);
        hourSelect.onselectionchange = (strIndex: number) => {
            SINFO.gDQ8SINFO.currentUserHour = indexToUserHour[strIndex];
        };
        hourSelect.selectItem(0);
        hourPanel.contents.appendChild(hourSelect.elem);
        return hourPanel;
    }

    private createRenderHackPanel(): UI.Panel {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            SINFO.gDQ8SINFO.bUseVColors = enableVertexColorsCheckbox.checked;
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        if (this.renderHelper.device.queryLimits().wireframeSupported) {
            const wireframe = new UI.Checkbox('Wireframe', false);
            wireframe.onchanged = () => {
                SINFO.gDQ8SINFO.bWireframe = wireframe.checked;
            };
            renderHacksPanel.contents.appendChild(wireframe.elem);
        }

        return renderHacksPanel;

        
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];
        if (this.sceneDesc.progressFList.length)
            panels.push(this.createProgressPanel(this.sceneDesc));
        panels.push(this.createDayHourPanel());
        panels.push(this.createRenderHackPanel());
        return panels;
    }

    public destroyHelp(device: GfxDevice) {
        for (const [k, v] of this.texNameToTextureData) {
            device.destroyTexture(v.texture);
        }
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (let i = 0; i < this.MAPRenderers.length; i++)
            this.MAPRenderers[i].destroy(device);
        for (let i = 0; i < this.CHRRenderers.length; i++)
            this.CHRRenderers[i].destroy(device);
        for (let i = 0; i < this.MDSRenderers.length; i++)
            this.MDSRenderers[i].destroy(device);
        this.destroyHelp(device);
        this.textureHolder.destroy(device);
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public mID: string, public bChrViewer: boolean = false, public bIsSky: boolean = false,
        public progressFList: string[] = [], public indexToProgress: number[] = []) {
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const viewerTextures: Viewer.Texture[] = [];
        const dataFetcher = context.dataFetcher;
        const fakeTextureHolder = new FakeTextureHolder(viewerTextures);
        const texNameToTextureData = new Map<string, IMG.TextureData>();
        const renderer = new DQ8Renderer(gfxDevice, fakeTextureHolder, this, texNameToTextureData);
        const cache = renderer.getRenderCache();
        const canvasTexMap = new Map<string, boolean>();
        const chrMap = new Map<string, CHR.CHR>();
        const chrs: CHR.CHR[] = [];
        const stbs: (STB.STB | null)[] = [];
        const chrTransforms: mat4[] = [];
        const chrEulerRotations: vec3[] = [];
        const chrNPCDayPeriods: (SINFO.ENPCDayPeriod | null)[] = [];
        const chrDayPeriodFlags: (number | null)[] = [];
        const chrProgressFlags: (number | null)[] = [];

        const skelModelSet = new Set<string>([ // model matrices used instead of local ones for joints
            "b600a.chr",
            "c004_skin2.chr",
            "cp002.chr",
            "en041a.chr",
            "en042a.chr",
            "en063a.chr",
            "en070a.chr",
            "en091a.chr",
            "en092a.chr",
            "en116a.chr",
            "en117a.chr",
            "jinmenju.chr",
            "k_shitai.chr",
            "mp006a.chr",
            "p024d.chr",
            "p024c.chr",
            "p024d.chr",
            "p024e.chr",
            "p073a.chr",
            "p073a_iro.chr",
            "sp001.chr",
        ]);

        const dispoBuffer = await dataFetcher.fetchData(`DragonQuest8/event/villager/disposition/${this.mID}.cfg`, { allow404: true });
        const vID = this.mID.split("i")[0].split("_")[0];
        const vScriptBuffer = await dataFetcher.fetchData(`DragonQuest8/event/villager/script/${vID}.pac`, { allow404: true });
        if (dispoBuffer.byteLength) {
            let vScriptInfo = null;
            if (vScriptBuffer.byteLength) {
                vScriptInfo = BUNDLE.parseBundle(vScriptBuffer);
            }
            const progressFToDispoInfo = CHR.parseDispositionCfg(dispoBuffer);
            this.progressFList = [];
            this.indexToProgress = [];
            for (const [progressF, dayPToNpcInfo] of progressFToDispoInfo) {
                this.progressFList.push("Scenario progress " + (this.progressFList.length + 1).toString());
                this.indexToProgress.push(progressF);
                for (const [dayPeriod, nPCInfo] of dayPToNpcInfo) {
                    for (let j = 0; j < nPCInfo.length; j++) {
                        const npcInfo = nPCInfo[j];
                        if (!chrMap.has(npcInfo.npcFileName)) {
                            const chrBuffer = await dataFetcher.fetchData(`DragonQuest8/${npcInfo.npcFileName}`);
                            const baseName = npcInfo.npcFileName.split("/")[1];
                            chrs.push(CHR.parse(cache, chrBuffer, chrBuffer.name, true, null, skelModelSet.has(baseName)));
                            //Party members extra resources, see Purgatory island. Keeping these split if skin/mapping changes later
                            if (baseName === "c002_skin1.chr") { //Yangus
                                const extraResBuffer = await dataFetcher.fetchData("DragonQuest8/chara/c002_base1.chr");
                                CHR.updateChrWithChr(chrs[chrs.length - 1], CHR.parse(cache, extraResBuffer, extraResBuffer.name));
                            }
                            else if (baseName === "c003_skin1.chr") { //Angelo
                                const extraResBuffer = await dataFetcher.fetchData("DragonQuest8/chara/c003_base1.chr");
                                CHR.updateChrWithChr(chrs[chrs.length - 1], CHR.parse(cache, extraResBuffer, extraResBuffer.name));
                            }
                            else if (baseName === "c004_skin2.chr") { //Jessica
                                const extraResBuffer = await dataFetcher.fetchData("DragonQuest8/chara/c004_base1.chr");
                                CHR.updateChrWithChr(chrs[chrs.length - 1], CHR.parse(cache, extraResBuffer, extraResBuffer.name));
                            }
                            chrMap.set(npcInfo.npcFileName, chrs[chrs.length - 1]);
                            //External resources
                            if (npcInfo.npcExtraResPath !== "") {
                                const extraResBuffer = await dataFetcher.fetchData(`DragonQuest8/${npcInfo.npcExtraResPath.toLowerCase()}`);
                                assert(npcInfo.npcExtraResPath.endsWith('.chr'));
                                CHR.updateChrWithChr(chrs[chrs.length - 1], CHR.parse(cache, extraResBuffer, extraResBuffer.name));
                            }
                        }
                        else {
                            chrs.push(chrMap.get(npcInfo.npcFileName) as CHR.CHR);
                        }

                        if (vScriptInfo !== null) {
                            const stbName = "v" + npcInfo.npcScript.toString() + ".stb";
                            if (!vScriptInfo.has(stbName))
                                stbs.push(null);
                            else {
                                stbs.push(STB.parse(vScriptBuffer.slice(vScriptInfo.get(stbName)!.offset, vScriptInfo.get(stbName)!.offset + vScriptInfo.get(stbName)!.size), stbName, 0x40 + j));
                                stbs[stbs.length - 1]!.currentEntry = npcInfo.npcScriptEntry;
                            }
                        }
                        else
                            stbs.push(null);

                        chrTransforms.push(npcInfo.npcTransform);
                        chrEulerRotations.push(npcInfo.npcEulerRotation);
                        //If no "late night" specific info, use early night for the entirety of the night
                        if (dayPeriod === SINFO.ENPCDayPeriod.EARLYNIGHT && !dayPToNpcInfo.has(SINFO.ENPCDayPeriod.LATENIGHT))
                            chrNPCDayPeriods.push((1 << SINFO.ENPCDayPeriod.EARLYNIGHT) | 1 << SINFO.ENPCDayPeriod.LATENIGHT);
                        else
                            chrNPCDayPeriods.push(1 << dayPeriod);
                        chrDayPeriodFlags.push(null);
                        chrProgressFlags.push(progressF);
                    }
                }
            }
        }

        const mapDir = this.mID.split('i')[0].split('_')[0];
        const mapBasename = `DragonQuest8/map/${mapDir}/${this.mID}`;
        const mapBuffer = await dataFetcher.fetchData(`${mapBasename}.map`);
        if (mapBuffer.byteLength) {
            const map = await MAP.parse(cache, mapBuffer, dataFetcher, this.mID, mapBasename);
            for (let i = 0; i < map.chrs.length; i++) {
                chrs.push(map.chrs[i]);
                chrTransforms.push(map.chrTransforms[i]);
                chrEulerRotations.push(vec3.create());
                chrNPCDayPeriods.push(null);
                chrDayPeriodFlags.push(map.chrDayPeriodFlags[i]);
                chrProgressFlags.push(null);
            }
            if (map.img !== null) {
                for (let i = 0; i < map.img.textures.length; i++) {
                    const imgTex = map.img.textures[i];
                    if (!canvasTexMap.has(imgTex.name)) {
                        canvasTexMap.set(imgTex.name, true);
                        viewerTextures.push(textureToCanvas(imgTex));
                    }
                }
            }
            for (const [k, v] of map.textureDataMap) {
                if (texNameToTextureData.has(k))
                    throw "already there";
                texNameToTextureData.set(k, v);
            }
            for (let j = 0; j < map.skies.length; j++) {
                const sky = map.skies[j];
                if (sky.img !== null) {
                    for (let i = 0; i < sky.img.textures.length; i++) {
                        const imgTex = sky.img.textures[i];
                        if (!canvasTexMap.has(imgTex.name)) {
                            canvasTexMap.set(imgTex.name, true);
                            viewerTextures.push(textureToCanvas(imgTex));
                        }
                    }
                }
                for (const [k, v] of sky.textureDataMap)
                    texNameToTextureData.set(k, v);
            }
            renderer.MAPRenderers.push(new MAPRenderer(cache, [map]));

            for (let i = 0; i < map.mapInfo.lightSetCount; i++) {
                SINFO.gDQ8SINFO.lightSets.push(map.mapInfo.lightSets[i]);
            }
        }

        for (let j = 0; j < chrs.length; j++) {
            const chrImg = chrs[j].img;
            if (chrImg !== null) {
                for (let i = 0; i < chrImg.textures.length; i++) {
                    const imgTex = chrImg.textures[i];
                    if (!canvasTexMap.has(imgTex.name)) {
                        canvasTexMap.set(imgTex.name, true);
                        viewerTextures.push(textureToCanvas(imgTex));
                    }
                }
            }
            for (const [k, v] of chrs[j].textureDataMap)
                texNameToTextureData.set(chrs[j].name + k, v);
        }
        renderer.CHRRenderers.push(new CHRRenderer(cache, chrs, chrTransforms, chrEulerRotations, chrNPCDayPeriods, chrDayPeriodFlags, stbs, chrProgressFlags));

        return renderer;
    }
}

const sceneDescs = [
    "Alexandria",
    new SceneDesc("DQ8", "Alexandria", "m02"),
    new SceneDesc("DQ8", "Alexandria: Inn", "m02i01"),
    new SceneDesc("DQ8", "Alexandria: House 2", "m02i02"),
    new SceneDesc("DQ8", "Alexandria: Church", "m02i03"),
    new SceneDesc("DQ8", "Alexandria: House 1", "m02i04"),
    new SceneDesc("DQ8", "Alexandria: Jessica's House", "m02i05"),
    new SceneDesc("DQ8", "Alexandria: Well", "m02i06"),
    "Arcadia",
    new SceneDesc("DQ8", "Arcadia", "m08"),
    new SceneDesc("DQ8", "Arcadia: Inn", "m08i01"),
    new SceneDesc("DQ8", "Arcadia: Church", "m08i02"),
    new SceneDesc("DQ8", "Arcadia: Pub", "m08i03"),
    new SceneDesc("DQ8", "Arcadia: Weapon & Armour Shop", "m08i04"),
    new SceneDesc("DQ8", "Arcadia: Item Shop", "m08i05"),
    new SceneDesc("DQ8", "Arcadia: Secret Shop", "m08i06"),
    new SceneDesc("DQ8", "Arcadia: Dominico's Manor ", "m08i07"),
    new SceneDesc("DQ8", "Arcadia: House 1", "m08i08"),
    new SceneDesc("DQ8", "Arcadia: House 2", "m08i09"),
    new SceneDesc("DQ8", "Arcadia: House 3", "m08i10"),
    new SceneDesc("DQ8", "Arcadia: House 4", "m08i11"),
    new SceneDesc("DQ8", "Arcadia: House 5", "m08i12"),
    new SceneDesc("DQ8", "Arcadia: House 6", "m08i13"),
    new SceneDesc("DQ8", "Arcadia: House 7", "m08i14"),
    new SceneDesc("DQ8", "Arcadia: House 8", "m08i15"),
    "Argonia",
    new SceneDesc("DQ8", "Argonia", "c03"),
    new SceneDesc("DQ8", "Argonia: Inn", "c03i01"),
    new SceneDesc("DQ8", "Argonia: Church", "c03i02"),
    new SceneDesc("DQ8", "Argonia: House 1", "c03i04"),
    new SceneDesc("DQ8", "Argonia: House 2", "c03i05"),
    new SceneDesc("DQ8", "Argonia: House 3", "c03i06"),
    new SceneDesc("DQ8", "Argonia: House 4", "c03i07"),
    new SceneDesc("DQ8", "Argonia: Ceremonial Hall", "c03i08"),
    new SceneDesc("DQ8", "Argonia Castle: Levels 1_2", "c03i09"),
    new SceneDesc("DQ8", "Argonia Castle: Rear Levels 1_2", "c03i10"),
    new SceneDesc("DQ8", "Argonia Castle: Left Levels 3_4", "c03i11"),
    new SceneDesc("DQ8", "Argonia Castle: Right Levels 3_5", "c03i13"),
    new SceneDesc("DQ8", "Argonia Castle: Rooftop", "c03i17"),
    "Ascantha",
    new SceneDesc("DQ8", "Ascantha", "c02"),
    new SceneDesc("DQ8", "Ascantha: Inn ", "c02i01"),
    new SceneDesc("DQ8", "Ascantha: Church ", "c02i02"),
    new SceneDesc("DQ8", "Ascantha: House 1 ", "c02i03"),
    new SceneDesc("DQ8", "Ascantha: House 2", "c02i04"),
    new SceneDesc("DQ8", "Ascantha Castle: Level 1", "c02i05"),
    new SceneDesc("DQ8", "Ascantha Castle: Level 2", "c02i08"),
    new SceneDesc("DQ8", "Ascantha Castle: Level 3", "c02i06"),
    new SceneDesc("DQ8", "Ascantha Castle: Level 4", "c02i07"),
    new SceneDesc("DQ8", "Ascantha Castle: Royal Suite", "c02i09"),
    new SceneDesc("DQ8", "Ascantha Castle: Rooftop", "c02i10"),
    new SceneDesc("DQ8", "Ascantha: Basement Level 1", "c02i11"),
    new SceneDesc("DQ8", "Ascantha: Escape Tunnel", "c02i12"),
    new SceneDesc("DQ8", "Ascantha: Well", "c02i13"),
    "Baccarat",
    new SceneDesc("DQ8", "Baccarat", "m05"),
    new SceneDesc("DQ8", "Baccarat: Hotel", "m05i01"),
    new SceneDesc("DQ8", "Baccarat: Church", "m05i02"),
    new SceneDesc("DQ8", "Baccarat: Restaurant", "m05i03"),
    new SceneDesc("DQ8", "Baccarat: Weapon Shop", "m05i04"),
    new SceneDesc("DQ8", "Baccarat: House 1 ", "m05i05"),
    new SceneDesc("DQ8", "Baccarat: House 2", "m05i06"),
    new SceneDesc("DQ8", "Baccarat: House 3", "m05i07"),
    new SceneDesc("DQ8", "Baccarat: Casino", "m05i08"),
    new SceneDesc("DQ8", "Baccarat: Arena (Unused?)", "m05i09"),
    new SceneDesc("DQ8", "Baccarat: House 4 Level 1", "m05i10"),
    new SceneDesc("DQ8", "Baccarat: House 4 Level 2", "m05i11"),
    new SceneDesc("DQ8", "Baccarat: Hotel Basement", "m05i12"),
    new SceneDesc("DQ8", "Baccarat: Well", "m05i13"),
    "Black Citadel",
    new SceneDesc("DQ8", "Black Citadel", "x05"),
    new SceneDesc("DQ8", "Black Citadel: Lord of Darkness's Hall", "x05i01"),
    new SceneDesc("DQ8", "Black Citadel: Dimensional Corridor", "x05i02"),
    new SceneDesc("DQ8", "Black Citadel: Rhapthorne Battle", "x05i09"),
    new SceneDesc("DQ8", "Black Citadel: Rhapthorne Complete Form", "x05i10"),
    new SceneDesc("DQ8", "Black Citadel: Level 1_E", "x05i11"),
    new SceneDesc("DQ8", "Black Citadel: Lower Dimensional Corridor A", "x05i12"),
    "Castle Trodain",
    new SceneDesc("DQ8", "Castle Trodain", "c01"),
    new SceneDesc("DQ8", "Castle Trodain: Keep Level 1", "c01i01"),
    new SceneDesc("DQ8", "Castle Trodain: Keep Level 2", "c01i02"),
    new SceneDesc("DQ8", "Castle Trodain: Keep Level 3", "c01i03"),
    new SceneDesc("DQ8", "Castle Trodain: Keep Level 4", "c01i04"),
    new SceneDesc("DQ8", "Castle Trodain: Wing", "c01i05"),
    new SceneDesc("DQ8", "Castle Trodain: Library", "c01i06"),
    new SceneDesc("DQ8", "Castle Trodain: Keep Level 4 (Flashback)", "c01i08"),
    new SceneDesc("DQ8", "Castle Trodain: Keep L3 (Flashback)", "c01i09"),
    "Castle Trodain (restored)",
    new SceneDesc("DQ8", "Castle Trodain", "c05"),
    new SceneDesc("DQ8", "Castle Trodain: Keep L1 (Restored)", "c05i01"),
    new SceneDesc("DQ8", "Castle Trodain: Keep L2 (Restored)", "c05i02"),
    new SceneDesc("DQ8", "Castle Trodain: Keep L3 (Restored)", "c05i03"),
    new SceneDesc("DQ8", "Castle Trodain: Keep L4 (Restored)", "c05i04"),
    new SceneDesc("DQ8", "Castle Trodain: Wing (Restored)", "c05i05"),
    new SceneDesc("DQ8", "Castle Trodain: Library (Restored)", "c05i06"),
    "Chateau Felix",
    new SceneDesc("DQ8", "Chateau Felix (Outside)", "s24"),
    new SceneDesc("DQ8", "Chateau Felix (Inside)", "s24i01"),
    "Dark Empycchu",
    new SceneDesc("DQ8", "Dark Empycchu", "m12"),
    new SceneDesc("DQ8", "Dark Empycchu: Item Shop", "m12i01"),
    new SceneDesc("DQ8", "Dark Empycchu: Children's House", "m12i02"),
    new SceneDesc("DQ8", "Dark Empycchu: Chief's House", "m12i03"),
    new SceneDesc("DQ8", "Dark Empycchu: House 1", "m12i04"),
    new SceneDesc("DQ8", "Dark Empycchu: House 2", "m12i05"),
    "Dark Ruins",
    new SceneDesc("DQ8", "Dark Ruins", "x03"),
    new SceneDesc("DQ8", "Dark Ruins : Basement Level 1", "x03i01"),
    new SceneDesc("DQ8", "Dark Ruins : Basement Level 2", "x03i02"),
    new SceneDesc("DQ8", "Dark Ruins : Basement Level 3", "x03i03"),
    new SceneDesc("DQ8", "Dark Ruins : Basement Level 4", "x03i04"),
    "Dragovian Sanctuary",
    new SceneDesc("DQ8", "Dragovian Sanctuary", "m11"),
    new SceneDesc("DQ8", "Dragovian Sanctuary: Chen Mui's House", "m11i01"),
    new SceneDesc("DQ8", "Dragovian Sanctuary: Council Chamber", "m11i02"),
    new SceneDesc("DQ8", "Dragovian Sanctuary: Item Shop", "m11i03"),
    new SceneDesc("DQ8", "Dragovian Sanctuary: House 1", "m11i04"),
    new SceneDesc("DQ8", "Dragovian Sanctuary: House 2", "m11i05"),
    "Dungeons",
    new SceneDesc("DQ8", "Waterfall Cave: Level 1", "d01"),
    new SceneDesc("DQ8", "Waterfall Cave: Level 2", "d01_05"),
    new SceneDesc("DQ8", "Waterfall Cave: Level 3", "d01_04"),
    // "Wishers' Peak",
    new SceneDesc("DQ8", "Wishers' Peak", "d02"),
    new SceneDesc("DQ8", "Wisher's Peak (Entrance)", "d02i01"),
    new SceneDesc("DQ8", "Wisher's Peak (Inside Well)", "d02i02"),
    new SceneDesc("DQ8", "Wisher's Peak (Summit)", "s03"),
    // "Swordsman's Labyrinth",
    new SceneDesc("DQ8", "Swordsman's Labyrinth", "d03"),
    // "Royal Hunting Ground",
    new SceneDesc("DQ8", "Royal Hunting Ground", "d04"),
    new SceneDesc("DQ8", "Royal Hunting Ground: House", "d04i01"),
    // "Ruined Abbey",
    new SceneDesc("DQ8", "Ruined Abbey (Inside)", "d05"),
    new SceneDesc("DQ8", "Ruined Abbey (Outside)", "d05i01"),
    // "Dragon Graveyard",
    new SceneDesc("DQ8", "Dragon Graveyard", "d06"),
    new SceneDesc("DQ8", "Dragon Graveyard: Doors of Judgement", "d06i01"),
    // "Pirate's Cove",
    new SceneDesc("DQ8", "Pirate's Cove (Inside)", "d07"),
    new SceneDesc("DQ8", "Pirate's Cove (Outside)", "d07i01"),
    new SceneDesc("DQ8", "Border Tunnel", "d08"),
    new SceneDesc("DQ8", "Mole Hole", "d09"),
    new SceneDesc("DQ8", "Herb Grotto", "d10i01"),
    new SceneDesc("DQ8", "Herb Grotto: Basement Level 2", "d10i02"),
    new SceneDesc("DQ8", "Herb Grotto: Basement Level 3", "d10i03"),
    new SceneDesc("DQ8", "Herb Grotto: Basement Level 4", "d10i04"),
    // "Dragovian Path",
    new SceneDesc("DQ8", "Dragovian Path: Level 1", "d11i01"),
    new SceneDesc("DQ8", "Dragovian Path: Level 2", "d11i02"),
    new SceneDesc("DQ8", "Dragovian Path: Level 3", "d11i03"),
    new SceneDesc("DQ8", "Dragovian Path: Level 4", "d11i04"),
    // "Heavenly Dais",
    new SceneDesc("DQ8", "Heavenly Dais Exterior 1", "d12"),
    new SceneDesc("DQ8", "Heavenly Dais Exterior 2", "d12i01"),
    new SceneDesc("DQ8", "Heavenly Dais: Altar Room", "d12i02"),
    "Empycchu",
    new SceneDesc("DQ8", "Empycchu", "m07"),
    new SceneDesc("DQ8", "Empycchu: Item Shop", "m07i01"),
    new SceneDesc("DQ8", "Empycchu: Children's House", "m07i02"),
    new SceneDesc("DQ8", "Empycchu: Chief's House", "m07i03"),
    new SceneDesc("DQ8", "Empycchu: House 1", "m07i04"),
    new SceneDesc("DQ8", "Empycchu: House 2", "m07i05"),
    "Farebury",
    new SceneDesc("DQ8", "Farebury", "m01"),
    new SceneDesc("DQ8", "Farebury: Inn", "m01i01"),
    new SceneDesc("DQ8", "Farebury: Church", "m01i02"),
    new SceneDesc("DQ8", "Farebury: Pub", "m01i03"),
    new SceneDesc("DQ8", "Farebury: Weapon Shop", "m01i04"),
    new SceneDesc("DQ8", "Farebury: House 1", "m01i05"),
    new SceneDesc("DQ8", "Farebury: House 2", "m01i06"),
    new SceneDesc("DQ8", "Farebury: House 4", "m01i07"),
    new SceneDesc("DQ8", "Farebury: House 5", "m01i08"),
    new SceneDesc("DQ8", "Farebury: Church Roof", "m01i09"),
    new SceneDesc("DQ8", "Farebury: Well", "m01i10"),
    "Ferry",
    new SceneDesc("DQ8", "Ferry (Outside)", "s11"),
    new SceneDesc("DQ8", "Ferry (Inside)", "s11i01"),
    "Godbird's Eyrie",
    new SceneDesc("DQ8", "Godbird's Eyrie", "t02"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 1", "t02i01"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 2", "t02i02"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 3", "t02i03"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 4", "t02i04"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 5", "t02i05"),
    "Godbird's Eyrie (Rear)",
    new SceneDesc("DQ8", "Godbird's Eyrie (Rear)", "t04"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 1", "t04i01"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 2", "t04i02"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 3", "t04i03"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 4", "t04i04"),
    new SceneDesc("DQ8", "Godbird's Eyrie: Level 5", "t04i05"),
    "Hilltop Hut",
    new SceneDesc("DQ8", "Hilltop Hut (Outside)", "s13"),
    new SceneDesc("DQ8", "Hilltop Hut (Inside)", "s13i01"),
    new SceneDesc("DQ8", "Hilltop Hut: Well", "s13i02"),
    "Lord High Priest's Residence",
    new SceneDesc("DQ8", "Lord High Priest's Residence", "s16"),
    new SceneDesc("DQ8", "Lord High Priest's Residence: Levels 1_2", "s16i01"),
    "Maella Abbey",
    new SceneDesc("DQ8", "Maella Abbey", "x02"),
    new SceneDesc("DQ8", "Maella Abbey (Inside)", "x02i01"),
    new SceneDesc("DQ8", "Abbot's Residence", "x02i02"),
    new SceneDesc("DQ8", "Maella Abbey (Stable)", "x02i03"),
    new SceneDesc("DQ8", "Secret Passage below Abbey", "x02i04"),
    new SceneDesc("DQ8", "Abbey Lodgings", "x02i05"),
    new SceneDesc("DQ8", "Maella Courtyard", "x02i07"),
    "Marta's Cottage",
    new SceneDesc("DQ8", "Marta's Cottage (Outside)", "s14"),
    new SceneDesc("DQ8", "Marta's Cottage (Inside)", "s14i01"),
    "Moonshadow Land ",
    new SceneDesc("DQ8", "Moonshadow Land (Outside)", "s04"),
    new SceneDesc("DQ8", "Moonshadow Land (Inside)", "s04i01"),
    "Monster arena",
    new SceneDesc("DQ8", "Monster Arena", "s38i01"),
    new SceneDesc("DQ8", "Monster Arena: Basement 1", "s38i02"),
    "Neos",
    new SceneDesc("DQ8", "Neos", "x01"),
    new SceneDesc("DQ8", "Neos: Inn", "x01i01"),
    new SceneDesc("DQ8", "Neos: Shrine", "x01i02"),
    new SceneDesc("DQ8", "Neos: House by the Rock", "x01i03"),
    new SceneDesc("DQ8", "Neos: Shops' Common Storeroom", "x01i04"),
    new SceneDesc("DQ8", "Neos: Barracks", "x01i05"),
    new SceneDesc("DQ8", "Neos: Clerical Lodgings", "x01i06"),
    new SceneDesc("DQ8", "Neos: Front Watchtower", "x01i07"),
    new SceneDesc("DQ8", "Neos: Front Watchtower (Top)", "x01i09"),
    "Neos Destroyed",
    new SceneDesc("DQ8", "Neos Destroyed", "x06"),
    "Orkutsk",
    new SceneDesc("DQ8", "Orkutsk", "m09"),
    new SceneDesc("DQ8", "Orkutsk: Dome A_F", "m09i01"),
    new SceneDesc("DQ8", "Orkutsk: Mayor's House", "m09i07"),
    new SceneDesc("DQ8", "Orkutsk: Underground", "m09i08"),
    "Peregrin Quay",
    new SceneDesc("DQ8", "Peregrin Quay (Outside)", "s01"),
    new SceneDesc("DQ8", "Peregrin Quay (Inside)", "s01i01"),
    new SceneDesc("DQ8", "Peregrin Quay: Inn Roof", "s01i02"),
    new SceneDesc("DQ8", "Peregrin Quay: Inside Ferry", "s01i03"),
    "Pickham",
    new SceneDesc("DQ8", "Pickham", "m04"),
    new SceneDesc("DQ8", "Pickham: Inn ", "m04i01"),
    new SceneDesc("DQ8", "Pickham: Church", "m04i02"),
    new SceneDesc("DQ8", "Pickham: Pub ", "m04i03"),
    new SceneDesc("DQ8", "Pickham: Weapon/Armour Shop ", "m04i04"),
    new SceneDesc("DQ8", "Pickham: Item Shop", "m04i05"),
    new SceneDesc("DQ8", "Pickham: Brains's House", "m04i06"),
    new SceneDesc("DQ8", "Pickham: Fortune teller's ", "m04i08"),
    new SceneDesc("DQ8", "Pickham: Pub/Black marketeer's ", "m04i09"),
    new SceneDesc("DQ8", "Pickham: Storage Room", "m04i10"),
    new SceneDesc("DQ8", "Pickham: Tent ", "m04i11"),
    new SceneDesc("DQ8", "Pickham: House 1 ", "m04i12"),
    new SceneDesc("DQ8", "Pickham: House 2 ", "m04i13"),
    new SceneDesc("DQ8", "Pickham: House 3 ", "m04i14"),
    new SceneDesc("DQ8", "Pickham: House 4 ", "m04i15"),
    new SceneDesc("DQ8", "Pickham: Well", "m04i16"),
    "Port Prospect",
    new SceneDesc("DQ8", "Port Prospect", "m03"),
    new SceneDesc("DQ8", "Port Prospect: Inn", "m03i01"),
    new SceneDesc("DQ8", "Port Prospect: Church", "m03i04"),
    new SceneDesc("DQ8", "Port Prospect: Lighthouse", "m03i05"),
    new SceneDesc("DQ8", "Port Prospect: Well", "m03i06"),
    new SceneDesc("DQ8", "Port Prospect: Inside Ferry", "m03i07"),
    "Princess Minnie's Castle",
    new SceneDesc("DQ8", "Princess Minnie's Castle (Outside)", "c04"),
    new SceneDesc("DQ8", "Princess Minnie's Castle (Inside)", "c04i01"),
    "Purgatory Island",
    new SceneDesc("DQ8", "Purgatory Island (Outside)", "s19"),
    new SceneDesc("DQ8", "Purgatory Island (Inside)", "s19i01"),
    "Red's Den",
    new SceneDesc("DQ8", "Red's Den", "s05"),
    new SceneDesc("DQ8", "Red's Den: Cabin ", "s05i01"),
    new SceneDesc("DQ8", "Red's Den: Stable ", "s05i02"),
    "Rydon's Tower",
    new SceneDesc("DQ8", "Rydon's Tower", "t03"),
    new SceneDesc("DQ8", "Rydon's Tower: Area A", "t03i01"),
    new SceneDesc("DQ8", "Rydon's Tower: Area B", "t03i02"),
    new SceneDesc("DQ8", "Rydon's Tower: Area C", "t03i03"),
    new SceneDesc("DQ8", "Rydon's Tower: Area D", "t03i04"),
    "Savella Cathedral",
    new SceneDesc("DQ8", "Savella Cathedral", "x04"),
    new SceneDesc("DQ8", "Savella Cathedral (Inside)", "x04i01"),
    new SceneDesc("DQ8", "Savella Cathedral: Inn", "x04i02"),
    "Seer's Retreat",
    new SceneDesc("DQ8", "Seer's Retreat (Outside)", "s08"),
    new SceneDesc("DQ8", "Seer's Retreat (Inside)", "s08i01"),
    "Simpleton",
    new SceneDesc("DQ8", "Simpleton", "m06"),
    new SceneDesc("DQ8", "Simpleton: Pub", "m06i01"),
    new SceneDesc("DQ8", "Simpleton: Inn", "m06i02"),
    new SceneDesc("DQ8", "Simpleton: Church", "m06i03"),
    "Tower of Alexandra",
    new SceneDesc("DQ8", "Tower of Alexandra", "t01"),
    new SceneDesc("DQ8", "Tower of Alexandra: Level 1", "t01i01"),
    new SceneDesc("DQ8", "Tower of Alexandra: Levels 3_6", "t01i03"),
    new SceneDesc("DQ8", "Tower of Alexandra: Level 7", "t01i07"),
    new SceneDesc("DQ8", "Tower of Alexandra (Turret)", "t01i08"),
    "Tryan Gully",
    new SceneDesc("DQ8", "Tryan Gully", "m10"),
    new SceneDesc("DQ8", "Tryan Gully: Raya's Room", "m10i01"),
    new SceneDesc("DQ8", "Tryan Gully: Church", "m10i02"),
    new SceneDesc("DQ8", "Tryan Gully: Facilities", "m10i03"),
    new SceneDesc("DQ8", "Tryan Gully: Storeroom", "m10i04"),

    "Misc",
    new SceneDesc("DQ8", "Trolls' Maze", "r01"),
    new SceneDesc("DQ8", "Le Club Puff-Puff ", "r02i01"),
    new SceneDesc("DQ8", "House by Road", "s02i01"),
    new SceneDesc("DQ8", "Riverside Chapel", "s02i02"),
    new SceneDesc("DQ8", "Peddler's Tent ", "s07i01"),
    new SceneDesc("DQ8", "Mystical Spring", "s09"),
    new SceneDesc("DQ8", "Shack on top of Waterfall", "s18i01"),
    new SceneDesc("DQ8", "Egeus' Tablet", "s22"),
    new SceneDesc("DQ8", "Mysterious Altar", "s23"),
    new SceneDesc("DQ8", "Seaview Church", "s25i01"),
    new SceneDesc("DQ8", "Church to the west of Trodain", "s28i01"),
    new SceneDesc("DQ8", "Desert Chapel", "s29i01"),
    new SceneDesc("DQ8", "Chapel of Autumn", "s30i01"),
    new SceneDesc("DQ8", "Lakeside Cabin", "s31i01"),
    new SceneDesc("DQ8", "High place on Northwest Isle", "s40"),
    new SceneDesc("DQ8", "Hill on Argonia's Western Border", "s41"),
    new SceneDesc("DQ8", "Mountain Overlooking Desert", "s42"),
    new SceneDesc("DQ8", "High place Near Neos", "s43"),
    new SceneDesc("DQ8", "Well A", "s50i01"),
    new SceneDesc("DQ8", "Well B", "s50i02"),
];

const name = "Dragon Quest 8";
const id = "dq8";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
