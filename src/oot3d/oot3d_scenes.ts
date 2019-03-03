
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
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.roomRenderers.length; i++)
                this.roomRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

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
    En_Item00       = 0x0015,
    En_Kusa         = 0x0125,
    En_Kanban       = 0x0141,
    En_Ko           = 0x0163,
    En_Gs           = 0x01B9,
    En_Cow          = 0x01C6,
    En_In           = 0x00CB,
    En_Ma2          = 0x00D9,
    En_Horse_Normal = 0x003C,
    En_Ta           = 0x0084,
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        // Fetch the ZAR & info ZSI.
        const path_zar = `${pathBase}/scene/${this.id}.zar`;
        const path_info_zsi = `${pathBase}/scene/${this.id}_info.zsi`;
        return Progressable.all([fetchData(path_zar, abortSignal), fetchData(path_info_zsi, abortSignal)]).then(([zar, zsi]) => {
            return this.createSceneFromData(device, abortSignal, zar, zsi);
        });
    }

    private spawnActorForRoom(device: GfxDevice, abortSignal: AbortSignal, renderer: OoT3DRenderer, roomRenderer: RoomRenderer, actor: ZSI.Actor): void {
        function fetchArchive(archivePath: string): Progressable<ZAR.ZAR> { 
            return renderer.modelCache.fetchArchive(`${pathBase}/actor/${archivePath}`, abortSignal);
        }

        function buildModel(zar: ZAR.ZAR, modelPath: string, scale: number = 0.01): CmbRenderer {
            const cmbData = renderer.modelCache.getModel(device, renderer, zar, modelPath);
            const cmbRenderer = new CmbRenderer(device, renderer.textureHolder, cmbData);
            mat4.scale(cmbRenderer.modelMatrix, actor.modelMatrix, [scale, scale, scale]);
            cmbRenderer.addToViewRenderer(device, renderer.viewRenderer);
            roomRenderer.objectRenderers.push(cmbRenderer);
            return cmbRenderer;
        }

        function parseCSAB(zar: ZAR.ZAR, filename: string): CSAB.CSAB {
            return CSAB.parse(CMB.Version.Ocarina, ZAR.findFileData(zar, filename));
        }

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
            } else console.warn(`Unknown Item00 drop: ${hexzero(actor.variable, 4)}`);
        });
        else if (actor.actorId === ActorId.En_Kusa) fetchArchive(`zelda_kusa.zar`).then((zar) => buildModel(zar, `model/obj_kusa01_model.cmb`, 0.5));
        else if (actor.actorId === ActorId.En_Kanban) fetchArchive(`zelda_keep.zar`).then((zar) => buildModel(zar, `objects/model/kanban1_model.cmb`, 0.01));
        else if (actor.actorId === ActorId.En_Ko) fetchArchive(`zelda_kw1.zar`).then((zar) => {
            const b = buildModel(zar, `model/kokiripeople.cmb`, 0.015);
            b.bindCSAB(parseCSAB(zar, `anim/fad_n_wait.csab`));

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
            } else if (whichNPC === 0x0C) { // Blonde girl.
                setGender(Gender.GIRL);
            } else {
                throw "whoops";
            }
        });
        else if (actor.actorId === ActorId.En_Gs) fetchArchive(`zelda_gs.zar`).then((zar) => buildModel(zar, `model/gossip_stone2_model.cmb`, 0.1));
        else if (actor.actorId === ActorId.En_Cow) fetchArchive('zelda_cow.zar').then((zar) => {
            const b = buildModel(zar, `model/cow.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/usi_mogmog.csab`));
        });
        else if (actor.actorId === ActorId.En_In) fetchArchive('zelda_in.zar').then((zar) => {
            // TODO(starschulz): Investigate broken face
            const b = buildModel(zar, `model/ingo.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/in_shigoto.csab`));
        });
        else if (actor.actorId === ActorId.En_Ma2) fetchArchive(`zelda_ma2.zar`).then((zar) => {
            const b = buildModel(zar, `model/malon.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ma2_shigoto.csab`));
        });
        else if (actor.actorId === ActorId.En_Horse_Normal) fetchArchive(`zelda_horse_normal.zar`).then((zar) => {
            const b = buildModel(zar, `model/normalhorse.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/hn_anim_wait.csab`));
        });
        else if (actor.actorId === ActorId.En_Ta) fetchArchive(`zelda_ta.zar`).then((zar) => {
            // TODO(starschulz): Investigate broken face
            const b = buildModel(zar, `model/talon.cmb`);
            b.bindCSAB(parseCSAB(zar, `anim/ta_matsu.csab`));
        });
        else console.warn(`Unknown actor ${hexzero(actor.actorId, 4)}`);
    }

    private createSceneFromData(device: GfxDevice, abortSignal: AbortSignal, zarBuffer: ArrayBufferSlice, zsiBuffer: ArrayBufferSlice): Progressable<Viewer.SceneGfx> {
        const textureHolder = new CtrTextureHolder();
        const modelCache = new ModelCache();
        const renderer = new OoT3DRenderer(device, textureHolder, modelCache);

        const zar = zarBuffer.byteLength ? ZAR.parse(zarBuffer) : null;

        const zsi = ZSI.parseScene(zsiBuffer);
        assert(zsi.rooms !== null);

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
                // Pull out the first mesh we can find.
                const roomSetup = roomSetups.find((roomSetup) => roomSetup.mesh !== null);
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
                renderer.roomRenderers.push(roomRenderer);

                for (let i = 0; i < roomSetup.actors.length; i++)
                    this.spawnActorForRoom(device, abortSignal, renderer, roomRenderer, roomSetup.actors[i]);
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
    new SceneDesc("kenjyanoma", "Chamber of Sages"),
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
