
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as ZAR from './zar';
import * as ZSI from './zsi';
import * as LzS from '../compression/LzS';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { RoomRenderer, CtrTextureHolder, CmbInstance, CmbData, fillSceneParamsDataOnTemplate } from './render';
import { SceneGroup } from '../viewer';
import { assert, assertExists, hexzero, readString } from '../util';
import { DataFetcher, DataFetcherFlags } from '../DataFetcher';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import { mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { TransparentBlack, colorNew, White } from '../Color';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { MathConstants } from "../MathHelpers";

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numSamplers: 3, numUniformBuffers: 3 }];

const enum OoT3DPass { MAIN = 0x01, SKYBOX = 0x02 };
export class OoT3DRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public roomRenderers: RoomRenderer[] = [];
    private renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public zsi: ZSI.ZSIScene, public modelCache: ModelCache) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, hostAccessPass, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        executeOnPass(this.renderHelper.renderInstManager, device, skyboxPassRenderer, OoT3DPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        executeOnPass(this.renderHelper.renderInstManager, device, mainPassRenderer, OoT3DPass.MAIN);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);

        this.textureHolder.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

        const enableVertexNormals = new UI.Checkbox('Enable Vertex Normals', false);
        enableVertexNormals.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setVertexNormalsEnabled(enableVertexNormals.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexNormals.elem);

        const enableLighting = new UI.Checkbox('Enable Lighting', false);
        enableLighting.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setLightingEnabled(enableLighting.checked);
        };
        renderHacksPanel.contents.appendChild(enableLighting.elem);

        // NOTE(quade): hacky and currently unused environment settings menu 
        //let environmentSettingPresets = [ 
        //    `index0`,
        //    `index1`,
        //    `index2`,
        //    `index3`,
        //    `index4`,
        //    `index5`,
        //];
        //
        //const lightingIndex = new UI.SingleSelect();
        //lightingIndex.setStrings(environmentSettingPresets);
        //lightingIndex.onselectionchange = (index: number) => {
        //    for (let i = 0; i < this.roomRenderers.length; i++)
        //        this.roomRenderers[i].setEnvironmentIndex(index);
        //};
        //renderHacksPanel.contents.appendChild(lightingIndex.elem);

        const enableUV = new UI.Checkbox('Enable UV', false);
        enableUV.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setUVEnabled(enableUV.checked);
        };
        renderHacksPanel.contents.appendChild(enableUV.elem);

        const layersPanel = new UI.LayerPanel(this.roomRenderers);
        return [renderHacksPanel, layersPanel];
    }

    public setEnvironmentSettingsIndex(n: number): void {
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].setEnvironmentSettings(this.zsi.environmentSettings[n]);
    }
}

export function maybeDecompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    if (readString(buffer, 0x00, 0x04) === 'LzS\x01')
        return LzS.decompress(buffer.createDataView());
    else
        return buffer;
}

export class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private archivePromiseCache = new Map<string, Promise<ZAR.ZAR>>();
    private archiveCache = new Map<string, ZAR.ZAR>();
    private modelCache = new Map<string, CmbData>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const v: Promise<any>[] = [... this.filePromiseCache.values(), ... this.archivePromiseCache.values()];
        return Promise.all(v);
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(path);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string): Promise<ArrayBufferSlice> {
        const p = this.filePromiseCache.get(path);
        if (p !== undefined) {
            return p.then(() => this.getFileData(path));
        } else {
            return this.fetchFile(path).then((data) => {
                this.fileDataCache.set(path, data);
                return data;
            });
        }
    }

    public getFileData(path: string): ArrayBufferSlice {
        return assertExists(this.fileDataCache.get(path));
    }

    public getArchive(archivePath: string): ZAR.ZAR {
        return assertExists(this.archiveCache.get(archivePath));
    }

    public fetchArchive(archivePath: string): Promise<ZAR.ZAR> {
        let p = this.archivePromiseCache.get(archivePath);
        if (p === undefined) {
            p = this.fetchFileData(archivePath).then((data) => {
                return data;
            }).then((data) => {
                const arc = ZAR.parse(maybeDecompress(data));
                this.archiveCache.set(archivePath, arc);
                return arc;
            });
            this.archivePromiseCache.set(archivePath, p);
        }

        return p;
    }

    public getModel(device: GfxDevice, renderer: OoT3DRenderer, zar: ZAR.ZAR, modelPath: string): CmbData {
        let p = this.modelCache.get(modelPath);

        if (p === undefined) {
            const cmbData = assertExists(ZAR.findFileData(zar, modelPath));
            const cmb = CMB.parse(cmbData);
            renderer.textureHolder.addTextures(device, cmb.textures);
            p = new CmbData(device, cmb);
            this.modelCache.set(modelPath, p);
        }

        return p;
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.modelCache.values())
            model.destroy(device);
    }
}

enum ActorId {
    Player                 = 0x0000,
    En_Test                = 0x0002,
    En_GirlA               = 0x0004,
    En_Part                = 0x0007,
    En_Light               = 0x0008,
    En_Door                = 0x0009,
    En_Box                 = 0x000A,
    Bg_Dy_Yoseizo          = 0x000B,
    Bg_Hidan_Firewall      = 0x000C,
    En_Poh                 = 0x000D,
    En_Okuta               = 0x000E,
    Bg_Ydan_Sp             = 0x000F,
    En_Bom                 = 0x0010,
    En_Wallmas             = 0x0011,
    En_Dodongo             = 0x0012,
    En_Firefly             = 0x0013,
    En_Horse               = 0x0014,
    En_Item00              = 0x0015,
    En_Arrow               = 0x0016,
    En_Elf                 = 0x0018,
    En_Niw                 = 0x0019,
    En_Tite                = 0x001B,
    En_Reeba               = 0x001C,
    En_Peehat              = 0x001D,
    En_Butte               = 0x001E,
    En_Insect              = 0x0020,
    En_Fish                = 0x0021,
    En_Holl                = 0x0023,
    En_Scene_Change        = 0x0024,
    En_Zf                  = 0x0025,
    En_Hata                = 0x0026,
    Boss_Dodongo           = 0x0027,
    Boss_Goma              = 0x0028,
    En_Zl1                 = 0x0029,
    En_Viewer              = 0x002A,
    En_Goma                = 0x002B,
    Bg_Pushbox             = 0x002C,
    En_Bubble              = 0x002D,
    Door_Shutter           = 0x002E,
    En_Dodojr              = 0x002F,
    En_Bdfire              = 0x0030,
    En_Boom                = 0x0032,
    En_Torch2              = 0x0033,
    En_Bili                = 0x0034,
    En_Tp                  = 0x0035,
    En_St                  = 0x0037,
    En_Bw                  = 0x0038,
    En_A_Obj               = 0x0039,
    En_Eiyer               = 0x003A,
    En_River_Sound         = 0x003B,
    En_Horse_Normal        = 0x003C,
    En_Ossan               = 0x003D,
    Bg_Treemouth           = 0x003E,
    Bg_Dodoago             = 0x003F,
    Bg_Hidan_Dalm          = 0x0040,
    Bg_Hidan_Hrock         = 0x0041,
    En_Horse_Ganon         = 0x0042,
    Bg_Hidan_Rock          = 0x0043,
    Bg_Hidan_Rsekizou      = 0x0044,
    Bg_Hidan_Sekizou       = 0x0045,
    Bg_Hidan_Sima          = 0x0046,
    Bg_Hidan_Syoku         = 0x0047,
    En_Xc                  = 0x0048,
    Bg_Hidan_Curtain       = 0x0049,
    Bg_Spot00_Hanebasi     = 0x004A,
    En_Mb                  = 0x004B,
    En_Bombf               = 0x004C,
    En_Zl2                 = 0x004D,
    Bg_Hidan_Fslift        = 0x004E,
    En_OE2                 = 0x004F,
    Bg_Ydan_Hasi           = 0x0050,
    Bg_Ydan_Maruta         = 0x0051,
    Boss_Ganondrof         = 0x0052,
    En_Am                  = 0x0054,
    En_Dekubaba            = 0x0055,
    En_M_Fire1             = 0x0056,
    En_M_Thunder           = 0x0057,
    Bg_Ddan_Jd             = 0x0058,
    Bg_Breakwall           = 0x0059,
    En_Jj                  = 0x005A,
    En_Horse_Zelda         = 0x005B,
    Bg_Ddan_Kd             = 0x005C,
    Door_Warp1             = 0x005D,
    Obj_Syokudai           = 0x005E,
    Item_B_Heart           = 0x005F,
    En_Dekunuts            = 0x0060,
    Bg_Menkuri_Kaiten      = 0x0061,
    Bg_Menkuri_Eye         = 0x0062,
    En_Vali                = 0x0063,
    Bg_Mizu_Movebg         = 0x0064,
    Bg_Mizu_Water          = 0x0065,
    Arms_Hook              = 0x0066,
    En_fHG                 = 0x0067,
    Bg_Mori_Hineri         = 0x0068,
    En_Bb                  = 0x0069,
    Bg_Toki_Hikari         = 0x006A,
    En_Yukabyun            = 0x006B,
    Bg_Toki_Swd            = 0x006C,
    En_Fhg_Fire            = 0x006D,
    Bg_Mjin                = 0x006E,
    Bg_Hidan_Kousi         = 0x006F,
    Door_Toki              = 0x0070,
    Bg_Hidan_Hamstep       = 0x0071,
    En_Bird                = 0x0072,
    En_Wood02              = 0x0077,
    En_Lightbox            = 0x007C,
    En_Pu_box              = 0x007D,
    En_Trap                = 0x0080,
    En_Arow_Trap           = 0x0081,
    En_Vase                = 0x0082,
    En_Ta                  = 0x0084,
    En_Tk                  = 0x0085,
    Bg_Mori_Bigst          = 0x0086,
    Bg_Mori_Elevator       = 0x0087,
    Bg_Mori_Kaitenkabe     = 0x0088,
    Bg_Mori_Rakkatenjo     = 0x0089,
    En_Vm                  = 0x008A,
    Demo_Effect            = 0x008B,
    Demo_Kankyo            = 0x008C,
    Bg_Hidan_Fwbig         = 0x008D,
    En_Floormas            = 0x008E,
    En_Heishi1             = 0x008F,
    En_Rd                  = 0x0090,
    En_Po_Sisters          = 0x0091,
    Bg_Heavy_Block         = 0x0092,
    Bg_Po_Event            = 0x0093,
    Obj_Mure               = 0x0094,
    En_Sw                  = 0x0095,
    Boss_Fd                = 0x0096,
    Object_Kankyo          = 0x0097,
    En_Du                  = 0x0098,
    En_Fd                  = 0x0099,
    En_Horse_Link_Child    = 0x009A,
    Door_Ana               = 0x009B,
    Bg_Spot02_Objects      = 0x009C,
    Bg_Haka                = 0x009D,
    Magic_Wind             = 0x009E,
    Magic_Fire             = 0x009F,
    En_Ru1                 = 0x00A1,
    Boss_Fd2               = 0x00A2,
    En_Fd_Fire             = 0x00A3,
    En_Dh                  = 0x00A4,
    En_Dha                 = 0x00A5,
    En_Rl                  = 0x00A6,
    En_Encount1            = 0x00A7,
    Demo_Du                = 0x00A8,
    Demo_Im                = 0x00A9,
    Demo_Tre_Lgt           = 0x00AA,
    En_Fw                  = 0x00AB,
    Bg_Vb_Sima             = 0x00AC,
    En_Vb_Ball             = 0x00AD,
    Bg_Haka_Megane         = 0x00AE,
    Bg_Haka_MeganeBG       = 0x00AF,
    Bg_Haka_Ship           = 0x00B0,
    Bg_Haka_Sgami          = 0x00B1,
    En_Heishi2             = 0x00B3,
    En_Encount2            = 0x00B4,
    En_Fire_Rock           = 0x00B5,
    En_Brob                = 0x00B6,
    Mir_Ray                = 0x00B7,
    Bg_Spot09_Obj          = 0x00B8,
    Bg_Spot18_Obj          = 0x00B9,
    Boss_Va                = 0x00BA,
    Bg_Haka_Tubo           = 0x00BB,
    Bg_Haka_Trap           = 0x00BC,
    Bg_Haka_Huta           = 0x00BD,
    Bg_Haka_Zou            = 0x00BE,
    Bg_Spot17_Funen        = 0x00BF,
    En_Syateki_Itm         = 0x00C0,
    En_Syateki_Man         = 0x00C1,
    En_Tana                = 0x00C2,
    En_Nb                  = 0x00C3,
    Boss_Mo                = 0x00C4,
    En_Sb                  = 0x00C5,
    En_Bigokuta            = 0x00C6,
    En_Karebaba            = 0x00C7,
    Bg_Bdan_Objects        = 0x00C8,
    Demo_Sa                = 0x00C9,
    Demo_Go                = 0x00CA,
    En_In                  = 0x00CB,
    En_Tr                  = 0x00CC,
    Bg_Spot16_Bombstone    = 0x00CD,
    Bg_Hidan_Kowarerukabe  = 0x00CF,
    Bg_Bombwall            = 0x00D0,
    Bg_Spot08_Iceblock     = 0x00D1,
    En_Ru2                 = 0x00D2,
    Obj_Dekujr             = 0x00D3,
    Bg_Mizu_Uzu            = 0x00D4,
    Bg_Spot06_Objects      = 0x00D5,
    Bg_Ice_Objects         = 0x00D6,
    Bg_Haka_Water          = 0x00D7,
    En_Ma2                 = 0x00D9,
    En_Bom_Chu             = 0x00DA,
    En_Horse_Game_Check    = 0x00DB,
    Boss_Tw                = 0x00DC,
    En_Rr                  = 0x00DD,
    En_Ba                  = 0x00DE,
    En_Bx                  = 0x00DF,
    En_Anubice             = 0x00E0,
    En_Anubice_Fire        = 0x00E1,
    Bg_Mori_Hashigo        = 0x00E2,
    Bg_Mori_Hashira4       = 0x00E3,
    Bg_Mori_Idomizu        = 0x00E4,
    Bg_Spot16_Doughnut     = 0x00E5,
    Bg_Bdan_Switch         = 0x00E6,
    En_Ma1                 = 0x00E7,
    Boss_Ganon             = 0x00E8,
    Boss_Sst               = 0x00E9,
    En_Ny                  = 0x00EC,
    En_Fr                  = 0x00ED,
    Item_Shield            = 0x00EE,
    Bg_Ice_Shelter         = 0x00EF,
    En_Ice_Hono            = 0x00F0,
    Item_Ocarina           = 0x00F1,
    Magic_Dark             = 0x00F4,
    Demo_6K                = 0x00F5,
    En_Anubice_Tag         = 0x00F6,
    Bg_Haka_Gate           = 0x00F7,
    Bg_Spot15_Saku         = 0x00F8,
    Bg_Jya_Goroiwa         = 0x00F9,
    Bg_Jya_Zurerukabe      = 0x00FA,
    Bg_Jya_Cobra           = 0x00FC,
    Bg_Jya_Kanaami         = 0x00FD,
    Fishing                = 0x00FE,
    Obj_Oshihiki           = 0x00FF,
    Bg_Gate_Shutter        = 0x0100,
    Eff_Dust               = 0x0101,
    Bg_Spot01_Fusya        = 0x0102,
    Bg_Spot01_Idohashira   = 0x0103,
    Bg_Spot01_Idomizu      = 0x0104,
    Bg_Po_Syokudai         = 0x0105,
    Bg_Ganon_Otyuka        = 0x0106,
    Bg_Spot15_Rrbox        = 0x0107,
    Bg_Umajump             = 0x0108,
    Arrow_Fire             = 0x010A,
    Arrow_Ice              = 0x010B,
    Arrow_Light            = 0x010C,
    Item_Etcetera          = 0x010F,
    Obj_Kibako             = 0x0110,
    Obj_Tsubo              = 0x0111,
    En_Wonder_Item         = 0x0112,
    En_Ik                  = 0x0113,
    Demo_Ik                = 0x0114,
    En_Skj                 = 0x0115,
    En_Skjneedle           = 0x0116,
    En_G_Switch            = 0x0117,
    Demo_Ext               = 0x0118,
    Demo_Shd               = 0x0119,
    En_Dns                 = 0x011A,
    Elf_Msg                = 0x011B,
    En_Honotrap            = 0x011C,
    En_Tubo_Trap           = 0x011D,
    Obj_Ice_Poly           = 0x011E,
    Bg_Spot03_Taki         = 0x011F,
    Bg_Spot07_Taki         = 0x0120,
    En_Fz                  = 0x0121,
    En_Po_Relay            = 0x0122,
    Bg_Relay_Objects       = 0x0123,
    En_Diving_Game         = 0x0124,
    En_Kusa                = 0x0125,
    Obj_Bean               = 0x0126,
    Obj_Bombiwa            = 0x0127,
    Obj_Switch             = 0x012A,
    Obj_Elevator           = 0x012B,
    Obj_Lift               = 0x012C,
    Obj_Hsblock            = 0x012D,
    En_Okarina_Tag         = 0x012E,
    En_Yabusame_Mark       = 0x012F,
    En_Goroiwa             = 0x0130,
    En_Ex_Ruppy            = 0x0131,
    En_Toryo               = 0x0132,
    En_Daiku               = 0x0133,
    En_Nwc                 = 0x0135,
    En_Blkobj              = 0x0136,
    Item_Inbox             = 0x0137,
    En_Ge1                 = 0x0138,
    Obj_Blockstop          = 0x0139,
    En_Sda                 = 0x013A,
    En_Clear_Tag           = 0x013B,
    En_Niw_Lady            = 0x013C,
    En_Gm                  = 0x013D,
    En_Ms                  = 0x013E,
    En_Hs                  = 0x013F,
    Bg_Ingate              = 0x0140,
    En_Kanban              = 0x0141,
    En_Heishi3             = 0x0142,
    En_Syateki_Niw         = 0x0143,
    En_Attack_Niw          = 0x0144,
    Bg_Spot01_Idosoko      = 0x0145,
    En_Sa                  = 0x0146,
    En_Wonder_Talk         = 0x0147,
    Bg_Gjyo_Bridge         = 0x0148,
    En_Ds                  = 0x0149,
    En_Mk                  = 0x014A,
    En_Bom_Bowl_Man        = 0x014B,
    En_Bom_Bowl_Pit        = 0x014C,
    En_Owl                 = 0x014D,
    En_Ishi                = 0x014E,
    Obj_Hana               = 0x014F,
    Obj_Lightswitch        = 0x0150,
    Obj_Mure2              = 0x0151,
    En_Go                  = 0x0152,
    En_Fu                  = 0x0153,
    En_Changer             = 0x0155,
    Bg_Jya_Megami          = 0x0156,
    Bg_Jya_Lift            = 0x0157,
    Bg_Jya_Bigmirror       = 0x0158,
    Bg_Jya_Bombchuiwa      = 0x0159,
    Bg_Jya_Amishutter      = 0x015A,
    Bg_Jya_Bombiwa         = 0x015B,
    Bg_Spot18_Basket       = 0x015C,
    En_Ganon_Organ         = 0x015E,
    En_Siofuki             = 0x015F,
    En_Stream              = 0x0160,
    En_Mm                  = 0x0162,
    En_Ko                  = 0x0163,
    En_Kz                  = 0x0164,
    En_Weather_Tag         = 0x0165,
    Bg_Sst_Floor           = 0x0166,
    En_Ani                 = 0x0167,
    En_Ex_Item             = 0x0168,
    Bg_Jya_Ironobj         = 0x0169,
    En_Js                  = 0x016A,
    En_Jsjutan             = 0x016B,
    En_Cs                  = 0x016C,
    En_Md                  = 0x016D,
    En_Hy                  = 0x016E,
    En_Ganon_Mant          = 0x016F,
    En_Okarina_Effect      = 0x0170,
    En_Mag                 = 0x0171,
    Door_Gerudo            = 0x0172,
    Elf_Msg2               = 0x0173,
    Demo_Gt                = 0x0174,
    En_Po_Field            = 0x0175,
    Efc_Erupc              = 0x0176,
    Bg_Zg                  = 0x0177,
    En_Heishi4             = 0x0178,
    En_Zl3                 = 0x0179,
    Boss_Ganon2            = 0x017A,
    En_Kakasi              = 0x017B,
    En_Takara_Man          = 0x017C,
    Obj_Makeoshihiki       = 0x017D,
    Oceff_Spot             = 0x017E,
    End_Title              = 0x017F,
    En_Torch               = 0x0181,
    Demo_Ec                = 0x0182,
    Shot_Sun               = 0x0183,
    En_Dy_Extra            = 0x0184,
    En_Wonder_Talk2        = 0x0185,
    En_Ge2                 = 0x0186,
    Obj_Roomtimer          = 0x0187,
    En_Ssh                 = 0x0188,
    En_Sth                 = 0x0189,
    Oceff_Wipe             = 0x018A,
    Oceff_Storm            = 0x018B,
    En_Weiyer              = 0x018C,
    Bg_Spot05_Soko         = 0x018D,
    Bg_Jya_1flift          = 0x018E,
    Bg_Jya_Haheniron       = 0x018F,
    Bg_Spot12_Gate         = 0x0190,
    Bg_Spot12_Saku         = 0x0191,
    En_Hintnuts            = 0x0192,
    En_Nutsball            = 0x0193,
    Bg_Spot00_Break        = 0x0194,
    En_Shopnuts            = 0x0195,
    En_It                  = 0x0196,
    En_GeldB               = 0x0197,
    Oceff_Wipe2            = 0x0198,
    Oceff_Wipe3            = 0x0199,
    En_Niw_Girl            = 0x019A,
    En_Dog                 = 0x019B,
    En_Si                  = 0x019C,
    Bg_Spot01_Objects2     = 0x019D,
    Obj_Comb               = 0x019E,
    Bg_Spot11_Bakudankabe  = 0x019F,
    Obj_Kibako2            = 0x01A0,
    En_Dnt_Demo            = 0x01A1,
    En_Dnt_Jiji            = 0x01A2,
    En_Dnt_Nomal           = 0x01A3,
    En_Guest               = 0x01A4,
    Bg_Bom_Guard           = 0x01A5,
    En_Hs2                 = 0x01A6,
    Demo_Kekkai            = 0x01A7,
    Bg_Spot08_Bakudankabe  = 0x01A8,
    Bg_Spot17_Bakudankabe  = 0x01A9,
    Obj_Mure3              = 0x01AB,
    En_Tg                  = 0x01AC,
    En_Mu                  = 0x01AD,
    En_Go2                 = 0x01AE,
    En_Wf                  = 0x01AF,
    En_Skb                 = 0x01B0,
    Demo_Gj                = 0x01B1,
    Demo_Geff              = 0x01B2,
    Bg_Gnd_Firemeiro       = 0x01B3,
    Bg_Gnd_Darkmeiro       = 0x01B4,
    Bg_Gnd_Soulmeiro       = 0x01B5,
    Bg_Gnd_Nisekabe        = 0x01B6,
    Bg_Gnd_Iceblock        = 0x01B7,
    En_Gb                  = 0x01B8,
    En_Gs                  = 0x01B9,
    Bg_Mizu_Bwall          = 0x01BA,
    Bg_Mizu_Shutter        = 0x01BB,
    En_Daiku_Kakariko      = 0x01BC,
    Bg_Bowl_Wall           = 0x01BD,
    En_Wall_Tubo           = 0x01BE,
    En_Po_Desert           = 0x01BF,
    En_Crow                = 0x01C0,
    Door_Killer            = 0x01C1,
    Bg_Spot11_Oasis        = 0x01C2,
    Bg_Spot18_Futa         = 0x01C3,
    Bg_Spot18_Shutter      = 0x01C4,
    En_Ma3                 = 0x01C5,
    En_Cow                 = 0x01C6,
    Bg_Ice_Turara          = 0x01C7,
    Bg_Ice_Shutter         = 0x01C8,
    En_Kakasi2             = 0x01C9,
    En_Kakasi3             = 0x01CA,
    Oceff_Wipe4            = 0x01CB,
    En_Eg                  = 0x01CC,
    Bg_Menkuri_Nisekabe    = 0x01CD,
    En_Zo                  = 0x01CE,
    Obj_Makekinsuta        = 0x01CF,
    En_Ge3                 = 0x01D0,
    Obj_Timeblock          = 0x01D1,
    Obj_Hamishi            = 0x01D2,
    En_Zl4                 = 0x01D3,
    En_Mm2                 = 0x01D4,
    Bg_Jya_Block           = 0x01D5,
    Obj_Warp2block         = 0x01D6,

    //
    Grezzo_Hintstone       = 0x01D9,
}

function stringifyActorId(actorId: ActorId): string {
    return ActorId[actorId];
}

// Some objects do special magic based on which scene they are loaded into.
// This is a rough descriptor of the "current scene" -- feel free to expand as needed.
const enum Scene {
    DekuTree,
    DodongosCavern,
    JabuJabusBelly,
    ForestTemple,
    FireTemple,
    WaterTemple,
    SpiritTemple,
    ShadowTemple,
    GanonsTower,
    GerudoTrainingGround,
    Other,
}

function chooseSceneFromId(id: string): Scene {
    if (id === 'ydan')
        return Scene.DekuTree;
    else if (id === 'ddan')
        return Scene.DodongosCavern;
    else if (id === 'bdan')
        return Scene.JabuJabusBelly;
    else if (id === 'bmori1')
        return Scene.ForestTemple;
    else if (id === 'hidan')
        return Scene.FireTemple;
    else if (id === 'mizusin')
        return Scene.WaterTemple;
    else if (id === 'jyasinzou')
        return Scene.SpiritTemple;
    else if (id === 'hakadan')
        return Scene.ShadowTemple;
    else if (id === 'ganontika')
        return Scene.GanonsTower;
    else if (id === 'men')
        return Scene.GerudoTrainingGround;
    else
        return Scene.Other;
}

function isChildDungeon(scene: Scene) {
    switch (scene) {
    case Scene.DekuTree:
    case Scene.DodongosCavern:
    case Scene.JabuJabusBelly:
        return true;
    default:
        return false;
    }
}

function isAdultDungeon(scene: Scene) {
    switch (scene) {
    case Scene.ForestTemple:
    case Scene.FireTemple:
    case Scene.WaterTemple:
    case Scene.SpiritTemple:
    case Scene.ShadowTemple:
    case Scene.GanonsTower:
    case Scene.GerudoTrainingGround:
        return true;
    default:
        return false;
    }
}

const pathBase = `oot3d`;

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public setupIndex: number = -1) {
    }

    private spawnActorForRoom(device: GfxDevice, scene: Scene, renderer: OoT3DRenderer, roomRenderer: RoomRenderer, actor: ZSI.Actor, j: number): void {
        function fetchArchive(archivePath: string): Promise<ZAR.ZAR> { 
            return renderer.modelCache.fetchArchive(`${pathBase}/actor/${archivePath}`);
        }

        function buildModel(zar: ZAR.ZAR, modelPath: string, scale: number = 0.01): CmbInstance {
            const cmbData = renderer.modelCache.getModel(device, renderer, zar, modelPath);
            const cmbRenderer = new CmbInstance(device, renderer.textureHolder, cmbData);
            cmbRenderer.animationController.fps = 20;
            cmbRenderer.setConstantColor(1, TransparentBlack);
            cmbRenderer.name = `${hexzero(actor.actorId, 4)} / ${hexzero(actor.variable, 4)} / ${modelPath}`;
            mat4.scale(cmbRenderer.modelMatrix, actor.modelMatrix, [scale, scale, scale]);
            roomRenderer.objectRenderers.push(cmbRenderer);
            return cmbRenderer;
        }

        function parseCSAB(zar: ZAR.ZAR, filename: string) {
            return CSAB.parse(CMB.Version.Ocarina, assertExists(ZAR.findFileData(zar, filename)));
        }

        function parseCMAB(zar: ZAR.ZAR, filename: string) {
            const cmab = CMAB.parse(CMB.Version.Ocarina, assertExists(ZAR.findFileData(zar, filename)));
            renderer.textureHolder.addTextures(device, cmab.textures);
            return cmab;
        }

        function animFrame(frame: number): AnimationController {
            const a = new AnimationController();
            a.setTimeInFrames(frame);
            return a;
        }

        const characterLightScale = 0.5;

        // Actor list based on https://wiki.cloudmodding.com/oot/Actor_List/NTSC_1.0
        // and https://wiki.cloudmodding.com/oot/Actor_List_(Variables)
        if (actor.actorId === ActorId.En_Item00) fetchArchive(`zelda_keep.zar`).then((zar) => {
            // https://wiki.cloudmodding.com/oot/En_Item00
            const itemId = (actor.variable & 0xFF);
            if (itemId === 0x00 || itemId === 0x01 || itemId === 0x02) { // Rupees
                const b = buildModel(zar, `item00/model/drop_gi_rupy.cmb`, 0.015);
                b.modelMatrix[13] += 10;
                for (let i = 0; i < b.shapeInstances.length; i++)
                    b.shapeInstances[i].visible = false;
                const whichShape = itemId;
                b.shapeInstances[whichShape].visible = true;
            } else if (itemId === 0x03) { // Recovery Heart
                buildModel(zar, `item00/model/drop_gi_heart.cmb`, 0.02);
            } else if (itemId === 0x06) { // Heart Piece ( stuck in the ground a bit ? )
                buildModel(zar, `item00/model/drop_gi_hearts_1.cmb`, 0.05);
            } else console.warn(`Unknown Item00 drop: ${hexzero(actor.variable, 4)}`);
        });

        else if (actor.actorId === ActorId.Bg_Haka_Trap) {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00) //Guillotine Blade (Slow)
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hgiro_model.cmb`, 0.1));
            else if (whichModel === 0x01) //Spiked Box on Chain
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hkenzan_model.cmb`, 0.1));
            else if (whichModel === 0x02) //Spiked wooden wall
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HhasamiN_model.cmb`, 0.1));
            else if (whichModel === 0x03) //Spiked wooden wall, opposite
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HhasamiS_model.cmb`, 0.1)); 
            else if (whichModel === 0x04) //Propeller, blows wind
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hfofo_model.cmb`, 0.1));
            else if (whichModel === 0x05) //Guillotine Blade (Fast)
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hgiro_model.cmb`, 0.1));
            else
                throw "whoops";
        }
        else if (actor.actorId === ActorId.Demo_Gj) {
            const whichModel = actor.variable & 0xFFFF;
            if (whichModel === 0xFF04) //Ganon's Tower rubble
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b1_model.cmb`, 0.1));
            else if (whichModel === 0xFF08) //GT rubble1
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_1_model.cmb`, 0.1));
            else if (whichModel === 0xFF09) //GT rubble2
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_2_model.cmb`, 0.1));
            else if (whichModel === 0xFF0A) //GT rubble3
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_3_model.cmb`, 0.1));
            else if (whichModel === 0xFF0B) //GT rubble4
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_4_model.cmb`, 0.1));
            else if (whichModel === 0xFF0C) //GT rubble5
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_5_model.cmb`, 0.1));
            else if (whichModel === 0xFF0D) //GT rubble6
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_6_model.cmb`, 0.1));
            else if (whichModel === 0xFF0E) //GT rubble7
                fetchArchive(`zelda_gj.zar`).then((zar) => buildModel(zar, `model/ganon_b2_7_model.cmb`, 0.1));
        }
        else if (actor.actorId === ActorId.Bg_Haka_Megane) {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x03)  //Rock wall with skull, style that can have glowing eyes
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HADsec00_model.cmb`, 0.1));
            else if (whichModel === 0x04) //Black square with large skull face
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HADsec02_model.cmb`, 0.1));
            else if (whichModel === 0x05) // shadow temple boss room platforms 
                console.warn(`unimplemented: Bg_Haka_Megane 0x05`);
            else if (whichModel === 0x06) //wall of skulls
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HADsec05_model.cmb`, 0.1));
            else if (whichModel === 0x07) // shadow temple floor with "bluish" textures
                console.warn(`unimplemented: Bg_Haka_Megane 0x07`);
            else if (whichModel === 0x08) // massive platform
                console.warn(`unimplemented: Bg_Haka_Megane 0x08`);
            else if (whichModel === 0x09) //wall with "bluish" fat bricks textures one sided
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HADsec12_model.cmb`, 0.1));
            else if (whichModel === 0x0A) // shadow temple diamond room (before big key)
                console.warn(`unimplemented: Bg_Haka_Megane 0x0A`);
            else if (whichModel === 0x0B) // wall with "purplish" fat brick texture, double sided
                console.warn(`unimplemented: Bg_Haka_Megane 0x0B`);
            else if (whichModel === 0x0C) //room 11's invisible spikes/hookshot
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_HADinv0b_model.cmb`, 0.1));
            else
                throw "whoops";
        }
        else if (actor.actorId === ActorId.Bg_Haka_Sgami) {
            const whichModel = actor.variable & 0xFFFF;
            if (whichModel === 0x00)  //shadow temple scythes, visible
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hsgami_model.cmb`, 0.1));
            else if (whichModel === 0x01)   //shadow temple scythes, invisible
                fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hsgami_model.cmb`, 0.1));
            else if (whichModel === 0x0100)   //ice cavern spinning blade
                fetchArchive(`zelda_ice_objects.zar`).then((zar) => buildModel (zar, `model/ice_trap_model.cmb`, 0.1));
            else 
                throw "whoops";
        }

        else if (actor.actorId === ActorId.Bg_Haka_Ship) fetchArchive(`zelda_haka_objects.zar`).then((zar) => buildModel(zar, `model/m_Hship_model.cmb`, 0.1));

        else if (actor.actorId === ActorId.En_Kusa) fetchArchive(`zelda_field_keep.zar`).then((zar) => buildModel(zar, `model/grass05_model.cmb`, 0.4));
        else if (actor.actorId === ActorId.En_Kanban) fetchArchive(`zelda_keep.zar`).then((zar) => {
            const b = buildModel(zar, `objects/model/kanban1_model.cmb`);
            b.modelMatrix[13] -= 16;
        });
        else if (actor.actorId === ActorId.En_Gs) fetchArchive(`zelda_gs.zar`).then((zar) => buildModel(zar, `model/gossip_stone2_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Obj_Tsubo) fetchArchive(`zelda_tsubo.zar`).then((zar) => buildModel(zar, `model/tubo2_model.cmb`, 0.15));
        else if (actor.actorId === ActorId.Obj_Kibako2) fetchArchive(`zelda_kibako2.zar`).then((zar) => buildModel(zar, `model/CIkibako_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.En_Box) fetchArchive(`zelda_box.zar`).then((zar) => {
            const b = buildModel(zar, `model/tr_box.cmb`, 0.005); // default scale for small chests

            const enum Chest { BOSS, SMALL_WOODEN, LARGE_WOODEN };
            function setChest(chest: Chest) {
                b.shapeInstances[0].visible = chest === Chest.BOSS;
                b.shapeInstances[1].visible = chest === Chest.SMALL_WOODEN || chest === Chest.LARGE_WOODEN;
                b.shapeInstances[2].visible = chest === Chest.BOSS;
                b.shapeInstances[3].visible = chest === Chest.SMALL_WOODEN || chest === Chest.LARGE_WOODEN;

                if (chest === Chest.BOSS || chest === Chest.LARGE_WOODEN)
                    mat4.scale(b.modelMatrix, b.modelMatrix, [2, 2, 2]);
            }

            const whichBox = ((actor.variable) >>> 12) & 0x0F;
            if (whichBox === 0x00) {        // Large
                setChest(Chest.LARGE_WOODEN);
            } else if (whichBox === 0x01) { // Large, Appears, Clear Flag
                setChest(Chest.LARGE_WOODEN);
            } else if (whichBox === 0x02) { // Boss Key's Chest
                setChest(Chest.BOSS);
            } else if (whichBox === 0x03) { // Large, Falling, Switch Flag
                setChest(Chest.LARGE_WOODEN);
            } else if (whichBox === 0x04) { // Large, Invisible
                setChest(Chest.LARGE_WOODEN);  
            } else if (whichBox === 0x05) { // Small
                setChest(Chest.SMALL_WOODEN);
            } else if (whichBox === 0x06) { // Small, Invisible
                setChest(Chest.SMALL_WOODEN);  
            } else if (whichBox === 0x07) { // Small, Appears, Clear Flag
                setChest(Chest.SMALL_WOODEN);    
            } else if (whichBox === 0x08) { // Small, Falls, Switch Flag
                setChest(Chest.SMALL_WOODEN);       
            } else if (whichBox === 0x09) { // Large, Appears, Zelda's Lullabye
                setChest(Chest.LARGE_WOODEN);
            } else if (whichBox === 0x0A) { // Large, Appears, Sun's Song
                setChest(Chest.LARGE_WOODEN);
            } else if (whichBox === 0x0B) { // Large, Appears, Switch Flag
                setChest(Chest.LARGE_WOODEN);
            } else if (whichBox === 0x0C) { // Large
                setChest(Chest.LARGE_WOODEN);
            } else {
                throw "Starschulz";
            }
        });
        else if (actor.actorId === ActorId.En_Door) fetchArchive(`zelda_keep.zar`).then((zar) => {
            // TODO(jstpierre): Figure out how doors are decided. I'm guessing the current scene?
            buildModel(zar, `door/model/obj_door_omote_model.cmb`);
        });
        else if (actor.actorId === ActorId.Obj_Syokudai) fetchArchive(`zelda_syokudai.zar`).then((zar) => {
            const whichModel = (actor.variable >>> 12) & 0x03;
            if (whichModel === 0x00) {        // Golden Torch
                buildModel(zar, `model/syokudai_model.cmb`, 1);
            } else if (whichModel === 0x01) { // Timed Torch
                buildModel(zar, `model/syokudai_ki_model.cmb`, 1);
            } else if (whichModel === 0x02) { // Wooden Torch
                buildModel(zar, `model/syokudai_isi_model.cmb`, 1);
            } else if (whichModel === 0x03) { // Unknown (Seen in Ganon's Castle)
                // TODO(jstpierre)
            } else {
                throw "Starschulz";
            }
        });
        else if (actor.actorId === ActorId.Bg_Bowl_Wall) fetchArchive(`zelda_bowl.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00) {
                const b = buildModel(zar, `model/bowling_p1_model.cmb`, 1);
                b.bindCMAB(parseCMAB(zar, `misc/bowling_p1_model.cmab`));
            } else if (whichModel === 0x01) {
                const b = buildModel(zar, `model/bowling_p2_model.cmb`, 1);
                b.bindCMAB(parseCMAB(zar, `misc/bowling_p2_model.cmab`));
            } else {
                throw "Starschulz";
            }
        });
        else if (actor.actorId === ActorId.En_Tana) fetchArchive(`zelda_shop_tana.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00) {
                buildModel(zar, `model/shop_tana01_model.cmb`, 1);  // Wooden Shelves
            } else if (whichModel === 0x01) {
                buildModel(zar, `model/shop_tana02_model.cmb`, 1);  // Stone Shelves ( Zora )
            } else if (whichModel === 0x02) {
                buildModel(zar, `model/shop_tana03_model.cmb`, 1);  // Granite Shelves ( Goron )
            } else {
                throw "Starschulz";
            }
        });
        else if (actor.actorId === ActorId.Bg_Bdan_Objects) fetchArchive(`zelda_bdan_objects.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F
            if (whichModel === 0x00) {
                buildModel(zar, `model/bdan_toge_model.cmb`, 0.1);      // Giant Squid Platform
            } else if (whichModel === 0x01) {
                buildModel(zar, `model/bdan_ere_model.cmb`, 0.1);       // Elevator Platform
            } else if (whichModel === 0x02) {
                buildModel(zar, `model/bdan_bmizu_modelT.cmb`, 0.1);    // Water Square
            } else if (whichModel === 0x03) {
                buildModel(zar, `model/bdan_fdai_model.cmb`, 0.1);      // Lowering Platform
            } else {
                throw "Starschulz";
            }
        });
        else if (actor.actorId === ActorId.Bg_Bdan_Switch) fetchArchive(`zelda_bdan_objects.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F
            if (whichModel === 0x00) {
                buildModel(zar, `model/bdan_switch_b_model.cmb`, 0.1);
            } else if (whichModel === 0x01) {
                buildModel(zar, `model/bdan_switch_y_model.cmb`, 0.1);
            } else if (whichModel === 0x02) {
                buildModel(zar, `model/bdan_switch_y_model.cmb`, 0.1);
            } else if (whichModel === 0x03) {
                buildModel(zar, `model/bdan_switch_y_model.cmb`, 0.1);
            } else if (whichModel === 0x04) {
                buildModel(zar, `model/bdan_switch_y_model.cmb`, 0.1);
            } else {
                throw "Starschulz";
            }
        });
        else if (actor.actorId === ActorId.En_Bombf) fetchArchive(`zelda_bombf.zar`).then((zar) => {
            const b = buildModel(zar, `model/bm_flower_model.cmb`, 0.01);
            b.modelMatrix[13] += 10;
            buildModel(zar, `model/bm_leaf_model.cmb`, 0.01);
            buildModel(zar, `model/bm_leaf2_model.cmb`, 0.01);
        });
        else if (actor.actorId === ActorId.En_Zf) fetchArchive(`zelda_zf.zar`).then((zar) => {
            const whichEnemy = actor.variable & 0xFF
            if (whichEnemy === 0x00) {
                const b = buildModel(zar, `model/rezsulfos.cmb`, 0.02);  // Lizalfos Miniboss
                b.bindCSAB(parseCSAB(zar, `anim/zf_matsu.csab`));
            } else if (whichEnemy === 0x01) {
                const b = buildModel(zar, `model/rezsulfos.cmb`, 0.02);  // Lizalfos Miniboss 2 
                b.bindCSAB(parseCSAB(zar, `anim/zf_matsu.csab`));
            } else if (whichEnemy === 0x80) {
                const b = buildModel(zar, `model/rezsulfos.cmb`, 0.02);  // Lizalfos
                b.bindCSAB(parseCSAB(zar, `anim/zf_matsu.csab`));
            } else if (whichEnemy === 0xFE) {
                const b = buildModel(zar, `model/dynafos.cmb`, 0.02);    // Dinolfos
                b.bindCSAB(parseCSAB(zar, `anim/zf_matsu.csab`));
            } else if (whichEnemy === 0xFF) {
                const b = buildModel(zar, `model/rezsulfos.cmb`, 0.02);  // Lizalfos drops from ceiling
                b.bindCSAB(parseCSAB(zar, `anim/zf_matsu.csab`));
            } else {
                throw "Starschulz";
            }
        });   
        else if (actor.actorId === ActorId.Bg_Po_Syokudai) fetchArchive(`zelda_syokudai.zar`).then((zar) => buildModel(zar, `model/syokudai_model.cmb`, 1));
        else if (actor.actorId === ActorId.Obj_Hsblock) fetchArchive(`zelda_d_hsblock.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00) {
                buildModel(zar, 'model/field_fshot_model.cmb', 0.1);  // Tower Hookshot Target
            } else if (whichModel === 0x01) {
                buildModel(zar, 'model/field_fshot_model.cmb', 0.1);  // Tower Hookshot Target (Starts underground)
            } else if (whichModel === 0x02) {
                buildModel(zar, 'model/field_fshot2_model.cmb', 0.1); // Square Wall Target
            } else {
                throw "starschulz";
            }
        });
        else if (actor.actorId === ActorId.Bg_Relay_Objects) fetchArchive(`zelda_relay_objects.zar`).then((zar) => {
            const whichModel = ((actor.variable) >>> 8) & 0x0F;
            if (whichModel === 0x00) {
                buildModel(zar, 'model/relay_usu_model.cmb', 0.1);  // Rotating Center platform
            } else if (whichModel === 0x01) {
                buildModel(zar, 'model/l_doorpou_model.cmb', 0.1);  // Stone door
            } else {
                throw "starschulz";
            }
        });
        else if (actor.actorId === ActorId.Bg_Spot02_Objects) fetchArchive(`zelda_spot02_objects.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00) {
                buildModel(zar, 'model/obj_s02gate_model.cmb', 0.1);  // Eye of Truth door
            } else if (whichModel === 0x01) {
                buildModel(zar, 'model/obj_s02futa_model.cmb', 0.1);  // Small patch of ground covering Danpe's Grave
            } else if (whichModel === 0x02) {
                buildModel(zar, 'model/obj_s02kinghaka_model.cmb', 0.1); // Royal tomb grave
            } else if (whichModel === 0x03) {
            } else if (whichModel === 0x04) {
               // buildModel(zar, 'model/haka_l_ring_modelT.cmb', 0.1); // Light Aura for when grave explodes
            } else if (whichModel === 0x05) {
            } else {
                throw "starschulz";
            }
        });
        else if (actor.actorId === ActorId.Bg_Spot16_Doughnut) fetchArchive(`zelda_efc_doughnut.zar`).then((zar) => {
            const b = buildModel(zar, `model/doughnut_aya_modelT.cmb`, 0.1);
            b.bindCMAB(parseCMAB(zar, `misc/doughnut_aya_modelT.cmab`));
        });
        else if (actor.actorId === ActorId.En_Fz) fetchArchive(`zelda_fz.zar`).then((zar) => buildModel(zar, `model/frezad.cmb`, 0.01));
        else if (actor.actorId === ActorId.Obj_Bombiwa) fetchArchive(`zelda_bombiwa.zar`).then((zar) => buildModel(zar, `model/obj_18b_stone_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Bg_Zg) fetchArchive(`zelda_zg.zar`).then((zar) => buildModel(zar, `model/zeldoor_model.cmb`, 1));
        else if (actor.actorId === ActorId.Bg_Breakwall) fetchArchive(`zelda_bwall.zar`).then((zar) => buildModel(zar, `model/a_bomt_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Obj_Timeblock) fetchArchive(`zelda_timeblock.zar`).then((zar) => buildModel(zar, `model/brick_toki_model.cmb`, 1));
        else if (actor.actorId === ActorId.Bg_Spot18_Basket) fetchArchive(`zelda_spot18_obj.zar`).then((zar) => buildModel(zar, `model/obj_s18tubo_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Bg_Spot18_Shutter) fetchArchive(`zelda_spot18_obj.zar`).then((zar) => buildModel(zar, `model/obj_186_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.En_Blkobj) fetchArchive(`zelda_blkobj.zar`).then((zar) => {
            const b = buildModel(zar, `model/m_WhontR_0d_model.cmb`, 1);
            b.bindCMAB(parseCMAB(zar, `misc/m_WusoR_0d_model.cmab`));
        });
        else if (actor.actorId === ActorId.En_Goroiwa) fetchArchive(`zelda_goroiwa.zar`).then((zar) => buildModel(zar, `model/l_j_goroiwa_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.En_Siofuki) fetchArchive(`zelda_siofuki.zar`).then((zar) => buildModel(zar, `model/efc_tw_whirlpool_modelT.cmb`, 0.1).bindCMAB(parseCMAB(zar, `misc/efc_tw_whirlpool_modelT.cmab`)));
        else if (actor.actorId === ActorId.Bg_Mizu_Movebg) fetchArchive(`zelda_mizu_objects.zar`).then((zar) => buildModel(zar, `model/m_WPathFloat_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Bg_Ddan_Jd) fetchArchive(`zelda_ddan_objects.zar`).then((zar) => buildModel(zar, `model/ddanh_jd_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Bg_Dodoago) fetchArchive(`zelda_ddan_objects.zar`).then((zar) => buildModel(zar, `model/ddanh_ago_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Bg_Ddan_Kd) fetchArchive(`zelda_ddan_objects.zar`).then((zar) => buildModel(zar, `model/ddanh_kaidan_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.En_Trap) fetchArchive(`dk_trap.zar`).then((zar) => buildModel(zar, `model/trap_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.Bg_Mori_Hineri) {
            const whichHallway = actor.variable & 0x0F;
            if (whichHallway === 0x00)
                fetchArchive(`zelda_mori_hineri1.zar`).then((zar) => buildModel(zar, `model/l_hineri1_model.cmb`, 1));
            else if (whichHallway === 0x01)
                fetchArchive(`zelda_mori_hineri2.zar`).then((zar) => buildModel(zar, `model/l_hineri2_model.cmb`, 1));
        }
        else if (actor.actorId === ActorId.Bg_Mori_Elevator) fetchArchive(`zelda_mori_objects.zar`).then((zar) => buildModel(zar, `model/l_elevator_model.cmb`, 1));
        else if (actor.actorId === ActorId.Bg_Mori_Bigst) fetchArchive(`zelda_mori_objects.zar`).then((zar) => buildModel(zar, `model/l_bigst_model.cmb`, 1));
        else if (actor.actorId === ActorId.Bg_Heavy_Block) fetchArchive(`zelda_heavy_object.zar`).then((zar) => buildModel(zar, `model/heavy_object_model.cmb`, 1));
        else if (actor.actorId === ActorId.Bg_Mori_Idomizu) fetchArchive(`zelda_mori_objects.zar`).then((zar) => {
            const b = buildModel(zar, `model/l_idomizu_modelT.cmb`, 1);
            b.bindCMAB(parseCMAB(zar, `misc/l_idomizu_modelT.cmab`));
        });
        else if (actor.actorId === ActorId.Bg_Gjyo_Bridge) fetchArchive(`zelda_gjyo_objects.zar`).then((zar) => {
            const b = buildModel(zar, `model/spot15_brige_modelT.cmb`, 0.1);
            b.bindCMAB(parseCMAB(zar, `misc/spot15_brige_modelT.cmab`));
        });
        else if (actor.actorId === ActorId.Bg_Mori_Hashira4) fetchArchive(`zelda_mori_objects.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00)
                buildModel(zar, `model/l_4hasira_model.cmb`, 1);
        });
        else if (actor.actorId === ActorId.Bg_Mori_Rakkatenjo) fetchArchive(`zelda_mori_objects.zar`).then((zar) => {
            buildModel(zar, `model/l_tenjyou_model.cmb`, 1);
        });
        else if (actor.actorId === ActorId.Bg_Mori_Kaitenkabe) fetchArchive(`zelda_mori_objects.zar`).then((zar) => {
            buildModel(zar, `model/l_kaiten_model.cmb`, 1);
        });
        else if (actor.actorId === ActorId.Bg_Spot01_Fusya) fetchArchive(`zelda_spot01_objects.zar`).then((zar) => {
            buildModel(zar, `model/c_s01fusya_model.cmb`, 0.1);
        });
        else if (actor.actorId === ActorId.Bg_Spot01_Idohashira) fetchArchive(`zelda_spot01_objects.zar`).then((zar) => {
            buildModel(zar, `model/c_s01idohashira_model.cmb`, 0.1);
        });
        else if (actor.actorId === ActorId.Bg_Spot01_Idomizu) fetchArchive(`zelda_spot01_objects.zar`).then((zar) => {
            const b = buildModel(zar, `model/c_s01idomizu_modelT.cmb`, 0.1);
            b.bindCMAB(parseCMAB(zar, `misc/c_s01idomizu_modelT.cmab`));
        });
        else if (actor.actorId === ActorId.Bg_Spot01_Objects2) {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00)      // Potion Shop Poster
                fetchArchive(`zelda_spot01_matoya.zar`).then((zar) => buildModel(zar, `model/c_s01_k_kanban_model.cmb`, 0.1));
            else if (whichModel === 0x01) // Shooting Gallery Poster
                fetchArchive(`zelda_spot01_matoya.zar`).then((zar) => buildModel(zar, `model/c_s01_m_kanban_model.cmb`, 0.1));
            else if (whichModel === 0x02) // Bazaar Poster
                fetchArchive(`zelda_spot01_matoya.zar`).then((zar) => buildModel(zar, `model/c_s01_n_kanban_model.cmb`, 0.1));
            else if (whichModel === 0x03) // Shooting Gallery (Partially Constructed)
                fetchArchive(`zelda_spot01_matoyab.zar`).then((zar) => buildModel(zar, `model/c_matoate_before_model.cmb`, 0.1));
            else if (whichModel === 0x04) // Shooting Gallery (Finished)
                fetchArchive(`zelda_spot01_matoya.zar`).then((zar) => buildModel(zar, `model/c_matoate_house_model.cmb`, 0.1));
            else
                throw "whoops";
        }
        else if (actor.actorId === ActorId.Door_Warp1) fetchArchive(`zelda_warp1.zar`).then((zar) => {
            const b = buildModel(zar, `model/warp_2_modelT.cmb`, 1);
            b.bindCMAB(parseCMAB(zar, `misc/warp_2_modelT_open.cmab`));
        });
        else if (actor.actorId === ActorId.Bg_Ydan_Hasi) fetchArchive(`zelda_ydan_objects.zar`).then((zar) => {
            const whichModel = actor.variable & 0x0F;
            if (whichModel === 0x00) // Back-and-Forth Moving Platform
                buildModel(zar, `model/ydan_trift_model.cmb`, 0.1);
            else if (whichModel === 0x01) // Water Plane
                buildModel(zar, `model/ydan_mizu_modelT.cmb`, 0.1).bindCMAB(parseCMAB(zar, `misc/ydan_mizu_modelT.cmab`));
            else if (whichModel === 0x02) // Three Rising Platforms
                buildModel(zar, `model/ydan_maruta_model.cmb`, 0.1);
            else
                throw "whoops";
        });
        else if (actor.actorId === ActorId.Bg_Ydan_Maruta) fetchArchive(`zelda_ydan_objects.zar`).then((zar) => {
            const whichModel = (actor.variable >>> 8) & 0x0F;
            if (whichModel === 0x00)
                buildModel(zar, `model/ydan_ytoge_model.cmb`, 0.1);
            else if (whichModel === 0x01) // hasigo! to new york
                buildModel(zar, `model/ydan_t_hasigo_model.cmb`, 0.1);
        });
        else if (actor.actorId === ActorId.Obj_Oshihiki) fetchArchive(`zelda_dangeon_keep.zar`).then((zar) => {
            let scale = 0.1;
            const whichScale = actor.variable & 0x03;

            if (whichScale === 0x00)
                scale = 60/600;
            else if (whichScale === 0x01)
                scale = 100/600;
            else if (whichScale === 0x02)
                scale = 120/600;
            else if (whichScale === 0x03)
                scale = 200/600;

            const whichColor = (actor.variable >>> 6) & 0x03;

            if (scene === Scene.DekuTree) {
                buildModel(zar, `model/brick_15_deku_Sa_model.cmb`, scale);
            } else if (scene === Scene.DodongosCavern) {
                if (whichColor === 0x00)
                    buildModel(zar, `model/brick_15_dod_Sa_model.cmb`, scale);
                else if (whichColor === 0x01)
                    buildModel(zar, `model/brick_15_dod_Sb_model.cmb`, scale);
            } else if (scene === Scene.ForestTemple) {
                if (whichColor === 0x00)
                    buildModel(zar, `model/brick_15_frs_Ma_model.cmb`, scale);
                else if (whichColor === 0x01)
                    buildModel(zar, `model/brick_15_frs_Mb_model.cmb`, scale);
            } else if (scene === Scene.FireTemple) {
                buildModel(zar, `model/brick_15_fire_Sa_model.cmb`, scale);
            } else if (scene === Scene.WaterTemple) {
                buildModel(zar, `model/brick_15_wat_Ma_model.cmb`, scale);
            } else if (scene === Scene.SpiritTemple) {
                if (whichScale === 0x00)
                    buildModel(zar, `model/brick_15_soul_Sa_model.cmb`, scale);
                else if (whichScale === 0x03)
                    buildModel(zar, `model/brick_15_soul_La_model.cmb`, scale);
            } else if (scene === Scene.ShadowTemple) {
                buildModel(zar, `model/brick_15_dark_Ma_model.cmb`, scale);
            } else if (scene === Scene.GanonsTower) {
                // TODO(jstpierre): What does Ganon's Tower use?
                buildModel(zar, `model/brick_15_dark_Ma_model.cmb`, scale);
            } else if (scene === Scene.GerudoTrainingGround) {
                buildModel(zar, `model/brick_15_gerd_La_model.cmb`, scale);
            } else
                throw "whoops";
        });
        else if (actor.actorId === ActorId.Obj_Switch) fetchArchive(`zelda_dangeon_keep.zar`).then((zar) => {
            // TODO(jstpierre): What determines the diff. between the yellow and silver eye switches?
            // Probably just child vs. adult scene?
            const whichSwitch = actor.variable & 0x07;
            if (whichSwitch === 0x00) // Floor Switch
                buildModel(zar, `model/switch_1_model.cmb`, 0.1);
            else if (whichSwitch === 0x01) // Rusted Floor Switch
                buildModel(zar, `model/switch_2_model.cmb`, 0.1);
            else if (whichSwitch === 0x02) // Yellow Eye Switch
                if (isChildDungeon(scene))
                    buildModel(zar, `model/switch_4_model.cmb`, 0.1);
                else if (isAdultDungeon(scene))
                    buildModel(zar, `model/switch_5_model.cmb`, 0.1);
                else
                    throw "whoops";
            else if (whichSwitch === 0x03) // Crystal Switch
                // TODO(jstpierre): Green vs. red? Is this only used in Fire and Forest?
                buildModel(zar, `model/switch_6_model.cmb`, 0.1);
            else if (whichSwitch === 0x04) // Targetable Crystal Switch
                buildModel(zar, `model/switch_9_model.cmb`, 0.1);
            else
                throw "whoops";
        });
        else if (actor.actorId === ActorId.Door_Ana) fetchArchive(`zelda_field_keep.zar`).then((zar) => buildModel(zar, `model/ana01_modelT.cmb`));
        else if (actor.actorId === ActorId.Bg_Mjin) fetchArchive(`zelda_mjin.zar`).then((zar) => {
            const whichPedestal = actor.variable & 0x0F;

            let whichPalFrame = 0;
            if (whichPedestal === 0x01) // Prelude of Light / Temple of Time
                whichPalFrame = 3;
            else if (whichPedestal === 0x06) // Minuet of Forest / Forest Temple
                whichPalFrame = 0;
            else if (whichPedestal === 0x03) // Bolero of Fire / Fire Temple
                whichPalFrame = 2;
            else if (whichPedestal === 0x04) // Serenade of Water / Water Temple
                whichPalFrame = 4;
            else if (whichPedestal === 0x05) // Requiem of Spirit / Spirit Temple
                whichPalFrame = 5;
            else if (whichPedestal === 0x02) // Nocturne of Shadow / Shadow Temple
                whichPalFrame = 1;

            const b = buildModel(zar, `model/mjin_flash_model.cmb`, 1);
            const cmab = parseCMAB(zar, `misc/mjin_flash_model.cmab`);
            renderer.textureHolder.addTextures(device, cmab.textures);
            b.bindCMAB(cmab, animFrame(whichPalFrame));
        });
        else if (actor.actorId === ActorId.Bg_Ydan_Sp) fetchArchive(`zelda_ydan_objects.zar`).then((zar) => {
            const whichModel = (actor.variable >>> 12) & 0x03;
            if (whichModel === 0x00) // Web-Covered Hole
                buildModel(zar, `model/ydan_spyuka_modelT.cmb`, 0.1);
            else if (whichModel === 0x01) // Vertical Web Wall
                buildModel(zar, `model/ydan_spkabe_modelT.cmb`, 0.1);
            else if (whichModel === 0x02) // Web-Hovered Hole
                buildModel(zar, `model/ydan_spyuka_modelT.cmb`, 0.1);
            else
                throw "whoops";
        });
        else if (actor.actorId === ActorId.En_Hata) fetchArchive(`zelda_hata.zar`).then((zar) => {
            const whichModel = (actor.variable >>> 8) & 0x00FF;

            const b = buildModel(zar, `model/ht_hata.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ht_hata.csab`));

            if (whichModel === 0x00) { // Hyrule Flag
                b.shapeInstances[2].visible = false;
            } else if (whichModel === 0xFF) { // Desert Flag
                b.shapeInstances[3].visible = false;
            }
        });
        else if (actor.actorId === ActorId.En_Wood02) fetchArchive(`zelda_wood02.zar`).then((zar) => {
            const whichModel = actor.variable & 0x00FF;
            // TODO(jstpierre): Why don't these tree models display correctly?
            if (whichModel === 0x00) { // "Large Tree"
                buildModel(zar, `model/tree01_model.cmb`, 1.5);
            } else if (whichModel === 0x02) { // "Small Tree"
                buildModel(zar, `model/tree03_model.cmb`, 0.5);
            } else {
                console.warn(`Unknown En_Wood02 model ${whichModel}`);
            }
        });
        else if (actor.actorId === ActorId.Bg_Toki_Hikari) fetchArchive(`zelda_toki_objects.zar`).then((zar) => {
            const whichModel = actor.variable & 0x000F;
            if (whichModel === 0x00) {
                const b = buildModel(zar, `model/tokinoma_hikari_modelT.cmb`, 1);
                b.bindCMAB(parseCMAB(zar, `misc/tokinoma_hikari_modelT.cmab`));
            } else if (whichModel === 0x01) {
                // TODO(jstpierre): How is this positioned?
                // const b = buildModel(zar, `model/tokinoma_hikari3_modelT.cmb`, 1);
                // b.bindCMAB(parseCMAB(zar, `misc/tokinoma_hikari3_modelT.cmab`));
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.Bg_Haka) fetchArchive(`zelda_haka.zar`).then((zar) => {
            buildModel(zar, `model/obj_haka_model.cmb`, 0.1);
        });
        else if (actor.actorId === ActorId.Bg_Spot15_Rrbox) fetchArchive(`zelda_spot15_obj.zar`).then((zar) => {
            buildModel(zar, `model/spot15_box_model.cmb`, 0.1);
        });
        else if (actor.actorId === ActorId.En_Ishi) fetchArchive(`zelda_field_keep.zar`).then((zar) => {
            const b = buildModel(zar, `model/obj_isi01_model.cmb`, 0.1);
            b.modelMatrix[13] += 10;
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Obj_Hana) fetchArchive(`zelda_field_keep.zar`).then((zar) => {
            const whichModel = actor.variable & 0x03;
            if (whichModel === 0x00) {
                buildModel(zar, `model/flower1_model.cmb`, 0.01);
            } else if (whichModel === 0x01) {
                const b = buildModel(zar, `model/obj_isi01_model.cmb`, 0.1);
                b.setVertexColorScale(characterLightScale);
            } else if (whichModel === 0x02) {
                buildModel(zar, `model/grass05_model.cmb`, 0.4);
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.Bg_Spot03_Taki) fetchArchive(`zelda_spot03_object.zar`).then((zar) => {
            const b = buildModel(zar, `model/c_s03bigtaki_modelT.cmb`, 0.1);
            b.bindCMAB(parseCMAB(zar, `misc/c_s03bigtaki_modelT.cmab`));

            const b2 = buildModel(zar, `model/c_s03shibuki_modelT.cmb`, 0.1);
            b2.bindCMAB(parseCMAB(zar, `misc/c_s03shibuki_modelT.cmab`));
        });
        else if (actor.actorId === ActorId.En_A_Obj) {
            const whichObject = actor.variable & 0xFF;
            if (whichObject === 0x0A) fetchArchive(`zelda_keep.zar`).then((zar) => {
                buildModel(zar, `objects/model/kanban2_model.cmb`);
            });
            else
                console.warn(`Unknown En_A_Obj model ${whichObject}`);
        }
        // NPCs.
        else if (actor.actorId === ActorId.En_Ko) {
            const whichNPC = actor.variable & 0xFF;

            if (whichNPC === 0x00) { // Standing boy.
                fetchArchive(`zelda_km1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokirimaster.cmb`);
                    b.shapeInstances[2].visible = false;
                    b.setVertexColorScale(characterLightScale);
                    b.bindCSAB(parseCSAB(zar, `anim/km1_ishi_wait.csab`));
                });
            } else if (whichNPC === 0x01) { // Standing girl.
            } else if (whichNPC === 0x02) { // Boxing boy.
                fetchArchive(`zelda_km1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokirimaster.cmb`);
                    b.shapeInstances[2].visible = false;
                    b.setVertexColorScale(characterLightScale);
                    b.bindCSAB(parseCSAB(zar, `anim/km1_osiete_wait.csab`));
                });
            } else if (whichNPC === 0x03) { // Blocking boy.
            } else if (whichNPC === 0x04) { // Backflipping boy.
                fetchArchive(`zelda_km1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokirimaster.cmb`);
                    b.shapeInstances[2].visible = false;
                    b.setVertexColorScale(characterLightScale);
                    b.bindCSAB(parseCSAB(zar, `anim/km1_backcyu.csab`));
                });
            } else if (whichNPC === 0x05) { // Sitting girl.
                fetchArchive(`zelda_kw1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokiripeople.cmb`);
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[2].visible = false;
                    b.shapeInstances[3].visible = false;
                    b.shapeInstances[4].visible = false;
                    b.bindCSAB(parseCSAB(zar, `anim/km1_utsumuki_pose.csab`));
                });
            } else if (whichNPC === 0x06) { // Standing girl.
                fetchArchive(`zelda_kw1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokiripeople.cmb`);
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[2].visible = false;
                    b.shapeInstances[3].visible = false;
                    b.shapeInstances[4].visible = false;
                    b.bindCSAB(parseCSAB(zar, `anim/km1_shinpai_pose.csab`));
                });
            } else if (whichNPC === 0x07) { // Unknown -- in Know-it-All Brother's House.
            } else if (whichNPC === 0x08) { // Unknown -- in Know-it-All Brother's House.
            } else if (whichNPC === 0x0A) { // Unknown -- in Kokiri Shop.
            } else if (whichNPC === 0x0B) { // Unknown -- in Know-it-All Brother's House.
            } else if (whichNPC === 0x0C) { // Blonde girl.
                fetchArchive(`zelda_kw1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokiripeople.cmb`);
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[5].visible = false;
                    b.shapeInstances[6].visible = false;
                    b.bindCSAB(parseCSAB(zar, `anim/fad_n_wait.csab`));
                });
            } else {
                throw "whoops";
            }
        }
        else if (actor.actorId === ActorId.En_Ossan) {
            const whichShopkeeper = actor.variable & 0x0F;
            if (whichShopkeeper === 0x00) {        // Kokiri Shopkeeper
                fetchArchive(`zelda_km1.zar`).then((zar) => {
                    const b = buildModel(zar, `model/kokirimaster.cmb`);
                    b.shapeInstances[4].visible = false;
                    b.bindCSAB(parseCSAB(zar, `anim/km1_omise.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichShopkeeper === 0x01) { // Kakariko Potion Shopkeeper
                // TODO(jstpierre)
            } else if (whichShopkeeper === 0x02) { // Bombchu Shopkeeper
                fetchArchive(`zelda_rs.zar`).then((zar) => {
                    const b = buildModel(zar, `model/bomchumaster.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/rs_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichShopkeeper === 0x03) { // Market Potion Shopkeeper
                fetchArchive(`zelda_ds2.zar`).then((zar) => {
                    const b = buildModel(zar, `model/drugmaster.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/ds2_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichShopkeeper === 0x04) { // Bazaar Shopkeeper
                fetchArchive(`zelda_sh.zar`).then((zar) => {
                    const b = buildModel(zar, `model/shotmaster.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/sh_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[1].visible = false;
                    b.shapeInstances[2].visible = false;
                });
            } else if (whichShopkeeper === 0x07) { // Zora Shopkeeper
                fetchArchive(`zelda_masterzoora.zar`).then((zar) => {
                    const b = buildModel(zar, `model/zorapeople.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/zo_omise.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichShopkeeper === 0x08) { // Goron Shopkeeper
                fetchArchive(`zelda_mastergolon.zar`).then((zar) => {
                    const b = buildModel(zar, `model/goronpeople.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/oF1d_omise.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichShopkeeper === 0x0A) { // Happy Mask Shopkeeper
                fetchArchive(`zelda_os.zar`).then((zar) => {
                    const b = buildModel(zar, `model/maskmaster.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/os_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else {
                console.log(whichShopkeeper);
                throw "Starschulz";
            }
        }
        else if (actor.actorId === ActorId.En_Brob) fetchArchive('zelda_brob.zar').then((zar) => {
            const b = buildModel(zar, `model/brob.cmb`);
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Heishi2) fetchArchive(`zelda_sd.zar`).then((zar) => {
            const whichGuard = actor.variable & 0xFF;
            if (whichGuard === 0x02) { // Hyrule Castle Guard
                const b = buildModel(zar, `model/soldier.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/sd_matsu.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else if (whichGuard === 0x05) { // Death Mountain Guard
                const b = buildModel(zar, `model/soldier.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/sd_matsu.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else if (whichGuard === 0x06) { // Ceremonial Guards
                const b = buildModel(zar, `model/soldier2.cmb`);
                b.setVertexColorScale(characterLightScale);
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.En_Eiyer) fetchArchive(`zelda_ei.zar`).then((zar) => {
            const Formation = actor.variable & 0xFFFF;
            if (Formation === 0x00) { // Four spinning in circle
                const b = buildModel(zar, `model/stinga.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/ei_swim.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else if (Formation === 0x01) { // Formation of 3
                const b = buildModel(zar, `model/stinga.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/ei_wait.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else if (Formation === 0x02) { // Two, under floor
                const b = buildModel(zar, `model/stinga.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/ei_wait.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else if (Formation === 0x03) { // One under floor
                const b = buildModel(zar, `model/stinga.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/ei_wait.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else if (Formation === 0x0A) { // Single
                const b = buildModel(zar, `model/stinga.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/ei_swim.csab`)); 
                b.setVertexColorScale(characterLightScale);
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.En_Ssh) fetchArchive(`zelda_ssh.zar`).then((zar) => {
            const b = buildModel(zar, `model/spiderman.cmb`, 0.03);
            b.bindCSAB(parseCSAB(zar, `anim/st_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Boss_Sst) fetchArchive(`zelda_sst.zar`).then((zar) => {
            const b = buildModel(zar, `model/bongobongo.cmb`, 0.015);
            b.modelMatrix[14] += -500; // looks nicer offset a bit
            b.bindCSAB(parseCSAB(zar, `anim/ss_wait_open.csab`));
            b.setVertexColorScale(characterLightScale);
            // this is the actor spot for one of his hands, but since there's only one spot in the scene i put 
            // the boss in there instead.
        });
        else if (actor.actorId === ActorId.En_Go2) fetchArchive(`zelda_oF1d.zar`).then((zar) => {
            const b = buildModel(zar, `model/goronpeople.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/oF1d_dai_goron_kaii.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Cs) fetchArchive(`zelda_cs.zar`).then((zar) => {
            const b = buildModel(zar, `model/childstalker.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/cs_matsu03.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Cow) fetchArchive('zelda_cow.zar').then((zar) => {
            const b = buildModel(zar, `model/cow.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/usi_mogmog.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Zo) fetchArchive('zelda_zo.zar').then((zar) => {
            const b = buildModel(zar, `model/zorapeople.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/zo_riku_matsu.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_In) fetchArchive('zelda_in.zar').then((zar) => {
            const b = buildModel(zar, `model/ingo.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/in_shigoto.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Ma1) fetchArchive(`zelda_ma1.zar`).then((zar) => {
            const b = buildModel(zar, `model/childmalon.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ma1_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Ma2) fetchArchive(`zelda_ma2.zar`).then((zar) => {
            const b = buildModel(zar, `model/malon.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ma2_shigoto.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Horse_Normal) fetchArchive(`zelda_horse_normal.zar`).then((zar) => {
            const b = buildModel(zar, `model/normalhorse.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/hn_anim_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Ta) fetchArchive(`zelda_ta.zar`).then((zar) => {
            const b = buildModel(zar, `model/talon.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ta_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Ds) fetchArchive(`zelda_ds.zar`).then((zar) => {
            const b = buildModel(zar, `model/magicmaster.cmb`, 0.013);
            b.bindCSAB(parseCSAB(zar, `anim/ds_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Mk) fetchArchive(`zelda_mk.zar`).then((zar) => {
            const b = buildModel(zar, `model/lakedoctor.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/mk_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Niw_Lady) fetchArchive(`zelda_ane.zar`).then((zar) => {
            const b = buildModel(zar, `model/chickenlady.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/Ane_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Niw_Girl) fetchArchive(`zelda_gr.zar`).then((zar) => {
            const b = buildModel(zar, `model/chickengirl.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/gr_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Daiku_Kakariko) fetchArchive('zelda_daiku.zar').then((zar) => {
            const b = buildModel(zar, `model/disciple.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/dk2_hanasi.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Du) fetchArchive('zelda_du.zar').then((zar) => {
            const b = buildModel(zar, `model/darunia.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/du_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Sa) fetchArchive(`zelda_sa.zar`).then((zar) => {
            const b = buildModel(zar, `model/saria.cmb`);
            // Chosen because she's placed to be sitting down on the wood stump in the Sacred Forest Temple room setup we spawn.
            b.bindCSAB(parseCSAB(zar, `anim/sa_okarina_hanasi_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Skj) fetchArchive(`zelda_skj.zar`).then((zar) => {
            const b = buildModel(zar, `model/stalkid.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/skeltonJR_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Owl) fetchArchive(`zelda_owl.zar`).then((zar) => {
            const b = buildModel(zar, `model/kaeporagaebora1.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/owl_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Okuta) fetchArchive(`zelda_oc2.zar`).then((zar) => {
            const b = buildModel(zar, `model/octarock.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/oc_float.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Ani) fetchArchive(`zelda_ani.zar`).then((zar) => {
            const b = buildModel(zar, `model/roofman.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ani_suwari_wait.csab`));
            b.modelMatrix[13] -= 25;
        });
        else if (actor.actorId === ActorId.En_Niw) fetchArchive(`zelda_nw.zar`).then((zar) => {
            const b = buildModel(zar, `model/chicken.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/nw_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Toryo) fetchArchive(`zelda_toryo.zar`).then((zar) => {
            const b = buildModel(zar, `model/bosshead.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/dk1_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Ru2) fetchArchive(`zelda_ru2.zar`).then((zar) => {
            const b = buildModel(zar, `model/ruto.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ru2_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Nb) fetchArchive(`zelda_nb.zar`).then((zar) => {
            const b = buildModel(zar, `model/nabooru.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/nb_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Demo_Sa) fetchArchive(`zelda_sa.zar`).then((zar) => {
            const b = buildModel(zar, `model/saria.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/sa_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Demo_Im) fetchArchive(`zelda_im.zar`).then((zar) => {
            const b = buildModel(zar, `model/impa.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/impa_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
            // Hide her veil; it's only used in the opening cutscenes.
            b.shapeInstances[9].visible = false;
        });
        else if (actor.actorId === ActorId.En_Rl) fetchArchive(`zelda_rl.zar`).then((zar) => {
            const b = buildModel(zar, `model/raul.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/rl_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Zl3) fetchArchive(`zelda_zl2.zar`).then((zar) => {
            const b = buildModel(zar, `model/zelda.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/ze_a_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Demo_Du) fetchArchive(`zelda_du.zar`).then((zar) => {
            const b = buildModel(zar, `model/darunia.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/du_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Heishi4) fetchArchive(`zelda_sd.zar`).then((zar) => {
            const b = buildModel(zar, `model/soldier.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/sd_matsu.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Heishi1) fetchArchive(`zelda_sd.zar`).then((zar) => {
            const b = buildModel(zar, `model/soldier.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/sd_matsu.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Heishi3) fetchArchive(`zelda_sd.zar`).then((zar) => {
            const b = buildModel(zar, `model/soldier.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/sd_matsu.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Zl4) fetchArchive(`zelda_zl4.zar`).then((zar) => {
            const b = buildModel(zar, `model/childzelda.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/kozelda_ushiro_wait.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Tg) fetchArchive(`zelda_mu.zar`).then((zar) => {
            const b = buildModel(zar, `model/couple.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/tg_matsu.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Mu) fetchArchive(`zelda_mu.zar`).then((zar) => {
            const b = buildModel(zar, `model/marketpeople.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/mu_matsu.csab`)); 
            b.setVertexColorScale(characterLightScale);
            const whichPalette = actor.variable & 0x000F;
            if (whichPalette === 0x00) {
                b.setConstantColor(1, colorNew(0.39216, 0.5098, 0.92157));
                b.setConstantColor(2, colorNew(0.11765, 0.94118, 0.78431));
                b.setConstantColor(3, colorNew(0.62745, 0.98039, 0.23529));
                b.setConstantColor(4, colorNew(0.35294, 0.23529, 0.03992));
            } else if (whichPalette === 0x01) {
                b.setConstantColor(1, colorNew(0.35294, 0.23529, 0.03992));
                b.setConstantColor(2, colorNew(0.62745, 0.98039, 0.23529));
                b.setConstantColor(3, colorNew(0.11765, 0.94118, 0.78431));
                b.setConstantColor(4, colorNew(0.35294, 0.23529, 0.03992));
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.En_Dog) fetchArchive(`zelda_dog.zar`).then((zar) => {
            const b = buildModel(zar, `model/dog.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/dog_sit.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Hy) {
            // TODO(jstpierre): verify this with a renderdoc cap
            const whichNPC = (actor.variable & 0x003F);
            if (whichNPC === 0x00) { // "Fat woman in light blue"
                fetchArchive(`zelda_aob.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliawoman1.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/aob_mastu.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichNPC === 0x01) { // "Old man in blue"
                fetchArchive(`zelda_cob.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliawoman2.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/cob_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichNPC === 0x02) { // "Bearded man in white & green"
                fetchArchive(`zelda_ahg.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman2.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/ahg_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                    b.setConstantColor(3, White);
                    b.setConstantColor(4, White);
                    for (let i = 5; i < 8; i++)
                        b.shapeInstances[i].visible = false;
                });
            } else if (whichNPC === 0x03) { // "Jogging man (Sakon)"
                fetchArchive(`zelda_boj.zar`).then((zar) => {
                    // TODO(jstpierre): Animate on path
                    const b = buildModel(zar, `model/hyliaman1.cmb`);
                    b.setConstantColor(3, colorNew(0.21568, 0.21568, 1));
                    b.setConstantColor(4, White);
                    b.bindCSAB(parseCSAB(zar, `anim/boj2_5.csab`));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 12; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[6].visible = true;
                    b.shapeInstances[11].visible = true;
                });
            } else if (whichNPC === 0x04) { // "Staunch man in black & green"
                fetchArchive(`zelda_ahg.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman2.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/ahg2_18.csab`));
                    b.setConstantColor(3, colorNew(1, 0, 0));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 8; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[5].visible = true;
                });
            } else if (whichNPC === 0x05) { // "Begging man"
                fetchArchive(`zelda_boj.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman1.cmb`);
                    b.setConstantColor(3, colorNew(0.19608, 0.31373, 0));
                    b.setConstantColor(4, colorNew(0.19608, 0.31373, 0));
                    b.bindCSAB(parseCSAB(zar, `anim/boj2_9.csab`));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 12; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[7].visible = true;
                });
            } else if (whichNPC === 0x06) { // "Old woman in white"
                fetchArchive(`zelda_bba.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaoldwoman.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/bba_matsu.csab`));
                    b.setVertexColorScale(characterLightScale);
                });
            } else if (whichNPC === 0x07) { // "Old man in blue"
                fetchArchive(`zelda_bji.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaoldman.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/bji_matsu.csab`));
                    b.setConstantColor(3, White);
                    b.setConstantColor(4, colorNew(0, 0.1968, 0.62745));
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[5].visible = false;
                });
            } else if (whichNPC === 0x08) { // "Thin woman in lilac"
                fetchArchive(`zelda_cne.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hylialady.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/cne_n_wait.csab`));
                    b.setVertexColorScale(characterLightScale);
                    b.setConstantColor(2, colorNew(0.62734, 0.70588, 1));
                    b.setConstantColor(3, colorNew(0.62734, 0.70588, 1));
                    b.setConstantColor(4, colorNew(0.62734, 0.70588, 1));
                    b.shapeInstances[5].visible = false;
                });
            } else if (whichNPC === 0x09) { // "Laughing man in red & white"
                fetchArchive(`zelda_boj.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman1.cmb`);
                    b.setConstantColor(3, White);
                    b.setConstantColor(4, colorNew(0.86275, 0, 0.31373));
                    b.bindCSAB(parseCSAB(zar, `anim/boj_13.csab`));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 6; i < 12; i++)
                        b.shapeInstances[i].visible = false;
                });
            } else if (whichNPC === 0x0A) { // "Explaining man in blue & white"
                fetchArchive(`zelda_boj.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman1.cmb`);
                    b.setConstantColor(3, White);
                    b.setConstantColor(4, colorNew(0, 0.5098, 0.86275));
                    b.bindCSAB(parseCSAB(zar, `anim/boj_14.csab`));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 6; i < 12; i++)
                        b.shapeInstances[i].visible = false;
                });
            } else if (whichNPC === 0x0B) { // "Thin woman in blue & yellow"
                fetchArchive(`zelda_cne.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hylialady.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/cne2_15.csab`));
                    b.setVertexColorScale(characterLightScale);
                    b.setConstantColor(2, White);
                    b.setConstantColor(3, colorNew(1, 1, 0.39216));
                    b.setConstantColor(4, colorNew(0.27451, 0.62734, 0.90196));
                    b.shapeInstances[4].visible = false;
                });
            } else if (whichNPC === 0x0C) { // "Looking man in crimson"
                fetchArchive(`zelda_boj.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman1.cmb`);
                    b.setConstantColor(3, colorNew(1, 0.94118, 0.58824));
                    b.setConstantColor(4, colorNew(0.58824, 0.23529, 0.35294));
                    b.bindCSAB(parseCSAB(zar, `anim/boj2_17.csab`));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 12; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[8].visible = true;
                });
            } else if (whichNPC === 0x0D) { // "Red haired man in green & lilac"
                fetchArchive(`zelda_ahg.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman2.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/ahg2_18.csab`));
                    b.setConstantColor(3, colorNew(0.78431, 0.70588, 1));
                    b.setConstantColor(4, colorNew(0.78431, 0.70588, 1));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 8; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[6].visible = true;
                });
            } else if (whichNPC === 0x0E) { // "Bearded, red haired man in green & white"
                fetchArchive(`zelda_boj.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman1.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/boj2_19.csab`));
                    b.setConstantColor(3, White);
                    b.setConstantColor(4, colorNew(0.54901, 1, 0.43137));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 12; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[9].visible = true;
                });
            } else if (whichNPC === 0x0F) { // "Bald man in brown"
                fetchArchive(`zelda_bji.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaoldman.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/bji2_20.csab`));
                    b.setConstantColor(3, colorNew(0.50980, 0.70577, 1));
                    b.setConstantColor(4, colorNew(0.50980, 0.27450, 0.07843));
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[3].visible = false;
                    b.shapeInstances[4].visible = false;
                });
            } else if (whichNPC === 0x13) { // Old man inside Market Potion Shop
                fetchArchive(`zelda_bji.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaoldman.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/bji2_20.csab`));
                    b.setConstantColor(3, colorNew(0.27450, 0.50980, 0.82352));
                    b.setConstantColor(4, colorNew(0.62754, 0, 0.39215));
                    b.setVertexColorScale(characterLightScale);
                    b.shapeInstances[3].visible = false;
                    b.shapeInstances[4].visible = false;
                });
            } else if (whichNPC === 0x14) { // Man inside Market Bazaar
                fetchArchive(`zelda_ahg.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hyliaman2.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/ahg2_18.csab`));
                    b.setConstantColor(3, colorNew(0, 0.58823, 0.43137));
                    b.setConstantColor(4, colorNew(0.62745, 0.90196, 0));
                    b.setVertexColorScale(characterLightScale);
                    for (let i = 3; i < 8; i++)
                        b.shapeInstances[i].visible = false;
                    b.shapeInstances[6].visible = true;
                });
            } else {
                console.warn(`Unknown Hyrule Market NPC ${j} / ${hexzero(whichNPC, 2)}`);
            }
        }
        else if (actor.actorId === ActorId.Fishing) fetchArchive(`zelda_fishing.zar`).then((zar) => {
            const whichModel = actor.variable;
            if (whichModel === 0x0000) {
                const b = buildModel(zar, `model/fishmaster.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/fs_matsu.csab`));
                b.setVertexColorScale(characterLightScale);
            } else {
                console.log(`Unknown fishing model ${whichModel}`);
            }
        });
        else if (actor.actorId === ActorId.En_Bom_Bowl_Man) fetchArchive(`zelda_bg.zar`).then((zar) => {
            const b = buildModel(zar, `model/boringmaster.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/bg_wait.csab`));
            b.setVertexColorScale(characterLightScale);
            b.modelMatrix[13] += 10;
        });
        else if (actor.actorId === ActorId.En_Takara_Man) fetchArchive(`zelda_ts.zar`).then((zar) => {
            const b = buildModel(zar, `model/lottomaster.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ts_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
            b.modelMatrix[13] += 10;
        });
        else if (actor.actorId === ActorId.Grezzo_Hintstone) fetchArchive(`zelda_hintstone.zar`).then((zar) => {
            const b = buildModel(zar, `model/hintstone.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/newstock.csab`));
        });
        // Enemies
        else if (actor.actorId === ActorId.En_Hintnuts) fetchArchive(`zelda_hintnuts.zar`).then((zar) => {
            const b = buildModel(zar, `model/dekunuts.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/dnh_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Shopnuts) fetchArchive(`zelda_shopnuts.zar`).then((zar) => {
            const b = buildModel(zar, `model/akindonuts.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/dnu_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Wf) fetchArchive(`zelda_wf.zar`).then((zar) => {
            const b = buildModel(zar, `model/wolfos.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/wolfman_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Dekunuts) fetchArchive(`zelda_dekunuts.zar`).then((zar) => {
            const b = buildModel(zar, `model/okorinuts.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/dn_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Am) fetchArchive('zelda_am.zar').then((zar) => {
            const b = buildModel(zar, `model/amos.cmb`, 0.015);
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Vm) fetchArchive('zelda_vm.zar').then((zar) => {
            const b = buildModel(zar, `model/beamos.cmb`);
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Crow) fetchArchive(`zelda_crow.zar`).then((zar) => {
            const b = buildModel(zar, `model/gue.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/df_hover.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Bb) fetchArchive(`zelda_bb.zar`).then((zar) => {
            const b = buildModel(zar, `model/bubble.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/bb_fly.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Test) fetchArchive(`zelda_skelton.zar`).then((zar) => {
            const b = buildModel(zar, `model/stalfos.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/skelton_fighting_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Wallmas) fetchArchive(`zelda_wm2.zar`).then((zar) => {
            const b = buildModel(zar, `model/fallmaster.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/wm_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Floormas) fetchArchive(`zelda_wm2.zar`).then((zar) => {
            const b = buildModel(zar, `model/floormaster.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/wm_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_St) fetchArchive('zelda_st.zar').then((zar) => {
            const b = buildModel(zar, `model/staltula.cmb`, 0.02);
            b.bindCSAB(parseCSAB(zar, `anim/st_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Dodojr) fetchArchive('zelda_dodojr.zar').then((zar) => {
            const b = buildModel(zar, `model/babydodongo.cmb`, 0.02);
            b.bindCSAB(parseCSAB(zar, `anim/dd_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Dodongo) fetchArchive('zelda_dodongo.zar').then((zar) => {
            const b = buildModel(zar, `model/dodongo.cmb`, 0.02);
            b.bindCSAB(parseCSAB(zar, `anim/da_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Firefly) fetchArchive('zelda_ff.zar').then((zar) => {
            const b = buildModel(zar, `model/keith.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/firefly_foot_at.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Fr) fetchArchive(`zelda_fr.zar`).then((zar) => {
            const b = buildModel(zar, `model/frog.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/wait.csab`));
            b.setVertexColorScale(characterLightScale); // they all show up as solid black, instead of their color variations
        });
        else if (actor.actorId === ActorId.En_Fu) fetchArchive('zelda_fu.zar').then((zar) => {
            const b = buildModel(zar, `model/windmillman.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/fu_mawasu.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Bw) fetchArchive('zelda_bw.zar').then((zar) => {
            const b = buildModel(zar, `model/torchsrag.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/bw_aruku.csab`));
            b.bindCMAB(parseCMAB(zar, `Misc/torchsrag.cmab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Bili) fetchArchive('zelda_bl.zar').then((zar) => {
            const b = buildModel(zar, `model/bili.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/bl_nomral.csab`));
            b.bindCMAB(parseCMAB(zar, `Misc/pt_bili.cmab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Bg_Dy_Yoseizo) fetchArchive('zelda_dy_obj.zar').then((zar) => {
            const b = buildModel(zar, `model/fairy.cmb`, 0.025);
            b.bindCSAB(parseCSAB(zar, `anim/DY_n_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Anubice_Tag) fetchArchive('zelda_av.zar').then((zar) => {
            const b = buildModel(zar, `model/anubis.cmb`, 0.015);
            b.bindCSAB(parseCSAB(zar, `anim/av_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Dha) fetchArchive('zelda_dh.zar').then((zar) => {
            const b = buildModel(zar, `model/deadarm.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/dead_armR_wait_20f.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Dh) fetchArchive('zelda_dh.zar').then((zar) => {
            const b = buildModel(zar, `model/deadhand.cmb`, 0.01);
            b.bindCSAB(parseCSAB(zar, `anim/dead_hand_wait_20f.csab`));
            b.setVertexColorScale(characterLightScale);
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 90 * MathConstants.DEG_TO_RAD);
        });
        else if (actor.actorId === ActorId.En_Karebaba) fetchArchive('zelda_dekubaba.zar').then((zar) => {
            const head = buildModel(zar, `model/dekubaba.cmb`, 0.01);
            head.bindCSAB(parseCSAB(zar, `anim/db_P_kougeki.csab`));
            head.modelMatrix[13] += +60;
            head.modelMatrix[14] += +3;
            head.setVertexColorScale(characterLightScale);
            const bush = buildModel(zar, `model/db_ha_model.cmb`, 0.01);
            bush.setVertexColorScale(characterLightScale);
            const stem1 = buildModel(zar, `model/db_miki1_model.cmb`, 0.01);
            stem1.modelMatrix[13] += +40;
            mat4.rotateX(stem1.modelMatrix, stem1.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
            stem1.setVertexColorScale(characterLightScale);
            const stem2 = buildModel(zar, `model/db_miki2_model.cmb`, 0.01);
            stem2.modelMatrix[13] += +20;
            mat4.rotateX(stem2.modelMatrix, stem2.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
            stem2.setVertexColorScale(characterLightScale);
            const stem3 = buildModel(zar, `model/db_miki3_model.cmb`, 0.01);
            mat4.rotateX(stem3.modelMatrix, stem3.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
            stem3.setVertexColorScale(characterLightScale);
            // Assembled Deku Baba
        });
        else if (actor.actorId === ActorId.En_Sw) fetchArchive('zelda_st.zar').then((zar) => {
            const whichSkulltula = (actor.variable >>> 12) & 0x07;
            if (whichSkulltula === 0x00)  { // Skullwalltula
                const b = buildModel(zar, `model/staltula.cmb`, 0.02);
                b.bindCSAB(parseCSAB(zar, `anim/st_matsu.csab`));
                b.setVertexColorScale(characterLightScale);
            } else if (whichSkulltula === 0x04) { // Golden Skulltula
                const b = buildModel(zar, `model/staltula_gold.cmb`, 0.02);
                b.bindCSAB(parseCSAB(zar, `anim/st_matsu.csab`));
                b.setVertexColorScale(characterLightScale);
            } else if (whichSkulltula === 0x05) { // Golden Skulltula (only spawns at night)
                const b = buildModel(zar, `model/staltula_gold.cmb`, 0.02);
                b.bindCSAB(parseCSAB(zar, `anim/st_matsu.csab`));
                b.setVertexColorScale(characterLightScale);
            }
        });
        else if (actor.actorId === ActorId.En_Peehat) fetchArchive('zelda_ph.zar').then((zar) => {
            const whichSkulltula = actor.variable & 0xFFFF;
            if (whichSkulltula === 0x00)  { // Flying Peahat
                const b = buildModel(zar, `model/peehat.cmb`, 0.05);
                b.setVertexColorScale(characterLightScale);
            } else if (whichSkulltula === 0x01) { // PeahatLarva
                const b = buildModel(zar, `model/peehat_tail.cmb`, 0.05);
                b.setVertexColorScale(characterLightScale);
            } else if (whichSkulltula === 0xFFFF) { // Burrowed Peahat
                const b = buildModel(zar, `model/peehat.cmb`, 0.05);
                b.setVertexColorScale(characterLightScale);
            }
        });
        else if (actor.actorId === ActorId.En_Dekubaba) fetchArchive(`zelda_dekubaba.zar`).then((zar) => {
            // The Deku Baba lies in hiding...
            buildModel(zar, `model/db_ha_model.cmb`);
        });
        else if (actor.actorId === ActorId.En_Tite) fetchArchive(`zelda_tt.zar`).then((zar) => {
            const b = buildModel(zar, `model/tectite.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/tt_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.En_Rd) fetchArchive(`zelda_rd.zar`).then((zar) => {
            const whichEnemy = (actor.variable >>> 7) & 0x01;
            if (whichEnemy === 0x00) { // Redead
                const b = buildModel(zar, `model/redead.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/re_dead_wait_20f.csab`));
            } else if (whichEnemy === 0x01) { // Gibdo
                const b = buildModel(zar, `model/gibud.cmb`);
                b.bindCSAB(parseCSAB(zar, `anim/re_dead_wait_20f.csab`));
            }
        });
        // Bosses
        else if (actor.actorId === ActorId.Boss_Goma) fetchArchive('zelda_goma.zar').then((zar) => {
            const b = buildModel(zar, `model/goma.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/go_startdemo02.csab`)); 
            b.setVertexColorScale(characterLightScale);
            b.modelMatrix[13] += -360;  // offset so it stands on the ground instead of in the cieling
        });
        else if (actor.actorId === ActorId.Boss_Dodongo) fetchArchive(`zelda_kdodongo.zar`).then((zar) => {
            const b = buildModel(zar, `model/kingdodongo.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/kd_wait.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Boss_Fd) fetchArchive(`zelda_fd.zar`).then((zar) => {
            const b = buildModel(zar, `model/valbasiagnd.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/vba_wait.csab`));
            b.setVertexColorScale(characterLightScale);
            b.modelMatrix[13] += -730; // repositioning
            b.modelMatrix[14] += -13;
            b.modelMatrix[12] += 10;
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 90 * MathConstants.DEG_TO_RAD);
        });
        else if (actor.actorId === ActorId.Boss_Ganon) fetchArchive(`zelda_ganon.zar`).then((zar) => {
            const b = buildModel(zar, `model/ganondorf.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/G_n_wait.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Boss_Ganondrof) fetchArchive(`zelda_fantomHG.zar`).then((zar) => {
            const horse = buildModel(zar, `model/ganonhorse.cmb`);
            horse.bindCSAB(parseCSAB(zar, `anim/hgf_wait.csab`)); 
            horse.setVertexColorScale(characterLightScale);
            horse.modelMatrix[13] += -639; // stand on the ground
            //const phantom = buildModel(zar, `model/f_ganon_efc_mode1T.cmb`); //None of the other models in the .zar show up besides the horse?
        });
        else if (actor.actorId === ActorId.Boss_Ganon2) fetchArchive(`zelda_ganon2.zar`).then((zar) => {
            const b = buildModel(zar, `model/ganon.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/gn2_Kwait.csab`)); 
            b.setVertexColorScale(characterLightScale);
            b.modelMatrix[12] += +500; // these offset ganon out of the rubble and facing center
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 90 * MathConstants.DEG_TO_RAD);
        });
        // Navi message, doesn't have a visible actor.
        else if (actor.actorId === ActorId.Elf_Msg) return;
        else if (actor.actorId === ActorId.Elf_Msg2) return;
        else if (actor.actorId === ActorId.En_Wonder_Talk) return;
        else if (actor.actorId === ActorId.En_Wonder_Talk2) return;
        // Ambient sound effects
        else if (actor.actorId === ActorId.En_River_Sound) return;
        // Invisible item spawn
        else if (actor.actorId === ActorId.En_Wonder_Item) return;
        // Ocarina Trigger
        else if (actor.actorId === ActorId.En_Okarina_Tag) return;
        else console.warn(`Unknown actor ${j} / ${stringifyActorId(actor.actorId)} / ${hexzero(actor.variable, 4)}`);
    }

    private spawnSkybox(device: GfxDevice, renderer: OoT3DRenderer, zar: ZAR.ZAR, skyboxSettings: number): void {
        // Attach the skybox to the first roomRenderer.
        const roomRenderer = renderer.roomRenderers[0];

        function buildModel(zar: ZAR.ZAR, modelPath: string): CmbInstance {
            const cmbData = renderer.modelCache.getModel(device, renderer, zar, modelPath);
            const cmbRenderer = new CmbInstance(device, renderer.textureHolder, cmbData);
            cmbRenderer.isSkybox = true;
            cmbRenderer.animationController.fps = 20;
            cmbRenderer.passMask = OoT3DPass.SKYBOX;
            roomRenderer.objectRenderers.push(cmbRenderer);
            return cmbRenderer;
        }
        function parseCMAB(zar: ZAR.ZAR, filename: string) { return CMAB.parse(CMB.Version.Ocarina, assertExists(ZAR.findFileData(zar, filename))); }

        const whichSkybox = (skyboxSettings) & 0xFF;
        if (whichSkybox === 0x01) {
            const tenyku = buildModel(zar, `model/fine_tenkyu_1.cmb`);

            const a = buildModel(zar, `model/fine_kumo_a1.cmb`);
            a.bindCMAB(parseCMAB(zar, `misc/fine_kumo_a.cmab`));

            const b = buildModel(zar, `model/fine_kumo_b1.cmb`);
            b.bindCMAB(parseCMAB(zar, `misc/fine_kumo_b.cmab`));
        } else if (whichSkybox === 0x1D) {
            // Environment color, used in a lot of scenes.
            // TODO(jstpierre): Implement. Where does it get the color from?
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const path_zar = `${pathBase}/scene/${this.id}.zar`;
        const path_info_zsi = `${pathBase}/scene/${this.id}_info.zsi`;
        const dataFetcher = context.dataFetcher;

        const [zarBuffer, zsiBuffer] = await Promise.all([
            dataFetcher.fetchData(path_zar, DataFetcherFlags.ALLOW_404),
            dataFetcher.fetchData(path_info_zsi),
        ]);

        const textureHolder = new CtrTextureHolder();
        const modelCache = new ModelCache(dataFetcher);

        const zar = zarBuffer.byteLength ? ZAR.parse(zarBuffer) : null;

        const zsi = ZSI.parseScene(zsiBuffer);
        assert(zsi.rooms !== null);

        const renderer = new OoT3DRenderer(device, textureHolder, zsi, modelCache);
        context.destroyablePool.push(renderer);

        const scene = chooseSceneFromId(this.id);

        const roomZSINames: string[] = [];
        for (let i = 0; i < zsi.rooms.length; i++) {
            const filename = zsi.rooms[i].split('/').pop();
            const roomZSIName = `${pathBase}/scene/${filename}`;
            roomZSINames.push(roomZSIName);
            modelCache.fetchFileData(roomZSIName);
        }

        modelCache.fetchArchive(`${pathBase}/kankyo/BlueSky.zar`);

        await modelCache.waitForLoad();

        for (let i = 0; i < roomZSINames.length; i++) {
            const roomSetups = ZSI.parseRooms(modelCache.getFileData(roomZSINames[i]));

            let roomSetup: ZSI.ZSIRoomSetup;
            if (this.setupIndex === -1)
                roomSetup = roomSetups.find((setup) => setup.mesh !== null);
            else
                roomSetup = roomSetups[this.setupIndex];

            assert(roomSetup.mesh !== null);
            const filename = roomZSINames[i].split('/').pop();
            const roomRenderer = new RoomRenderer(device, textureHolder, roomSetup.mesh, filename);
            roomRenderer.roomSetups = roomSetups;
            if (zar !== null) {
                const cmabFile = zar.files.find((file) => file.name.startsWith(`ROOM${i}\\`) && file.name.endsWith('.cmab') && !file.name.endsWith('_t.cmab'));
                if (cmabFile) {
                    const cmab = CMAB.parse(CMB.Version.Ocarina, cmabFile.buffer);
                    textureHolder.addTextures(device, cmab.textures);
                    roomRenderer.bindCMAB(cmab);
                }
            }
            renderer.roomRenderers.push(roomRenderer);

            for (let j = 0; j < roomSetup.actors.length; j++)
                this.spawnActorForRoom(device, scene, renderer, roomRenderer, roomSetup.actors[j], j);
        }

        // We stick doors into the first roomRenderer to keep things simple.
        for (let j = 0; j < zsi.doorActors.length; j++)
            this.spawnActorForRoom(device, scene, renderer, renderer.roomRenderers[0], zsi.doorActors[j], j);

        const skyboxZAR = modelCache.getArchive(`${pathBase}/kankyo/BlueSky.zar`);
        this.spawnSkybox(device, renderer, skyboxZAR, zsi.skyboxSettings);

        await modelCache.waitForLoad();

        renderer.setEnvironmentSettingsIndex(0);
        return renderer;
    }
}

const id = "oot3d";
const name = "Ocarina of Time 3D";
// Courses organized by Starschulz
const sceneDescs = [
    "Kokiri Forest",
    new SceneDesc("spot04", "Kokiri Forest"),
    new SceneDesc("ydan", "Inside the Deku Tree"),
    new SceneDesc("ydan_boss", "Inside the Deku Tree (Boss)"),
    new SceneDesc("spot10", "Lost Woods"),
    new SceneDesc("spot05", "Sacred Forest Meadow"),
    new SceneDesc('bmori1', "Forest Temple"),
    new SceneDesc("moriboss", "Forest Temple (Boss)"),
    new SceneDesc("k_home", "Know-It-All Brothers' Home"),
    new SceneDesc("kokiri", "Kokiri Shop"),
    new SceneDesc("link", "Link's Home"),

    "Kakariko Village",
    new SceneDesc("spot01", "Kakariko Village"),
    new SceneDesc("kinsuta", "Skulltula House"),
    new SceneDesc("labo", "Impa's House"),
    new SceneDesc("mahouya", "Granny's Potion Shop"),
    new SceneDesc("shop_drag", "Kakariko Potion Shop"),
    new SceneDesc("spot02", "Kakariko Graveyard"),
    new SceneDesc("hut", "Dampe's Hut"),
    new SceneDesc("hakasitarelay", "Dampe's Grave & Windmill Hut"),
    new SceneDesc("hakaana_ouke", "Royal Family's Tomb"),
    new SceneDesc("hakadan", "Shadow Temple"),
    new SceneDesc("hakadan_boss", "Shadow Temple (Boss)"),
    new SceneDesc("hakadan_ch", "Bottom of the Well"),
    new SceneDesc("hakaana", "Heart Piece Grave"),
    new SceneDesc("kakariko", "Generous Woman's House"),

    "Death Mountain",
    new SceneDesc("spot16", "Death Mountain"),
    new SceneDesc("spot17", "Death Mountain Crater"),
    new SceneDesc("spot18", "Goron City"),
    new SceneDesc("shop_golon", "Goron Shop"),
    new SceneDesc("ddan", "Dodongo's Cavern"),
    new SceneDesc("ddan_boss", "Dodongo's Cavern (Boss)"),
    new SceneDesc("hidan", "Fire Temple"),
    new SceneDesc("fire_bs", "Fire Temple (Boss)"),

    "Hyrule Field",
    new SceneDesc("spot00", "Hyrule Field"),
    new SceneDesc("spot20", "Lon Lon Ranch"),
    new SceneDesc("souko", "Talon's House"),
    new SceneDesc("stable", "Stables"),
    new SceneDesc("spot99", "Link's Nightmare"),
    new SceneDesc("spot03", "Zora's River"),
    new SceneDesc("daiyousei_izumi", "Great Fairy Fountain"),
    new SceneDesc("yousei_izumi_tate", "Small Fairy Fountain"),
    new SceneDesc("yousei_izumi_yoko", "Magic Fairy Fountain"),
    new SceneDesc("kakusiana", "Grottos"),
    // new SceneDesc("hiral_demo", "Cutscene Map"),

    "Hyrule Castle / Town",
    new SceneDesc("spot15", "Hyrule Castle"),
    new SceneDesc("hairal_niwa", "Castle Courtyard"),
    new SceneDesc("hairal_niwa_n", "Castle Courtyard (Night)"),
    new SceneDesc("nakaniwa", "Zelda's Courtyard"),
    new SceneDesc("entra_day", "Market Entrance (Day)"),
    new SceneDesc("entra_night", "Market Entrance (Night)"),
    new SceneDesc("entra_ruins", "Market Entrance (Ruins)"),
    new SceneDesc("miharigoya", "Lots'o'Pots"),
    new SceneDesc("market_day", "Market (Day)"),
    new SceneDesc("market_night", "Market (Night)"),
    new SceneDesc("market_ruins", "Market (Ruins)"),
    new SceneDesc("market_alley", "Market Back-Alley (Day)"),
    new SceneDesc("market_alley_n", "Market Back-Alley (Night)"),
    new SceneDesc('bowling', "Bombchu Bowling Alley"),
    new SceneDesc("shop_night", "Bombchu Shop"),
    new SceneDesc("takaraya", "Treasure Chest Game"),
    new SceneDesc("kakariko_impa", "Puppy Woman's House"),
    new SceneDesc("shop_alley", "Market Potion Shop"),
    new SceneDesc("shop_face", "Happy Mask Shop"),
    new SceneDesc("syatekijyou", "Shooting Gallery"),
    new SceneDesc("shrine", "Temple of Time (Outside, Day)"),
    new SceneDesc("shrine_n", "Temple of Time (Outside, Night)"),
    new SceneDesc("shrine_r", "Temple of Time (Outside, Adult)"),
    new SceneDesc("tokinoma", "Temple of Time (Interior)"),
    new SceneDesc("kenjyanoma", "Chamber of the Sages", 3),
    new SceneDesc("shop", 'Bazaar'),

    "Lake Hylia",
    new SceneDesc("spot06", "Lake Hylia"),
    new SceneDesc("hylia_labo", "Hylia Lakeside Laboratory"),
    new SceneDesc("turibori", "Fishing Pond"),
    new SceneDesc("mizusin", "Water Temple"),
    new SceneDesc("mizusin_boss", "Water Temple (Boss)"),

    "Zora's Domain",
    new SceneDesc("spot07", "Zora's Domain"),
    new SceneDesc("spot08", "Zora's Fountain"),
    new SceneDesc("zoora", "Zora Shop"),
    new SceneDesc('bdan', "Jabu-Jabu's Belly"),
    new SceneDesc('bdan_boss', "Jabu-Jabu's Belly (Boss)"),
    new SceneDesc("ice_doukutu", "Ice Cavern"),

    "Gerudo Desert",
    new SceneDesc("spot09", "Gerudo Valley"),
    new SceneDesc("tent", "Carpenter's Tent"),
    new SceneDesc("spot12", "Gerudo's Fortress"),
    new SceneDesc("men", "Gerudo Training Grounds"),
    new SceneDesc("gerudoway", "Thieves' Hideout"),
    new SceneDesc("spot13", "Haunted Wasteland"),
    new SceneDesc("spot11", "Desert Colossus"),
    new SceneDesc("jyasinzou", "Spirit Temple"),
    new SceneDesc("jyasinzou_boss", "Spirit Temple (Mid-Boss)"),

    "Ganon's Castle",
    new SceneDesc("ganontika", "Ganon's Castle"),
    new SceneDesc("ganontikasonogo", "Ganon's Castle (Crumbling)"),
    new SceneDesc("ganon_tou", "Ganon's Castle (Outside)"),
    new SceneDesc("ganon", "Ganon's Castle Tower"),
    new SceneDesc("ganon_sonogo", "Ganon's Castle Tower (Crumbling)"),
    new SceneDesc("ganon_boss", "Second-To-Last Boss Ganondorf"),
    new SceneDesc("ganon_demo", "Final Battle Against Ganon"),
    new SceneDesc("ganon_final", "Ganondorf's Death"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
