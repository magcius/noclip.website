
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as NARC from '../nns_g3d/narc';

import * as BYML from '../byml';
import * as LZ77 from './lz77';
import * as BMD from './sm64ds_bmd';
import * as BCA from './sm64ds_bca';

import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { NITROTextureHolder, BMDData, Sm64DSCRG1, BMDModelInstance, SM64DSPass, CRG1Level, CRG1Object, NITRO_Program } from './render';
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { vec3, mat4, mat2d } from 'gl-matrix';
import { assertExists, assert, leftPad } from '../util';
import AnimationController from '../AnimationController';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { SceneContext } from '../SceneBase';
import { DataFetcher } from '../DataFetcher';

// https://github.com/Arisotura/SM64DSe/blob/master/obj_list.txt
enum ObjectId {
    PLAYER = 0x00,
    EWB_ICE_A = 0x01,
    EWB_ICE_B = 0x02,
    EWB_ICE_C = 0x03,
    EWM_ICE_BLOCK = 0x04,
    EMM_LOG = 0x05,
    EMM_YUKA = 0x06,
    UPDOWN_LIFT = 0x07,
    HS_UPDOWN_LIFT = 0x08,
    PATH_LIFT = 0x09,
    WANWAN = 0x0a,
    CAMERA_TAG = 0x0b,
    SEESAW = 0x0c,
    IRONBALL = 0x0d,
    GORO_ROCK = 0x0e,
    KURIBO = 0x0f,
    KURIBO_S = 0x10,
    KURIBO_L = 0x11,
    KURIKING = 0x12,
    BOMBHEI = 0x13,
    RED_BOMBHEI = 0x14,
    NOKONOKO = 0x15,
    NOKONOKO_S = 0x16,
    BLOCK_L = 0x17,
    DP_BLOCK_L = 0x18,
    SW_BLOCK_L = 0x19,
    POWER_UP_ITEM = 0x1a,
    HATENA_SWITCH = 0x1b,
    BLOCK_S = 0x1c,
    CANNON_SHUTTER = 0x1d,
    HATENA_BLOCK = 0x1e,
    ITEM_BLOCK = 0x1f,
    VS_ITEM_BLOCK = 0x20,
    CAP_BLOCK_M = 0x21,
    CAP_BLOCK_W = 0x22,
    CAP_BLOCK_L = 0x23,
    PILE = 0x24,
    COIN = 0x25,
    RED_COIN = 0x26,
    BLUE_COIN = 0x27,
    KOOPA = 0x28,
    TREE = 0x29,
    PICTURE_GATE = 0x2a,
    HANSWITCH = 0x2b,
    STAR_SWITCH = 0x2c,
    SWITCHDOOR = 0x2d,
    CV_SHUTTER = 0x2e,
    CV_NEWS_LIFT = 0x2f,
    WANWAN2 = 0x30,
    ONEUPKINOKO = 0x31,
    CANNON = 0x32,
    WANWAN_SHUTTER = 0x33,
    WATERBOMB = 0x34,
    SBIRD = 0x35,
    FISH = 0x36,
    BUTTERFLY = 0x37,
    BOMBKING = 0x38,
    SNOWMAN = 0x39,
    PIANO = 0x3a,
    PAKUN = 0x3b,
    STAR_CAMERA = 0x3c,
    STAR = 0x3d,
    SILVER_STAR = 0x3e,
    STARBASE = 0x3f,
    BATAN = 0x40,
    BATANKING = 0x41,
    DOSUN = 0x42,
    TERESA = 0x43,
    BOSS_TERESA = 0x44,
    ICON_TERESA = 0x45,
    KAIDAN = 0x46,
    BOOKSHELF = 0x47,
    MERRYGOROUND = 0x48,
    TERESAPIT = 0x49,
    PL_CLOSET = 0x4a,
    KANBAN = 0x4b,
    TATEFUDA = 0x4c,
    ICE_BOARD = 0x4d,
    WAKAME = 0x4e,
    HEART = 0x4f,
    KINOPIO = 0x50,
    PEACH_PRINCESS = 0x51,
    KOOPA2BG = 0x52,
    KOOPA3BG = 0x53,
    SHELL = 0x54,
    SHARK = 0x55,
    CT_MECHA01 = 0x56,
    CT_MECHA02 = 0x57,
    CT_MECHA03 = 0x58,
    CT_MECHA04L = 0x59,
    CT_MECHA04S = 0x5a,
    CT_MECHA05 = 0x5b,
    CT_MECHA06 = 0x5c,
    CT_MECHA07 = 0x5d,
    CT_MECHA08A = 0x5e,
    CT_MECHA08B = 0x5f,
    CT_MECHA09 = 0x60,
    CT_MECHA10 = 0x61,
    CT_MECHA11 = 0x62,
    CT_MECHA12L = 0x63,
    CT_MECHA12S = 0x64,
    DP_BROCK = 0x65,
    DP_LIFT = 0x66,
    DL_PYRAMID = 0x67,
    DL_PYRAMID_DUMMY = 0x68,
    WL_POLELIFT = 0x69,
    WL_SUBMARINE = 0x6a,
    WL_KOOPA_SHUTTER = 0x6b,
    RC_DORIFU = 0x6c,
    RC_RIFT01 = 0x6d,
    RC_HANE = 0x6e,
    RC_TIKUWA = 0x6f,
    RC_BURANKO = 0x70,
    RC_SEESAW = 0x71,
    RC_KAITEN = 0x72,
    RC_GURUGURU = 0x73,
    SL_ICEBLOCK = 0x74,
    HM_MARUTA = 0x75,
    TT_FUTA = 0x76,
    TT_WATER = 0x77,
    TD_FUTA = 0x78,
    TD_WATER = 0x79,
    WC_UKISIMA = 0x7a,
    WC_OBJ01 = 0x7b,
    WC_OBJ02 = 0x7c,
    WC_OBJ03 = 0x7d,
    WC_OBJ04 = 0x7e,
    WC_OBJ05 = 0x7f,
    WC_OBJ06 = 0x80,
    WC_MIZU = 0x81,
    FL_MARUTA = 0x82,
    FL_RING = 0x83,
    FL_GURA = 0x84,
    FL_LONDON = 0x85,
    FL_BLOCK = 0x86,
    FL_UKIYUKA = 0x87,
    FL_UKIYUKA_L = 0x88,
    FL_SEESAW = 0x89,
    FL_KOMA_D = 0x8a,
    FL_KOMA_U = 0x8b,
    FL_UKI_KI = 0x8c,
    FL_KUZURE = 0x8d,
    FM_BATTAN = 0x8e,
    LAVA = 0x8f,
    WATERFALL = 0x90,
    MANTA = 0x91,
    SPIDER = 0x92,
    TOGEZO = 0x93,
    JUGEM = 0x94,
    GAMAGUCHI = 0x95,
    EYEKUN = 0x96,
    EYEKUN_BOSS = 0x97,
    BATTA_BLOCK = 0x98,
    BIRIKYU = 0x99,
    HM_BASKET = 0x9a,
    MONKEY_THIEF = 0x9b,
    MONKEY_STAR = 0x9c,
    PENGUIN_BABY = 0x9d,
    PENGUIN_MOTHER = 0x9e,
    PENGUIN_DEFENDER = 0x9f,
    PENGUIN_RACER = 0xa0,
    KERONPA = 0xa1,
    BIG_SNOWMAN = 0xa2,
    BIG_SNOWMAN_HEAD = 0xa3,
    BIG_SNOWMAN_BODY = 0xa4,
    SNOWMAN_BREATH = 0xa5,
    PUKUPUKU = 0xa6,
    CLOCK_SHORT = 0xa7,
    CLOCK_LONG = 0xa8,
    CLOCK_HURIKO = 0xa9,
    MENBO = 0xaa,
    CASKET = 0xab,
    HYUHYU = 0xac,
    BOMB_SEESAW = 0xad,
    KM1_SEESAW = 0xae,
    KM1_DORIFU = 0xaf,
    KM1_UKISHIMA = 0xb0,
    KM1_KURUMAJIKU = 0xb1,
    KM1_DERU = 0xb2,
    KI_FUNE = 0xb3,
    KI_FUNE_UP = 0xb4,
    KI_HASIRA = 0xb5,
    KI_HASIRA_DAI = 0xb6,
    KI_ITA = 0xb7,
    KI_IWA = 0xb8,
    KS_MIZU = 0xb9,
    DOKAN = 0xba,
    YAJIRUSI_L = 0xbb,
    YAJIRUSI_R = 0xbc,
    PROPELLER_HEYHO = 0xbd,
    KILLER = 0xbe,
    KB1_BILLBOARD = 0xbf,
    HS_MOON = 0xc0,
    HS_STAR = 0xc1,
    HS_Y_STAR = 0xc2,
    HS_B_STAR = 0xc3,
    BK_BILLBOARD = 0xc4,
    BK_KILLER_DAI = 0xc5,
    BK_BOTAOSI = 0xc6,
    BK_DOWN_B = 0xc7,
    BK_FUTA = 0xc8,
    BK_KABE01 = 0xc9,
    BK_KABE00 = 0xca,
    BK_TOWER = 0xcb,
    BK_UKISIMA = 0xcc,
    BK_ROTEBAR = 0xcd,
    BK_LIFT01 = 0xce,
    BK_DOSSUNBAR_S = 0xcf,
    BK_DOSSUNBAR_L = 0xd0,
    BK_TRANSBAR = 0xd1,
    TH_DOWN_B = 0xd2,
    KM2_KUZURE = 0xd3,
    KM2_AGARU = 0xd4,
    KM2_GURA = 0xd5,
    KM2_AMI_BOU = 0xd6,
    KM2_YOKOSEESAW = 0xd7,
    KM2_SUSUMU = 0xd8,
    KM2_UKISHIMA = 0xd9,
    KM2_RIFUT02 = 0xda,
    KM2_RIFUT01 = 0xdb,
    KM2_NOBIRU = 0xdc,
    KM3_SEESAW = 0xdd,
    KM3_YOKOSEESAW = 0xde,
    KM3_KURUMAJIKU = 0xdf,
    KM3_DORIFU = 0xe0,
    KM3_DERU01 = 0xe1,
    KM3_DERU02 = 0xe2,
    KM3_KAITENDAI = 0xe3,
    C0_SWITCH = 0xe4,
    SM_LIFT = 0xe5,
    PROPELLER_HEYHO_FIRE = 0xe6,
    UDLIFT_TERESA = 0xe7,
    UDLIFT = 0xe8,
    RC_RIFT02 = 0xe9,
    BAKUBAKU = 0xea,
    KM3_LIFT = 0xeb,
    KIRAI = 0xec,
    MIP = 0xed,
    OBJ_MIP_KEY = 0xee,
    OWL = 0xef,
    DONKETU = 0xf0,
    BOSS_DONKETU = 0xf1,
    ONIMASU = 0xf2,
    BAR = 0xf3,
    C_JUGEM = 0xf4,
    PUSHBLOCK = 0xf5,
    FL_AMILIFT = 0xf6,
    YUREI_MUCHO = 0xf7,
    CHOROPU = 0xf8,
    CHORO_ROCK = 0xf9,
    BASABASA = 0xfa,
    POPOI = 0xfb,
    JANGO = 0xfc,
    SANBO = 0xfd,
    OBJ_MARIO_CAP = 0xfe,
    FL_PUZZLE = 0xff,
    FL_COIN = 0x100,
    DOSSY = 0x101,
    DOSSY_CAP = 0x102,
    HUWAHUWA = 0x103,
    SLIDE_BOX = 0x104,
    MORAY = 0x105,
    OBJ_KUMO = 0x106,
    OBJ_SHELL = 0x107,
    OBJ_RED_FIRE = 0x108,
    OBJ_BLUE_FIRE = 0x109,
    OBJ_FLAMETHROWER = 0x10a,
    KINOKO_CREATE_TAG = 0x10b,
    KINOKO_TAG = 0x10c,
    BLK_OKINOKO_TAG = 0x10d,
    BLK_SKINOKO_TAG = 0x10e,
    BLK_GNSHELL_TAG = 0x10f,
    BLK_SLVSTAR_TAG = 0x110,
    C1_TRAP = 0x111,
    C1_HIKARI = 0x112,
    C1_PEACH = 0x113,
    RC_CARPET = 0x114,
    OBJ_KEY = 0x115,
    LAST_STAR = 0x116,
    IWANTE = 0x117,
    HANACHAN = 0x118,
    RACE_NOKO = 0x119,
    RACE_FLAG = 0x11a,
    T_BASKET = 0x11b,
    BLOCK_LL = 0x11c,
    ICE_BLOCK_LL = 0x11d,
    SHOOT_BOOK = 0x11e,
    KILLER_BOOK = 0x11f,
    BOOK_GENERATOR = 0x120,
    BOOK_SWITCH = 0x121,
    ICE_DONKETU = 0x122,
    KING_DONKETU = 0x123,
    TREASURE_BOX = 0x124,
    MC_WATER = 0x125,
    CHAIR = 0x126,
    MC_METALNET = 0x127,
    MC_DODAI = 0x128,
    MC_HAZAD = 0x129,
    MC_FLAG = 0x12a,
    DONKAKU = 0x12b,
    DONGURU = 0x12c,
    HOLHEI = 0x12d,
    SCALEUP_KINOKO = 0x12e,
    C0_WATER = 0x12f,
    SECRET_COIN = 0x130,
    BC_SWITCH = 0x131,
    OBJ_NUMBER = 0x132,
    BUBBLE = 0x133,
    STAR_CREATE = 0x134,
    SLIDER_MANAGER = 0x135,
    OBJ_VOLCANO_CANNON = 0x136,
    WATER_RING = 0x137,
    FIREPAKUN = 0x138,
    FIREPAKUN_S = 0x139,
    PAKUN2 = 0x13a,
    ENEMY_SWITCH = 0x13b,
    ENEMY_CREATE = 0x13c,
    WATER_HAKIDASI = 0x13d,
    WATER_TATUMAKI = 0x13e,
    WATER_SUIKOMI = 0x13f,
    TORNADO = 0x140,
    FIRERING = 0x141,
    LUIGI = 0x142,
    SET_SE = 0x143,
    MUGEN_BGM = 0x144,
    SOUND_OBJ = 0x145,

    // Unofficial names
    TRG_MINIMAP_CHANGE = 0x1ff,
}

const GLOBAL_SCALE = 1500;

const pathBase = `sm64ds`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private modelCache = new Map<string, BMDData>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    public mountNARC(narc: NARC.NitroFS): void {
        for (let i = 0; i < narc.files.length; i++) {
            const file = narc.files[i];
            this.fileDataCache.set(file.path, file.buffer);
        }
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        assert(path.startsWith('/data'));
        const p = this.dataFetcher.fetchData(`${pathBase}${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string): Promise<ArrayBufferSlice> {
        const d = this.fileDataCache.get(path);
        if (d !== undefined) {
            return Promise.resolve(d);
        }

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

    public getModel(device: GfxDevice, modelPath: string): BMDData {
        let p = this.modelCache.get(modelPath);

        if (p === undefined) {
            const buffer = assertExists(this.fileDataCache.get(modelPath));
            const result = LZ77.maybeDecompress(buffer);
            const bmd = BMD.parse(result);
            p = new BMDData(device, bmd);
            this.modelCache.set(modelPath, p);
        }

        return p;
    }

    public async fetchModel(device: GfxDevice, filename: string): Promise<BMDData> {
        await this.fetchFileData(filename);
        return this.getModel(device, filename);
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.modelCache.values())
            model.destroy(device);
    }
}

interface Animation {
    updateModelMatrix(time: number, modelMatrix: mat4): void;
}

class ObjectRenderer {
    public animationController = new AnimationController();
    public animation: Animation | null = null;
    public modelMatrix = mat4.create();

    constructor(public modelInstance: BMDModelInstance) {
    }

    public calcAnim(viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeFromViewerInput(viewerInput);

        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        if (this.animation !== null)
            this.animation.updateModelMatrix(viewerInput.time, this.modelInstance.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.calcAnim(viewerInput);

        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 1 },
];
class SM64DSRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public objectRenderers: ObjectRenderer[] = [];
    public bmdRenderers: BMDModelInstance[] = [];
    public animationController = new AnimationController();

    private uniformBuffer: GfxRenderDynamicUniformBuffer;
    private renderInstManager = new GfxRenderInstManager();

    constructor(device: GfxDevice, public modelCache: ModelCache, public textureHolder: NITROTextureHolder) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.bmdRenderers.length; i++)
                this.bmdRenderers[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.bmdRenderers.length; i++)
                this.bmdRenderers[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeFromViewerInput(viewerInput);

        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.bmdRenderers.length; i++)
            this.bmdRenderers[i].prepareToRender(device, this.renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(device, this.renderInstManager, viewerInput);

        this.renderInstManager.popTemplateRenderInst();

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(SM64DSPass.SKYBOX);
        this.renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(SM64DSPass.MAIN);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderInstManager.destroy(device);
        this.uniformBuffer.destroy(device);
        this.renderTarget.destroy(device);
        this.textureHolder.destroy(device);

        this.modelCache.destroy(device);
        for (let i = 0; i < this.bmdRenderers.length; i++)
            this.bmdRenderers[i].destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class YSpinAnimation {
    constructor(public speed: number, public phase: number) {}

    public updateNormalMatrix(time: number, normalMatrix: mat4) {
        const theta = this.phase + (time / 30 * this.speed);
        mat4.rotateY(normalMatrix, normalMatrix, theta);
    }

    public updateModelMatrix(time: number, modelMatrix: mat4) {
        this.updateNormalMatrix(time, modelMatrix);
    }
}

export class SM64DSSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public levelId: number, public name: string) {
        this.id = '' + this.levelId;
    }

    private async _createBMDRenderer(device: GfxDevice, renderer: SM64DSRenderer, filename: string, scale: number, level: CRG1Level, isSkybox: boolean): Promise<BMDModelInstance> {
        const modelCache = renderer.modelCache;
        const bmdData = await modelCache.fetchModel(device, filename);
        const bmdRenderer = new BMDModelInstance(device, renderer.textureHolder, bmdData, level);
        mat4.scale(bmdRenderer.modelMatrix, bmdRenderer.modelMatrix, [scale, scale, scale]);
        bmdRenderer.isSkybox = isSkybox;
        renderer.bmdRenderers.push(bmdRenderer);
        return bmdRenderer;
    }

    private _createObjectRenderer(device: GfxDevice, renderer: SM64DSRenderer, bmdData: BMDData, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): ObjectRenderer {
        const modelInstance = new BMDModelInstance(device, renderer.textureHolder, bmdData);
        const objectRenderer = new ObjectRenderer(modelInstance);

        vec3.scale(translation, translation, GLOBAL_SCALE);
        mat4.translate(objectRenderer.modelMatrix, objectRenderer.modelMatrix, translation);
        mat4.rotateY(objectRenderer.modelMatrix, objectRenderer.modelMatrix, rotationY);

        // Don't ask, ugh.
        scale = scale * (GLOBAL_SCALE / 100);
        mat4.scale(objectRenderer.modelMatrix, objectRenderer.modelMatrix, [scale, scale, scale]);

        if (spinSpeed > 0)
            objectRenderer.animation = new YSpinAnimation(spinSpeed, 0);

        renderer.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    private async _createBMDObjRenderer(device: GfxDevice, renderer: SM64DSRenderer, filename: string, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): Promise<ObjectRenderer> {
        const modelCache = renderer.modelCache;
        const bmdData = await modelCache.fetchModel(device, filename);
        const b = this._createObjectRenderer(device, renderer, bmdData, translation, rotationY, scale, spinSpeed);
        b.modelInstance.name = filename;
        return b;
    }

    private async _createBMDRendererForObject(device: GfxDevice, renderer: SM64DSRenderer, object: CRG1Object): Promise<void> {
        const translation = vec3.fromValues(object.Position.X, object.Position.Y, object.Position.Z);
        const rotationY = object.Rotation.Y / 180 * Math.PI;

        const spawnObject = (filename: string, scale: number = 0.8, spinSpeed: number = 0) => {
            return this._createBMDObjRenderer(device, renderer, filename, translation, rotationY, scale, spinSpeed);
        };

        const bindBCA = async (b: ObjectRenderer, filename: string) => {
            const data = await renderer.modelCache.fetchFileData(filename);
            const bca = BCA.parse(LZ77.maybeDecompress(data));
            bca.loopMode = BCA.LoopMode.REPEAT;
            b.animationController.phaseFrames += Math.random() * bca.duration;
            b.modelInstance.bindBCA(b.animationController, bca);
        }

        const objectId: ObjectId = object.ObjectId;
        if (objectId === ObjectId.UPDOWN_LIFT) {
            const b = await spawnObject(`/data/normal_obj/obj_updnlift/obj_updnlift.bmd`);
        } else if (objectId === ObjectId.IRONBALL) {
            const b = await spawnObject(`/data/enemy/iron_ball/iron_ball.bmd`);
        } else if (objectId === ObjectId.KURIBO) {
            const b = await spawnObject(`/data/enemy/kuribo/kuribo_model.bmd`);
            await bindBCA(b, `/data/enemy/kuribo/kuribo_wait.bca`);
        } else if (objectId === ObjectId.KURIBO_S) {
            const b = await spawnObject(`/data/enemy/kuribo/kuribo_model.bmd`, 0.2);
            await bindBCA(b, `/data/enemy/kuribo/kuribo_wait.bca`);
        } else if (objectId === ObjectId.KURIBO_L) {
            const b = await spawnObject(`/data/enemy/kuribo/kuribo_model.bmd`, 1.6);
            await bindBCA(b, `/data/enemy/kuribo/kuribo_wait.bca`);
        } else if (objectId === ObjectId.BOMBHEI) {
            const b = await spawnObject(`/data/enemy/bombhei/bombhei.bmd`);
            await bindBCA(b, `/data/enemy/bombhei/bombhei_walk.bca`);
        } else if (objectId === ObjectId.RED_BOMBHEI) {
            const b = await spawnObject(`/data/enemy/bombhei/red_bombhei.bmd`);
            await bindBCA(b, `/data/enemy/bombhei/red_wait.bca`);
        } else if (objectId === ObjectId.BLOCK_L) {
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_l.bmd`);
        } else if (objectId === ObjectId.CANNON_SHUTTER) {
            const b = await spawnObject(`/data/normal_obj/obj_cannon_shutter/cannon_shutter.bmd`);
        } else if (objectId === ObjectId.HATENA_BLOCK) {
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/hatena_box.bmd`);
        } else if (objectId === ObjectId.PILE) {
            const b = await spawnObject(`/data/normal_obj/obj_pile/pile.bmd`);
        } else if (objectId === ObjectId.COIN) {
            const b = await spawnObject(`/data/normal_obj/coin/coin_poly32.bmd`, 0.7, 0.1);
        } else if (objectId === ObjectId.RED_COIN) {
            const b = await spawnObject(`/data/normal_obj/coin/coin_red_poly32.bmd`, 0.7, 0.1);
        } else if (objectId === ObjectId.BLUE_COIN) {
            const b = await spawnObject(`/data/normal_obj/coin/coin_blue_poly32.bmd`, 0.7, 0.1);
        } else if (objectId === ObjectId.TREE) {
            const treeType = (object.Parameters[0] >>> 4) & 0x07;
            const treeFilenames = ['bomb', 'toge', 'yuki', 'yashi', 'castle', 'castle', 'castle', 'castle'];
            const filename = `/data/normal_obj/tree/${treeFilenames[treeType]}_tree.bmd`;
            const b = await spawnObject(filename);
        } else if (objectId === ObjectId.PICTURE_GATE) { // Castle Painting
            const painting = (object.Parameters[0] >>> 8) & 0x1F;
            const filenames = [
                'for_bh', 'for_bk', 'for_ki', 'for_sm', 'for_cv_ex5', 'for_fl', 'for_dl', 'for_wl', 'for_sl', 'for_wc',
                'for_hm', 'for_hs', 'for_td_tt', 'for_ct', 'for_ex_mario', 'for_ex_luigi', 'for_ex_wario', 'for_vs_cross', 'for_vs_island',
            ];
            const filename = `/data/picture/${filenames[painting]}.bmd`;
            const scaleX = (object.Parameters[0] & 0xF)+1;
            const scaleY = ((object.Parameters[0] >> 4) & 0x0F) + 1;
            const rotationX = object.Parameters[1] / 0x7FFF * (Math.PI);
            const isMirrored = ((object.Parameters[0] >> 13) & 0x03) === 3;
            const b = await spawnObject(filename);
            mat4.rotateX(b.modelMatrix, b.modelMatrix, rotationX);
            mat4.scale(b.modelMatrix, b.modelMatrix, [scaleX, scaleY, 1]);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 100/16, 0]);
            if (isMirrored) {
                b.modelInstance.extraTexCoordMat = mat2d.create();
                b.modelInstance.extraTexCoordMat[0] *= -1;
            }
        } else if (objectId === ObjectId.HANSWITCH) {
            const b = await spawnObject(`/data/normal_obj/obj_box_switch/obj_box_switch.bmd`);
        } else if (objectId === ObjectId.SWITCHDOOR) {
            const b = await spawnObject(`/data/special_obj/b_ana_shutter/b_ana_shutter.bmd`);
        } else if (objectId === ObjectId.ONEUPKINOKO) {
            const b = await spawnObject(`/data/normal_obj/oneup_kinoko/oneup_kinoko.bmd`);
        } else if (objectId === ObjectId.CANNON) {
            const b = await spawnObject(`/data/normal_obj/obj_cannon/houdai.bmd`);
        } else if (objectId === ObjectId.BOMBKING) {
            const b = await spawnObject(`/data/enemy/bombking/bomb_king.bmd`);
            await bindBCA(b, `/data/enemy/bombking/bombking_wait1.bca`);
        } else if (objectId === ObjectId.STAR_CAMERA) { // Star Camera Path
            return null;
        } else if (objectId === ObjectId.STAR) { // Star Target
            return null;
        } else if (objectId === ObjectId.SILVER_STAR) { // Silver Star
            const b = await spawnObject(`/data/normal_obj/star/obj_star_silver.bmd`, 0.08);
        } else if (objectId === ObjectId.STARBASE) { // Star
            let filename = `/data/normal_obj/star/obj_star.bmd`;
            let startype = (object.Parameters[0] >>> 4) & 0x0F;
            let rotateSpeed = 0.08;
            switch (startype) {
            case 0:
                filename = `/data/normal_obj/star/star_base.bmd`;
                break;
            case 1:
            case 4:
            case 6:
                filename = `/data/normal_obj/star_box/star_box.bmd`;
                rotateSpeed = 0;
                break;
            }
            const b = await spawnObject(filename, 0.8, rotateSpeed);
        } else if (objectId === ObjectId.PL_CLOSET) { // Minigame Cabinet Trigger (Invisible)
            // Invisible
        } else if (objectId === ObjectId.KANBAN) {
            const b = await spawnObject(`/data/normal_obj/obj_kanban/obj_kanban.bmd`);
        } else if (objectId === ObjectId.TATEFUDA) {
            const b = await spawnObject(`/data/normal_obj/obj_tatefuda/obj_tatefuda.bmd`);
        } else if (objectId === ObjectId.HEART) {
            const b = await spawnObject(`/data/normal_obj/obj_heart/obj_heart.bmd`, 0.8, 0.05);
        } else if (objectId === ObjectId.BOMB_SEESAW) {
            const b = await spawnObject(`/data/special_obj/b_si_so/b_si_so.bmd`);
        } else if (objectId === ObjectId.YAJIRUSI_L) {
            const b = await spawnObject(`/data/normal_obj/obj_yajirusi_l/yajirusi_l.bmd`);
        } else if (objectId === ObjectId.YAJIRUSI_R) {
            const b = await spawnObject(`/data/normal_obj/obj_yajirusi_r/yajirusi_r.bmd`);
        } else if (objectId === ObjectId.BK_UKISIMA) {
            const b = await spawnObject(`/data/special_obj/bk_ukisima/bk_ukisima.bmd`, 1, 0.05);
        } else if (objectId === ObjectId.BLK_SKINOKO_TAG) {
            // Invisible
        } else if (objectId === ObjectId.RACE_NOKO) {
            const b = await spawnObject(`/data/enemy/nokonoko/nokonoko.bmd`, 1);
            await bindBCA(b, '/data/enemy/nokonoko/nokonoko_wait1.bca');
        } else if (objectId === ObjectId.BLOCK_LL) {
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_l.bmd`, 1.2);
        } else if (objectId === ObjectId.MC_WATER) {
            const b = await spawnObject(`/data/special_obj/mc_water/mc_water.bmd`);
        } else if (objectId === ObjectId.MC_METALNET) {
            const b = await spawnObject(`/data/special_obj/mc_metalnet/mc_metalnet.bmd`);
        } else if (objectId === ObjectId.MC_FLAG) {
            const b = await spawnObject(`/data/special_obj/mc_flag/mc_flag.bmd`);
        } else if (objectId === ObjectId.BC_SWITCH) {
            const b = await spawnObject(`/data/normal_obj/b_coin_switch/b_coin_switch.bmd`);
        } else if (objectId === ObjectId.ENEMY_SWITCH) {
            // Invisible
        } else if (objectId === ObjectId.ENEMY_CREATE) {
            // Invisible
        } else if (objectId === ObjectId.SET_SE) {
            // Invisible
        } else if (objectId === ObjectId.MUGEN_BGM) {
            // Invisible
        } else if (objectId === ObjectId.TRG_MINIMAP_CHANGE) {
            // Invisible
        } else {
            console.warn(`Unknown object type ${object.ObjectId} / ${ObjectId[object.ObjectId]}`);
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const [crg1Buffer, ... narcBuffers] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/sm64ds.crg1`),
            dataFetcher.fetchData(`${pathBase}/ARCHIVE/ar1.narc`),
            dataFetcher.fetchData(`${pathBase}/ARCHIVE/arc0.narc`),
            dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs1.narc`),
            dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs2.narc`),
            dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs3.narc`),
            dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs4.narc`),
        ]);

        const modelCache = new ModelCache(dataFetcher);

        for (let i = 0; i < narcBuffers.length; i++)
            modelCache.mountNARC(NARC.parse(narcBuffers[i]));

        const crg1 = BYML.parse<Sm64DSCRG1>(crg1Buffer, BYML.FileType.CRG1);
        const level = crg1.Levels[this.levelId];

        const textureHolder = new NITROTextureHolder();
        const renderer = new SM64DSRenderer(device, modelCache, textureHolder);
        context.destroyablePool.push(renderer);

        this._createBMDRenderer(device, renderer, level.MapBmdFile, GLOBAL_SCALE, level, false);

        if (level.Background) {
            const vrbox = `/data/vrbox/vr${leftPad('' + level.Background, 2, '0')}.bmd`;
            this._createBMDRenderer(device, renderer, vrbox, 0.8, level, true);
        }

        for (let i = 0; i < level.Objects.length; i++)
            this._createBMDRendererForObject(device, renderer, level.Objects[i]);

        await modelCache.waitForLoad();

        return renderer;
    }
}

const id = "sm64ds";
const name = "Super Mario 64 DS";
const sceneDescs = [
    "Princess Peach's Castle",
    new SM64DSSceneDesc(1, "Outdoor Gardens"),
    new SM64DSSceneDesc(2, "Main Foyer"),
    new SM64DSSceneDesc(4, "Basement"),
    new SM64DSSceneDesc(5, "Upstairs"),
    new SM64DSSceneDesc(3, "Courtyard"),
    new SM64DSSceneDesc(50, "Playroom"),
    "Levels",
    new SM64DSSceneDesc(6, 'Bob-omb Battlefield'),
    new SM64DSSceneDesc(7, "Whomp's Fortress"),
    new SM64DSSceneDesc(8, 'Jolly Roger Bay'),
    new SM64DSSceneDesc(9, 'Jolly Roger Bay - Inside the Ship'),
    new SM64DSSceneDesc(10, 'Cool, Cool Mountain'),
    new SM64DSSceneDesc(11, 'Cool, Cool Mountain - Inside the Slide'),
    new SM64DSSceneDesc(12, "Big Boo's Haunt"),
    new SM64DSSceneDesc(13, 'Hazy Maze Cave'),
    new SM64DSSceneDesc(14, 'Lethal Lava Land'),
    new SM64DSSceneDesc(15, 'Lethal Lava Land - Inside the Volcano'),
    new SM64DSSceneDesc(16, 'Shifting Sand Land'),
    new SM64DSSceneDesc(17, 'Shifting Sand Land - Inside the Pyramid'),
    new SM64DSSceneDesc(18, 'Dire, Dire Docks'),
    new SM64DSSceneDesc(19, "Snowman's Land"),
    new SM64DSSceneDesc(20, "Snowman's Land - Inside the Igloo"),
    new SM64DSSceneDesc(21, 'Wet-Dry World'),
    new SM64DSSceneDesc(22, 'Tall Tall Mountain'),
    new SM64DSSceneDesc(23, 'Tall Tall Mountain - Inside the Slide'),
    new SM64DSSceneDesc(25, 'Tiny-Huge Island - Tiny'),
    new SM64DSSceneDesc(24, 'Tiny-Huge Island - Huge'),
    new SM64DSSceneDesc(26, "Tiny-Huge Island - Inside Wiggler's Cavern"),
    new SM64DSSceneDesc(27, 'Tick Tock Clock'),
    new SM64DSSceneDesc(28, 'Rainbow Ride'),
    "Bowser Levels",
    new SM64DSSceneDesc(35, 'Bowser in the Dark World'),
    new SM64DSSceneDesc(36, 'Bowser in the Dark World - Boss Arena'),
    new SM64DSSceneDesc(37, 'Bowser in the Fire Sea'),
    new SM64DSSceneDesc(38, 'Bowser in the Fire Sea - Boss Arena'),
    new SM64DSSceneDesc(39, 'Bowser in the Sky'),
    new SM64DSSceneDesc(40, 'Bowser in the Sky - Boss Arena'),
    "Secret Levels",
    new SM64DSSceneDesc(29, 'The Princess\'s Secret Slide'),
    new SM64DSSceneDesc(30, 'The Secret Aquarium'),
    new SM64DSSceneDesc(34, 'Wing Mario over the Rainbow'),
    new SM64DSSceneDesc(31, 'Tower of the Wing Cap'),
    new SM64DSSceneDesc(32, 'Vanish Cap Under the Moat'),
    new SM64DSSceneDesc(33, 'Cavern of the Metal Cap'),
    "Extra DS Levels",
    new SM64DSSceneDesc(46, 'Big Boo Battle'),
    new SM64DSSceneDesc(47, 'Big Boo Battle - Boss Arena'),
    new SM64DSSceneDesc(44, 'Goomboss Battle'),
    new SM64DSSceneDesc(45, 'Goomboss Battle - Boss Arena'),
    new SM64DSSceneDesc(48, 'Chief Chilly Challenge'),
    new SM64DSSceneDesc(49, 'Chief Chilly Challenge - Boss Arena'),
    "VS Maps",
    new SM64DSSceneDesc(42, 'The Secret of Battle Fort'),
    new SM64DSSceneDesc(43, 'Sunshine Isles'),
    new SM64DSSceneDesc(51, 'Castle Gardens'),
    "Unused Test Maps",
    new SM64DSSceneDesc(0,  'Test Map A'),
    new SM64DSSceneDesc(41, 'Test Map B'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
