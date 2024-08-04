
import { mat4, vec3 } from "gl-matrix";
import { CameraController } from '../Camera.js';
import { colorNewFromRGBA } from "../Color.js";
import { SceneContext } from '../SceneBase.js';
import { FakeTextureHolder, TextureHolder } from '../TextureHolder.js';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from '../gfx/helpers/RenderGraphHelpers.js';
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
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
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
    constructor(public id: string, public name: string, public bChrViewer: boolean = false, public bIsSky: boolean = false,
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

        const dispoBuffer = await dataFetcher.fetchData(`DragonQuest8/event/villager/disposition/${this.id}.cfg`, { allow404: true });
        const vID = this.id.split("i")[0].split("_")[0];
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

        const mapDir = this.id.split('i')[0].split('_')[0];
        const mapBasename = `DragonQuest8/map/${mapDir}/${this.id}`;
        const mapBuffer = await dataFetcher.fetchData(`${mapBasename}.map`);
        if (mapBuffer.byteLength) {
            const map = await MAP.parse(cache, mapBuffer, dataFetcher, this.id, mapBasename);
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
    new SceneDesc("m02", "Alexandria"),
    new SceneDesc("m02i01", "Alexandria: Inn"),
    new SceneDesc("m02i02", "Alexandria: House 2"),
    new SceneDesc("m02i03", "Alexandria: Church"),
    new SceneDesc("m02i04", "Alexandria: House 1"),
    new SceneDesc("m02i05", "Alexandria: Jessica's House"),
    new SceneDesc("m02i06", "Alexandria: Well"),
    "Arcadia",
    new SceneDesc("m08", "Arcadia"),
    new SceneDesc("m08i01", "Arcadia: Inn"),
    new SceneDesc("m08i02", "Arcadia: Church"),
    new SceneDesc("m08i03", "Arcadia: Pub"),
    new SceneDesc("m08i04", "Arcadia: Weapon & Armour Shop"),
    new SceneDesc("m08i05", "Arcadia: Item Shop"),
    new SceneDesc("m08i06", "Arcadia: Secret Shop"),
    new SceneDesc("m08i07", "Arcadia: Dominico's Manor "),
    new SceneDesc("m08i08", "Arcadia: House 1"),
    new SceneDesc("m08i09", "Arcadia: House 2"),
    new SceneDesc("m08i10", "Arcadia: House 3"),
    new SceneDesc("m08i11", "Arcadia: House 4"),
    new SceneDesc("m08i12", "Arcadia: House 5"),
    new SceneDesc("m08i13", "Arcadia: House 6"),
    new SceneDesc("m08i14", "Arcadia: House 7"),
    new SceneDesc("m08i15", "Arcadia: House 8"),
    "Argonia",
    new SceneDesc("c03", "Argonia"),
    new SceneDesc("c03i01", "Argonia: Inn"),
    new SceneDesc("c03i02", "Argonia: Church"),
    new SceneDesc("c03i04", "Argonia: House 1"),
    new SceneDesc("c03i05", "Argonia: House 2"),
    new SceneDesc("c03i06", "Argonia: House 3"),
    new SceneDesc("c03i07", "Argonia: House 4"),
    new SceneDesc("c03i08", "Argonia: Ceremonial Hall"),
    new SceneDesc("c03i09", "Argonia Castle: Levels 1_2"),
    new SceneDesc("c03i10", "Argonia Castle: Rear Levels 1_2"),
    new SceneDesc("c03i11", "Argonia Castle: Left Levels 3_4"),
    new SceneDesc("c03i13", "Argonia Castle: Right Levels 3_5"),
    new SceneDesc("c03i17", "Argonia Castle: Rooftop"),
    "Ascantha",
    new SceneDesc("c02", "Ascantha"),
    new SceneDesc("c02i01", "Ascantha: Inn "),
    new SceneDesc("c02i02", "Ascantha: Church "),
    new SceneDesc("c02i03", "Ascantha: House 1 "),
    new SceneDesc("c02i04", "Ascantha: House 2"),
    new SceneDesc("c02i05", "Ascantha Castle: Level 1"),
    new SceneDesc("c02i08", "Ascantha Castle: Level 2"),
    new SceneDesc("c02i06", "Ascantha Castle: Level 3"),
    new SceneDesc("c02i07", "Ascantha Castle: Level 4"),
    new SceneDesc("c02i09", "Ascantha Castle: Royal Suite"),
    new SceneDesc("c02i10", "Ascantha Castle: Rooftop"),
    new SceneDesc("c02i11", "Ascantha: Basement Level 1"),
    new SceneDesc("c02i12", "Ascantha: Escape Tunnel"),
    new SceneDesc("c02i13", "Ascantha: Well"),
    "Baccarat",
    new SceneDesc("m05", "Baccarat"),
    new SceneDesc("m05i01", "Baccarat: Hotel"),
    new SceneDesc("m05i02", "Baccarat: Church"),
    new SceneDesc("m05i03", "Baccarat: Restaurant"),
    new SceneDesc("m05i04", "Baccarat: Weapon Shop"),
    new SceneDesc("m05i05", "Baccarat: House 1 "),
    new SceneDesc("m05i06", "Baccarat: House 2"),
    new SceneDesc("m05i07", "Baccarat: House 3"),
    new SceneDesc("m05i08", "Baccarat: Casino"),
    new SceneDesc("m05i09", "Baccarat: Arena (Unused?)"),
    new SceneDesc("m05i10", "Baccarat: House 4 Level 1"),
    new SceneDesc("m05i11", "Baccarat: House 4 Level 2"),
    new SceneDesc("m05i12", "Baccarat: Hotel Basement"),
    new SceneDesc("m05i13", "Baccarat: Well"),
    "Black Citadel",
    new SceneDesc("x05", "Black Citadel"),
    new SceneDesc("x05i01", "Black Citadel: Lord of Darkness's Hall"),
    new SceneDesc("x05i02", "Black Citadel: Dimensional Corridor"),
    new SceneDesc("x05i09", "Black Citadel: Rhapthorne Battle"),
    new SceneDesc("x05i10", "Black Citadel: Rhapthorne Complete Form"),
    new SceneDesc("x05i11", "Black Citadel: Level 1_E"),
    new SceneDesc("x05i12", "Black Citadel: Lower Dimensional Corridor A"),
    "Castle Trodain",
    new SceneDesc("c01", "Castle Trodain"),
    new SceneDesc("c01i01", "Castle Trodain: Keep Level 1"),
    new SceneDesc("c01i02", "Castle Trodain: Keep Level 2"),
    new SceneDesc("c01i03", "Castle Trodain: Keep Level 3"),
    new SceneDesc("c01i04", "Castle Trodain: Keep Level 4"),
    new SceneDesc("c01i05", "Castle Trodain: Wing"),
    new SceneDesc("c01i06", "Castle Trodain: Library"),
    new SceneDesc("c01i08", "Castle Trodain: Keep Level 4 (Flashback)"),
    new SceneDesc("c01i09", "Castle Trodain: Keep L3 (Flashback)"),
    "Castle Trodain (restored)",
    new SceneDesc("c05", "Castle Trodain"),
    new SceneDesc("c05i01", "Castle Trodain: Keep L1 (Restored)"),
    new SceneDesc("c05i02", "Castle Trodain: Keep L2 (Restored)"),
    new SceneDesc("c05i03", "Castle Trodain: Keep L3 (Restored)"),
    new SceneDesc("c05i04", "Castle Trodain: Keep L4 (Restored)"),
    new SceneDesc("c05i05", "Castle Trodain: Wing (Restored)"),
    new SceneDesc("c05i06", "Castle Trodain: Library (Restored)"),
    "Chateau Felix",
    new SceneDesc("s24", "Chateau Felix (Outside)"),
    new SceneDesc("s24i01", "Chateau Felix (Inside)"),
    "Dark Empycchu",
    new SceneDesc("m12", "Dark Empycchu"),
    new SceneDesc("m12i01", "Dark Empycchu: Item Shop"),
    new SceneDesc("m12i02", "Dark Empycchu: Children's House"),
    new SceneDesc("m12i03", "Dark Empycchu: Chief's House"),
    new SceneDesc("m12i04", "Dark Empycchu: House 1"),
    new SceneDesc("m12i05", "Dark Empycchu: House 2"),
    "Dark Ruins",
    new SceneDesc("x03", "Dark Ruins"),
    new SceneDesc("x03i01", "Dark Ruins : Basement Level 1"),
    new SceneDesc("x03i02", "Dark Ruins : Basement Level 2"),
    new SceneDesc("x03i03", "Dark Ruins : Basement Level 3"),
    new SceneDesc("x03i04", "Dark Ruins : Basement Level 4"),
    "Dragovian Sanctuary",
    new SceneDesc("m11", "Dragovian Sanctuary"),
    new SceneDesc("m11i01", "Dragovian Sanctuary: Chen Mui's House"),
    new SceneDesc("m11i02", "Dragovian Sanctuary: Council Chamber"),
    new SceneDesc("m11i03", "Dragovian Sanctuary: Item Shop"),
    new SceneDesc("m11i04", "Dragovian Sanctuary: House 1"),
    new SceneDesc("m11i05", "Dragovian Sanctuary: House 2"),
    "Dungeons",
    new SceneDesc("d01", "Waterfall Cave: Level 1"),
    new SceneDesc("d01_05", "Waterfall Cave: Level 2"),
    new SceneDesc("d01_04", "Waterfall Cave: Level 3"),
    // "Wishers' Peak",
    new SceneDesc("d02", "Wishers' Peak"),
    new SceneDesc("d02i01", "Wisher's Peak (Entrance)"),
    new SceneDesc("d02i02", "Wisher's Peak (Inside Well)"),
    new SceneDesc("s03", "Wisher's Peak (Summit)"),
    // "Swordsman's Labyrinth",
    new SceneDesc("d03", "Swordsman's Labyrinth"),
    // "Royal Hunting Ground",
    new SceneDesc("d04", "Royal Hunting Ground"),
    new SceneDesc("d04i01", "Royal Hunting Ground: House"),
    // "Ruined Abbey",
    new SceneDesc("d05", "Ruined Abbey (Inside)"),
    new SceneDesc("d05i01", "Ruined Abbey (Outside)"),
    // "Dragon Graveyard",
    new SceneDesc("d06", "Dragon Graveyard"),
    new SceneDesc("d06i01", "Dragon Graveyard: Doors of Judgement"),
    // "Pirate's Cove",
    new SceneDesc("d07", "Pirate's Cove (Inside)"),
    new SceneDesc("d07i01", "Pirate's Cove (Outside)"),
    new SceneDesc("d08", "Border Tunnel"),
    new SceneDesc("d09", "Mole Hole"),
    new SceneDesc("d10i01", "Herb Grotto"),
    new SceneDesc("d10i02", "Herb Grotto: Basement Level 2"),
    new SceneDesc("d10i03", "Herb Grotto: Basement Level 3"),
    new SceneDesc("d10i04", "Herb Grotto: Basement Level 4"),
    // "Dragovian Path",
    new SceneDesc("d11i01", "Dragovian Path: Level 1"),
    new SceneDesc("d11i02", "Dragovian Path: Level 2"),
    new SceneDesc("d11i03", "Dragovian Path: Level 3"),
    new SceneDesc("d11i04", "Dragovian Path: Level 4"),
    // "Heavenly Dais",
    new SceneDesc("d12", "Heavenly Dais Exterior 1"),
    new SceneDesc("d12i01", "Heavenly Dais Exterior 2"),
    new SceneDesc("d12i02", "Heavenly Dais: Altar Room"),
    "Empycchu",
    new SceneDesc("m07", "Empycchu"),
    new SceneDesc("m07i01", "Empycchu: Item Shop"),
    new SceneDesc("m07i02", "Empycchu: Children's House"),
    new SceneDesc("m07i03", "Empycchu: Chief's House"),
    new SceneDesc("m07i04", "Empycchu: House 1"),
    new SceneDesc("m07i05", "Empycchu: House 2"),
    "Farebury",
    new SceneDesc("m01", "Farebury"),
    new SceneDesc("m01i01", "Farebury: Inn"),
    new SceneDesc("m01i02", "Farebury: Church"),
    new SceneDesc("m01i03", "Farebury: Pub"),
    new SceneDesc("m01i04", "Farebury: Weapon Shop"),
    new SceneDesc("m01i05", "Farebury: House 1"),
    new SceneDesc("m01i06", "Farebury: House 2"),
    new SceneDesc("m01i07", "Farebury: House 4"),
    new SceneDesc("m01i08", "Farebury: House 5"),
    new SceneDesc("m01i09", "Farebury: Church Roof"),
    new SceneDesc("m01i10", "Farebury: Well"),
    "Ferry",
    new SceneDesc("s11", "Ferry (Outside)"),
    new SceneDesc("s11i01", "Ferry (Inside)"),
    "Godbird's Eyrie",
    new SceneDesc("t02", "Godbird's Eyrie"),
    new SceneDesc("t02i01", "Godbird's Eyrie: Level 1"),
    new SceneDesc("t02i02", "Godbird's Eyrie: Level 2"),
    new SceneDesc("t02i03", "Godbird's Eyrie: Level 3"),
    new SceneDesc("t02i04", "Godbird's Eyrie: Level 4"),
    new SceneDesc("t02i05", "Godbird's Eyrie: Level 5"),
    "Godbird's Eyrie (Rear)",
    new SceneDesc("t04", "Godbird's Eyrie (Rear)"),
    new SceneDesc("t04i01", "Godbird's Eyrie: Level 1"),
    new SceneDesc("t04i02", "Godbird's Eyrie: Level 2"),
    new SceneDesc("t04i03", "Godbird's Eyrie: Level 3"),
    new SceneDesc("t04i04", "Godbird's Eyrie: Level 4"),
    new SceneDesc("t04i05", "Godbird's Eyrie: Level 5"),
    "Hilltop Hut",
    new SceneDesc("s13", "Hilltop Hut (Outside)"),
    new SceneDesc("s13i01", "Hilltop Hut (Inside)"),
    new SceneDesc("s13i02", "Hilltop Hut: Well"),
    "Lord High Priest's Residence",
    new SceneDesc("s16", "Lord High Priest's Residence"),
    new SceneDesc("s16i01", "Lord High Priest's Residence: Levels 1_2"),
    "Maella Abbey",
    new SceneDesc("x02", "Maella Abbey"),
    new SceneDesc("x02i01", "Maella Abbey (Inside)"),
    new SceneDesc("x02i02", "Abbot's Residence"),
    new SceneDesc("x02i03", "Maella Abbey (Stable)"),
    new SceneDesc("x02i04", "Secret Passage below Abbey"),
    new SceneDesc("x02i05", "Abbey Lodgings"),
    new SceneDesc("x02i07", "Maella Courtyard"),
    "Marta's Cottage",
    new SceneDesc("s14", "Marta's Cottage (Outside)"),
    new SceneDesc("s14i01", "Marta's Cottage (Inside)"),
    "Moonshadow Land ",
    new SceneDesc("s04", "Moonshadow Land (Outside)"),
    new SceneDesc("s04i01", "Moonshadow Land (Inside)"),
    "Monster arena",
    new SceneDesc("s38i01", "Monster Arena"),
    new SceneDesc("s38i02", "Monster Arena: Basement 1"),
    "Neos",
    new SceneDesc("x01", "Neos"),
    new SceneDesc("x01i01", "Neos: Inn"),
    new SceneDesc("x01i02", "Neos: Shrine"),
    new SceneDesc("x01i03", "Neos: House by the Rock"),
    new SceneDesc("x01i04", "Neos: Shops' Common Storeroom"),
    new SceneDesc("x01i05", "Neos: Barracks"),
    new SceneDesc("x01i06", "Neos: Clerical Lodgings"),
    new SceneDesc("x01i07", "Neos: Front Watchtower"),
    new SceneDesc("x01i09", "Neos: Front Watchtower (Top)"),
    "Neos Destroyed",
    new SceneDesc("x06", "Neos Destroyed"),
    "Orkutsk",
    new SceneDesc("m09", "Orkutsk"),
    new SceneDesc("m09i01", "Orkutsk: Dome A_F"),
    new SceneDesc("m09i07", "Orkutsk: Mayor's House"),
    new SceneDesc("m09i08", "Orkutsk: Underground"),
    "Peregrin Quay",
    new SceneDesc("s01", "Peregrin Quay (Outside)"),
    new SceneDesc("s01i01", "Peregrin Quay (Inside)"),
    new SceneDesc("s01i02", "Peregrin Quay: Inn Roof"),
    new SceneDesc("s01i03", "Peregrin Quay: Inside Ferry"),
    "Pickham",
    new SceneDesc("m04", "Pickham"),
    new SceneDesc("m04i01", "Pickham: Inn "),
    new SceneDesc("m04i02", "Pickham: Church"),
    new SceneDesc("m04i03", "Pickham: Pub "),
    new SceneDesc("m04i04", "Pickham: Weapon/Armour Shop "),
    new SceneDesc("m04i05", "Pickham: Item Shop"),
    new SceneDesc("m04i06", "Pickham: Brains's House"),
    new SceneDesc("m04i08", "Pickham: Fortune teller's "),
    new SceneDesc("m04i09", "Pickham: Pub/Black marketeer's "),
    new SceneDesc("m04i10", "Pickham: Storage Room"),
    new SceneDesc("m04i11", "Pickham: Tent "),
    new SceneDesc("m04i12", "Pickham: House 1 "),
    new SceneDesc("m04i13", "Pickham: House 2 "),
    new SceneDesc("m04i14", "Pickham: House 3 "),
    new SceneDesc("m04i15", "Pickham: House 4 "),
    new SceneDesc("m04i16", "Pickham: Well"),
    "Port Prospect",
    new SceneDesc("m03", "Port Prospect"),
    new SceneDesc("m03i01", "Port Prospect: Inn"),
    new SceneDesc("m03i04", "Port Prospect: Church"),
    new SceneDesc("m03i05", "Port Prospect: Lighthouse"),
    new SceneDesc("m03i06", "Port Prospect: Well"),
    new SceneDesc("m03i07", "Port Prospect: Inside Ferry"),
    "Princess Minnie's Castle",
    new SceneDesc("c04", "Princess Minnie's Castle (Outside)"),
    new SceneDesc("c04i01", "Princess Minnie's Castle (Inside)"),
    "Purgatory Island",
    new SceneDesc("s19", "Purgatory Island (Outside)"),
    new SceneDesc("s19i01", "Purgatory Island (Inside)"),
    "Red's Den",
    new SceneDesc("s05", "Red's Den"),
    new SceneDesc("s05i01", "Red's Den: Cabin "),
    new SceneDesc("s05i02", "Red's Den: Stable "),
    "Rydon's Tower",
    new SceneDesc("t03", "Rydon's Tower"),
    new SceneDesc("t03i01", "Rydon's Tower: Area A"),
    new SceneDesc("t03i02", "Rydon's Tower: Area B"),
    new SceneDesc("t03i03", "Rydon's Tower: Area C"),
    new SceneDesc("t03i04", "Rydon's Tower: Area D"),
    "Savella Cathedral",
    new SceneDesc("x04", "Savella Cathedral"),
    new SceneDesc("x04i01", "Savella Cathedral (Inside)"),
    new SceneDesc("x04i02", "Savella Cathedral: Inn"),
    "Seer's Retreat",
    new SceneDesc("s08", "Seer's Retreat (Outside)"),
    new SceneDesc("s08i01", "Seer's Retreat (Inside)"),
    "Simpleton",
    new SceneDesc("m06", "Simpleton"),
    new SceneDesc("m06i01", "Simpleton: Pub"),
    new SceneDesc("m06i02", "Simpleton: Inn"),
    new SceneDesc("m06i03", "Simpleton: Church"),
    "Tower of Alexandra",
    new SceneDesc("t01", "Tower of Alexandra"),
    new SceneDesc("t01i01", "Tower of Alexandra: Level 1"),
    new SceneDesc("t01i03", "Tower of Alexandra: Levels 3_6"),
    new SceneDesc("t01i07", "Tower of Alexandra: Level 7"),
    new SceneDesc("t01i08", "Tower of Alexandra (Turret)"),
    "Tryan Gully",
    new SceneDesc("m10", "Tryan Gully"),
    new SceneDesc("m10i01", "Tryan Gully: Raya's Room"),
    new SceneDesc("m10i02", "Tryan Gully: Church"),
    new SceneDesc("m10i03", "Tryan Gully: Facilities"),
    new SceneDesc("m10i04", "Tryan Gully: Storeroom"),

    "Misc",
    new SceneDesc("r01", "Trolls' Maze"),
    new SceneDesc("r02i01", "Le Club Puff-Puff "),
    new SceneDesc("s02i01", "House by Road"),
    new SceneDesc("s02i02", "Riverside Chapel"),
    new SceneDesc("s07i01", "Peddler's Tent "),
    new SceneDesc("s09", "Mystical Spring"),
    new SceneDesc("s18i01", "Shack on top of Waterfall"),
    new SceneDesc("s22", "Egeus' Tablet"),
    new SceneDesc("s23", "Mysterious Altar"),
    new SceneDesc("s25i01", "Seaview Church"),
    new SceneDesc("s28i01", "Church to the west of Trodain"),
    new SceneDesc("s29i01", "Desert Chapel"),
    new SceneDesc("s30i01", "Chapel of Autumn"),
    new SceneDesc("s31i01", "Lakeside Cabin"),
    new SceneDesc("s40", "High place on Northwest Isle"),
    new SceneDesc("s41", "Hill on Argonia's Western Border"),
    new SceneDesc("s42", "Mountain Overlooking Desert"),
    new SceneDesc("s43", "High place Near Neos"),
    new SceneDesc("s50i01", "Well A"),
    new SceneDesc("s50i02", "Well B"),
];

const name = "Dragon Quest 8";
const id = "dq8";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
