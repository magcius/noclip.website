
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as ZAR from './zar';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { RoomRenderer, CtrTextureHolder, BasicRendererHelper, CmbRenderer, CmbData } from './render';
import { SceneGroup } from '../viewer';
import { assert, assertExists, hexzero } from '../util';
import { fetchData } from '../fetch';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { RENDER_HACKS_ICON } from '../bk/scenes';
import { mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { TransparentBlack, colorNew, White } from '../Color';

class OoT3DRenderer extends BasicRendererHelper implements Viewer.SceneGfx {
    public roomRenderers: RoomRenderer[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public modelCache: ModelCache) {
        super();
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].addToViewRenderer(device, this.viewRenderer);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.roomRenderers.length; i++)
            this.roomRenderers[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        
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

        const enableUV = new UI.Checkbox('Enable UV', false);
        enableUV.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setUVEnabled(enableUV.checked);
        };
        renderHacksPanel.contents.appendChild(enableUV.elem);

        const layersPanel = new UI.LayerPanel(this.roomRenderers);
        return [renderHacksPanel, layersPanel];
    }
}

const pathBase = `oot3d`;

class ModelCache {
    private fileProgressableCache = new Map<string, Progressable<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private archiveProgressableCache = new Map<string, Progressable<ZAR.ZAR>>();
    private archiveCache = new Map<string, ZAR.ZAR>();
    private modelCache = new Map<string, CmbData>();

    public waitForLoad(): Progressable<any> {
        const v: Progressable<any>[] = [... this.fileProgressableCache.values(), ... this.archiveProgressableCache.values()];
        return Progressable.all(v);
    }

    private fetchFile(path: string, abortSignal: AbortSignal): Progressable<ArrayBufferSlice> {
        assert(!this.fileProgressableCache.has(path));
        const p = fetchData(path, abortSignal);
        this.fileProgressableCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string, abortSignal: AbortSignal): Progressable<ArrayBufferSlice> {
        const p = this.fileProgressableCache.get(path);
        if (p !== undefined) {
            return p.then(() => this.getFileData(path));
        } else {
            return this.fetchFile(path, abortSignal).then((data) => {
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

    public fetchArchive(archivePath: string, abortSignal: AbortSignal): Progressable<ZAR.ZAR> {
        let p = this.archiveProgressableCache.get(archivePath);
        if (p === undefined) {
            p = this.fetchFileData(archivePath, abortSignal).then((data) => {
                return data;
            }).then((data) => {
                const arc = ZAR.parse(data);
                this.archiveCache.set(archivePath, arc);
                return arc;
            });
            this.archiveProgressableCache.set(archivePath, p);
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

const enum ActorId {
    En_Test                = 0x0002,
    En_Box                 = 0x000A,
    En_Okuta               = 0x000E,
    Bg_Ydan_Sp             = 0x000F,
    En_Wallmas             = 0x0011,
    En_Dodongo             = 0x0012,
    En_Item00              = 0x0015,
    En_Niw                 = 0x0019,
    Boss_Goma              = 0x0028,
    En_Zf                  = 0x0025,
    En_Hata                = 0x0026,
    Boss_Dodongo           = 0x0027,
    En_Dodojr              = 0x002F,
    En_St                  = 0x0037,
    En_River_Sound         = 0x003B,
    En_Horse_Normal        = 0x003C,
    En_Ossan               = 0x003D,
    Bg_Dodoago             = 0x003F,
    En_Bombf               = 0x004C,
    Bg_Ydan_Hasi           = 0x0050,
    Bg_Ydan_Maruta         = 0x0051,
    En_Am                  = 0x0054,
    En_Dekubaba            = 0x0055,
    Bg_Ddan_Jd             = 0x0058,
    Bg_Breakwall           = 0x0059,
    Bg_Ddan_Kd             = 0x005C,
    Door_Warp1             = 0x005D,
    Obj_Syokudai           = 0x005E,
    En_Dekunuts            = 0x0060,
    Bg_Mizu_Movebg         = 0x0064,
    Bg_Mori_Hineri         = 0x0068,
    En_Bb                  = 0x0069,
    Bg_Mjin                = 0x006E,
    En_Wood02              = 0x0077,
    En_Trap                = 0x0080,
    En_Ta                  = 0x0084,
    Bg_Mori_Bigst          = 0x0086,
    Bg_Mori_Elevator       = 0x0087,
    Bg_Mori_Kaitenkabe     = 0x0088,
    Bg_Mori_Rakkatenjo     = 0x0089,
    En_Vm                  = 0x008A,
    En_Floormas            = 0x008E,
    En_Heishi1             = 0x008F,
    En_Sw                  = 0x0095,
    En_Du                  = 0x0098,
    Door_Ana               = 0x009B,
    Demo_Du                = 0x00A8,
    Demo_Im                = 0x00A9,
    En_Heishi2             = 0x00B3,
    En_Brob                = 0x00B6,
    En_Tana                = 0x00C2,
    En_Nb                  = 0x00C3,
    Bg_Bdan_Objects        = 0x00C8,
    Demo_Sa                = 0x00C9,
    En_In                  = 0x00CB,
    En_Ru2                 = 0x00D2,
    En_Ma2                 = 0x00D9,
    Bg_Mori_Hashira4       = 0x00E3,
    Bg_Mori_Idomizu        = 0x00E4,
    Bg_Spot16_Doughnut     = 0x00E5,
    Bg_Bdan_Switch         = 0x00E6,
    En_Ma1                 = 0x00E7,
    Fishing                = 0x00FE,
    Obj_Oshihiki           = 0x00FF,
    Bg_Spot01_Fusya        = 0x0102,
    Bg_Spot01_Idohashira   = 0x0103,
    Bg_Spot01_Idomizu      = 0x0104,
    Bg_Po_Syokudai         = 0x0105,
    Obj_Tsubo              = 0x0111,
    En_Wonder_Item         = 0x0112,
    En_Skj                 = 0x0115,
    Elf_Msg                = 0x011B,
    En_Kusa                = 0x0125,
    Obj_Bombiwa            = 0x0127,
    Obj_Switch             = 0x012A,
    Obj_Hsblock            = 0x012D,
    En_Goroiwa             = 0x0130,
    En_Toryo               = 0x0132,
    En_Blkobj              = 0x0136,
    En_Niw_Lady            = 0x013C,
    En_Kanban              = 0x0141,
    En_Heishi3             = 0x0142,
    En_Sa                  = 0x0146,
    En_Wonder_Talk         = 0x0147,
    En_Ds                  = 0x0149,
    En_Mk                  = 0x014A,
    En_Owl                 = 0x014D,
    Bg_Spot18_Basket       = 0x015C,
    En_Siofuki             = 0x015F,
    En_Ko                  = 0x0163,
    En_Ani                 = 0x0167,
    En_Hy                  = 0x016E,
    Elf_Msg2               = 0x0173,
    En_Heishi4             = 0x0178,
    En_Wonder_Talk2        = 0x0185,
    Bg_Spot05_Soko         = 0x018D,
    En_Hintnuts            = 0x0192,
    En_Shopnuts            = 0x0195,
    En_Niw_Girl            = 0x019A,
    En_Dog                 = 0x019B,
    Bg_Spot01_Objects2     = 0x019D,
    Obj_Kibako2            = 0x01A0,
    En_Tg                  = 0x01AC,
    En_Mu                  = 0x01AD,
    En_Wf                  = 0x01AF,
    En_Gs                  = 0x01B9,
    En_Daiku_Kakariko      = 0x01BC,
    En_Crow                = 0x01C0,
    Bg_Spot18_Shutter      = 0x01C4,
    En_Cow                 = 0x01C6,
    En_Zo                  = 0x01CE,
    Obj_Timeblock          = 0x01D1,
    En_Zl4                 = 0x01D3,
};

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

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public setupIndex: number = -1) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        // Fetch the ZAR & info ZSI.
        const path_zar = `${pathBase}/scene/${this.id}.zar`;
        const path_info_zsi = `${pathBase}/scene/${this.id}_info.zsi`;
        return Progressable.all([fetchData(path_zar, abortSignal), fetchData(path_info_zsi, abortSignal)]).then(([zar, zsi]) => {
            return this.createSceneFromData(device, abortSignal, zar, zsi);
        });
    }

    private spawnActorForRoom(device: GfxDevice, abortSignal: AbortSignal, scene: Scene, renderer: OoT3DRenderer, roomRenderer: RoomRenderer, environmentSettings: ZSI.ZSIEnvironmentSettings, actor: ZSI.Actor, j: number): void {
        function fetchArchive(archivePath: string): Progressable<ZAR.ZAR> { 
            return renderer.modelCache.fetchArchive(`${pathBase}/actor/${archivePath}`, abortSignal);
        }

        function buildModel(zar: ZAR.ZAR, modelPath: string, scale: number = 0.01): CmbRenderer {
            const cmbData = renderer.modelCache.getModel(device, renderer, zar, modelPath);
            const cmbRenderer = new CmbRenderer(device, renderer.textureHolder, cmbData);
            cmbRenderer.animationController.fps = 20;
            cmbRenderer.setConstantColor(1, TransparentBlack);
            cmbRenderer.name = `${hexzero(actor.actorId, 4)} / ${hexzero(actor.variable, 4)} / ${modelPath}`;
            mat4.scale(cmbRenderer.modelMatrix, actor.modelMatrix, [scale, scale, scale]);
            cmbRenderer.addToViewRenderer(device, renderer.viewRenderer);
            cmbRenderer.setEnvironmentSettings(environmentSettings);
            roomRenderer.objectRenderers.push(cmbRenderer);
            return cmbRenderer;
        }

        function parseCSAB(zar: ZAR.ZAR, filename: string) { return CSAB.parse(CMB.Version.Ocarina, assertExists(ZAR.findFileData(zar, filename))); }
        function parseCMAB(zar: ZAR.ZAR, filename: string) { return CMAB.parse(CMB.Version.Ocarina, assertExists(ZAR.findFileData(zar, filename))); }
        function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

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
        else if (actor.actorId === ActorId.Bg_Spot16_Doughnut) fetchArchive(`zelda_efc_doughnut.zar`).then((zar) => {
            const b = buildModel(zar, `model/doughnut_aya_modelT.cmb`, 0.1);
            b.bindCMAB(parseCMAB(zar, `misc/doughnut_aya_modelT.cmab`));
        });
        else if (actor.actorId === ActorId.Obj_Bombiwa) fetchArchive(`zelda_bombiwa.zar`).then((zar) => buildModel(zar, `model/obj_18b_stone_model.cmb`, 0.1));
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
        else if (actor.actorId === ActorId.Bg_Mori_Idomizu) fetchArchive(`zelda_mori_objects.zar`).then((zar) => {
            const b = buildModel(zar, `model/l_idomizu_modelT.cmb`, 1);
            b.bindCMAB(parseCMAB(zar, `misc/l_idomizu_modelT.cmab`));
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
            // the flag model only shows two red flags, but in noclip it is two red and a blue that comes from nowhere?
            // its not in the model and not in the actor list
            const b = buildModel(zar, `model/ht_hata.cmb`); // hyrule castle flag
            b.bindCSAB(parseCSAB(zar, `anim/ht_hata.csab`));
        });
        else if (actor.actorId === ActorId.En_Wood02) fetchArchive(`zelda_wood02.zar`).then((zar) => {
            const whichModel = actor.variable & 0x00FF;
            // TODO(jstpierre): Why don't these tree models display correctly?
            if (whichModel === 0x02) { // "Small Tree"
                buildModel(zar, `model/tree03_model.cmb`, 0.5);
            } else {
                console.log(`Unknown Wood02 model ${whichModel}`);
            }
        });
        // NPCs.
        else if (actor.actorId === ActorId.En_Ko) fetchArchive(`zelda_kw1.zar`).then((zar) => {
            const b = buildModel(zar, `model/kokiripeople.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/fad_n_wait.csab`));
            b.setVertexColorScale(characterLightScale);

            const enum Gender { BOY, GIRL };
            function setGender(gender: Gender) {
                b.shapeInstances[2].visible = gender === Gender.GIRL;
                b.shapeInstances[3].visible = gender === Gender.GIRL;
                b.shapeInstances[4].visible = gender === Gender.GIRL;
                b.shapeInstances[5].visible = gender === Gender.BOY;
                b.shapeInstances[6].visible = gender === Gender.BOY;
            }

            const whichNPC = actor.variable & 0xFF;

            if (whichNPC === 0x00) { // Standing boy.
                setGender(Gender.BOY);
            } else if (whichNPC === 0x01) { // Standing girl.
                setGender(Gender.GIRL);
            } else if (whichNPC === 0x02) { // Boxing boy.
                setGender(Gender.BOY);
            } else if (whichNPC === 0x03) { // Blocking boy.
                setGender(Gender.BOY);
            } else if (whichNPC === 0x04) { // Backflipping boy.
                setGender(Gender.BOY);
            } else if (whichNPC === 0x05) { // Sitting girl.
                setGender(Gender.GIRL);
            } else if (whichNPC === 0x06) { // Standing girl.
                setGender(Gender.GIRL);
            } else if (whichNPC === 0x07) { // Unknown -- in Know-it-All Brother's House.
                setGender(Gender.BOY);
            } else if (whichNPC === 0x08) { // Unknown -- in Know-it-All Brother's House.
                setGender(Gender.BOY);
            } else if (whichNPC === 0x0A) { // Unknown -- in Kokiri Shop.
                setGender(Gender.GIRL);
            } else if (whichNPC === 0x0B) { // Unknown -- in Know-it-All Brother's House.
                setGender(Gender.GIRL);
            } else if (whichNPC === 0x0C) { // Blonde girl.
                setGender(Gender.GIRL);
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.En_Ossan) {
            const whichShopkeeper = actor.variable & 0x0F;
            if (whichShopkeeper === 0x00) {        // Kokiri Shopkeeper
                fetchArchive(`zelda_km1.zar`).then((zar) => {
                    // need to also specify meshes, to turn off his hair
                    const b = buildModel(zar, `model/kokirimaster.cmb`);
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
                // TODO(jstpierre)
            } else if (whichShopkeeper === 0x04) { // Bazaar Shopkeeper
                // TODO(jstpierre)
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
            // Purple Royal Guards. They are without an animation as it causes them to spaghettify...
            const b = buildModel(zar, `model/soldier2.cmb`);
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
                });
            } else if (whichNPC === 0x08) { // "Thin woman in lilac"
                fetchArchive(`zelda_cne.zar`).then((zar) => {
                    const b = buildModel(zar, `model/hylialady.cmb`);
                    b.bindCSAB(parseCSAB(zar, `anim/cne_n_wait.csab`));
                    b.setVertexColorScale(characterLightScale);
                    b.setConstantColor(2, colorNew(0.62734, 0.70588, 1));
                    b.setConstantColor(3, colorNew(0.62734, 0.70588, 1));
                    b.setConstantColor(4, colorNew(0.62734, 0.70588, 1));
                    b.shapeInstances[4].visible = false;
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
        else if (actor.actorId === ActorId.En_Dekubaba) fetchArchive(`zelda_dekubaba.zar`).then((zar) => {
            // The Deku Baba lies in hiding...
            buildModel(zar, `model/db_ha_model.cmb`);
        });
        // Bosses
        else if (actor.actorId === ActorId.Boss_Goma) fetchArchive('zelda_goma.zar').then((zar) => {
            const b = buildModel(zar, `model/goma.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/go_startdemo02.csab`)); 
            b.setVertexColorScale(characterLightScale);
        });
        else if (actor.actorId === ActorId.Boss_Dodongo) fetchArchive(`zelda_kdodongo.zar`).then((zar) => {
            const b = buildModel(zar, `model/kingdodongo.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/kd_wait.csab`)); 
            b.setVertexColorScale(characterLightScale);
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
        else console.warn(`Unknown actor ${j} / ${hexzero(actor.actorId, 4)} / ${hexzero(actor.variable, 4)}`);
    }

    private createSceneFromData(device: GfxDevice, abortSignal: AbortSignal, zarBuffer: ArrayBufferSlice, zsiBuffer: ArrayBufferSlice): Progressable<Viewer.SceneGfx> {
        const textureHolder = new CtrTextureHolder();
        const modelCache = new ModelCache();
        const renderer = new OoT3DRenderer(device, textureHolder, modelCache);

        const zar = zarBuffer.byteLength ? ZAR.parse(zarBuffer) : null;

        const zsi = ZSI.parseScene(zsiBuffer);
        assert(zsi.rooms !== null);
        (renderer as any).zsi = zsi;

        // TODO(jstpierre): Fix this.
        const scene = chooseSceneFromId(this.id);

        const roomZSINames: string[] = [];
        for (let i = 0; i < zsi.rooms.length; i++) {
            const filename = zsi.rooms[i].split('/').pop();
            const roomZSIName = `${pathBase}/scene/${filename}`;
            roomZSINames.push(roomZSIName);
            modelCache.fetchFileData(roomZSIName, abortSignal);
        }

        return modelCache.waitForLoad().then(() => {
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
                (roomRenderer as any).roomSetups = roomSetups;
                if (zar !== null) {
                    const cmabFile = zar.files.find((file) => file.name.startsWith(`ROOM${i}`) && file.name.endsWith('.cmab') && !file.name.endsWith('_t.cmab'));
                    if (cmabFile) {
                        const cmab = CMAB.parse(CMB.Version.Ocarina, cmabFile.buffer);
                        textureHolder.addTextures(device, cmab.textures);
                        roomRenderer.bindCMAB(cmab);
                    }
                }
                roomRenderer.addToViewRenderer(device, renderer.viewRenderer);

                const envIndex = 0;
                roomRenderer.setEnvironmentSettings(zsi.environmentSettings[envIndex]);

                renderer.roomRenderers.push(roomRenderer);

                for (let j = 0; j < roomSetup.actors.length; j++)
                    this.spawnActorForRoom(device, abortSignal, scene, renderer, roomRenderer, zsi.environmentSettings[envIndex], roomSetup.actors[j], j);
            }

            return modelCache.waitForLoad().then(() => {
                return renderer;
            });
        });
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
    new SceneDesc("kenjyanoma", "Chamber of the Sages"),
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
