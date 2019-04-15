
// Mario Kart Wii

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Yaz0 from '../compression/Yaz0';

import { assert, readString, hexzero, assertExists } from '../util';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4 } from 'gl-matrix';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import AnimationController from '../AnimationController';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, depthClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { RENDER_HACKS_ICON } from '../bk/scenes';
import { calcModelMtx } from '../oot3d/cmb';

const enum MKWiiPass { MAIN = 0x01, SKYBOX = 0x02 }

class ModelCache {
    public rresCache = new Map<string, BRRES.RRES>();
    public modelCache = new Map<string, MDL0Model>();

    public destroy(device: GfxDevice): void {
        for (const v of this.modelCache.values())
            v.destroy(device);
    }

    public ensureRRES(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, path: string): BRRES.RRES {
        if (!this.rresCache.has(path)) {
            const rres = BRRES.parse(arc.findFileData(path));
            renderer.textureHolder.addRRESTextures(device, rres);
            this.rresCache.set(path, rres);

            for (let i = 0; i < rres.mdl0.length; i++) {
                const mdl0Model = new MDL0Model(device, renderer.renderHelper, rres.mdl0[i]);
                this.modelCache.set(rres.mdl0[i].name, mdl0Model);
            }
        }

        return this.rresCache.get(path);
    }
}

class MarioKartWiiRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    public renderHelper: GXRenderHelperGfx;
    public textureHolder = new RRESTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: MDL0ModelInstance[] = [];
    public modelCache = new ModelCache();

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
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

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, MKWiiPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, MKWiiPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);

        this.modelCache.destroy(device);
    }
}

interface GOBJ {
    objectId: number;
    routeId: number;
    objectArg0: number;
    objectArg1: number;
    objectArg2: number;
    objectArg3: number;
    objectArg4: number;
    objectArg5: number;
    objectArg6: number;
    objectArg7: number;
    presenceFlags: number;
    translationX: number;
    translationY: number;
    translationZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

interface KMP {
    gobj: GOBJ[];
}

function parseKMP(buffer: ArrayBufferSlice): KMP {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RKMD');
    const headerSize = view.getUint16(0x0A);
    const gobjOffs_ = view.getUint32(0x2C);

    const gobjOffs = headerSize + gobjOffs_;
    assert(readString(buffer, gobjOffs + 0x00, 0x04) === 'GOBJ');
    const gobjTableCount = view.getUint16(gobjOffs + 0x04);
    let gobjTableIdx = gobjOffs + 0x08;

    const gobj: GOBJ[] = [];
    for (let i = 0; i < gobjTableCount; i++) {
        const objectId = view.getUint16(gobjTableIdx + 0x00);
        const translationX = view.getFloat32(gobjTableIdx + 0x04);
        const translationY = view.getFloat32(gobjTableIdx + 0x08);
        const translationZ = view.getFloat32(gobjTableIdx + 0x0C);
        const rotationX = view.getFloat32(gobjTableIdx + 0x10) * Math.PI / 180;
        const rotationY = view.getFloat32(gobjTableIdx + 0x14) * Math.PI / 180;
        const rotationZ = view.getFloat32(gobjTableIdx + 0x18) * Math.PI / 180;
        const scaleX = view.getFloat32(gobjTableIdx + 0x1C);
        const scaleY = view.getFloat32(gobjTableIdx + 0x20);
        const scaleZ = view.getFloat32(gobjTableIdx + 0x24);
        const routeId = view.getUint16(gobjTableIdx + 0x28);
        const objectArg0 = view.getUint16(gobjTableIdx + 0x2A);
        const objectArg1 = view.getUint32(gobjTableIdx + 0x2C);
        const objectArg2 = view.getUint32(gobjTableIdx + 0x3E);
        const objectArg3 = view.getUint32(gobjTableIdx + 0x30);
        const objectArg4 = view.getUint16(gobjTableIdx + 0x32);
        const objectArg5 = view.getUint32(gobjTableIdx + 0x34);
        const objectArg6 = view.getUint32(gobjTableIdx + 0x36);
        const objectArg7 = view.getUint32(gobjTableIdx + 0x38);

        const presenceFlags = view.getUint32(gobjTableIdx + 0x3A);
        gobj.push({
            objectId, routeId, objectArg0, objectArg1, objectArg2, objectArg3, objectArg4, objectArg5, objectArg6, objectArg7, presenceFlags,
            translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ,
        });

        gobjTableIdx += 0x3C;
    }

    return { gobj };
}

const scaleFactor = 0.1;
const posMtx = mat4.fromScaling(mat4.create(), [scaleFactor, scaleFactor, scaleFactor]);

class MarioKartWiiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private spawnObjectFromRRES(device: GfxDevice, renderer: MarioKartWiiRenderer, rres: BRRES.RRES, objectName: string): MDL0ModelInstance {
        const modelCache = renderer.modelCache;
        const mdl0Model = modelCache.modelCache.get(objectName);
        const mdl0Instance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model);
        mdl0Instance.bindRRESAnimations(renderer.animationController, rres);
        renderer.modelInstances.push(mdl0Instance);
        mdl0Instance.passMask = MKWiiPass.MAIN;
        return mdl0Instance;
    }

    private spawnObjectFromKMP(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, gobj: GOBJ): void {
        const getRRES = (objectName: string): BRRES.RRES => {
            const arcPath = `./${objectName}.brres`;
            renderer.modelCache.ensureRRES(device, renderer, arc, arcPath);
            return assertExists(renderer.modelCache.rresCache.get(arcPath));
        };

        const spawnObject = (objectName: string): MDL0ModelInstance => {
            const rres = getRRES(objectName);
            const b = this.spawnObjectFromRRES(device, renderer, rres, objectName);
            calcModelMtx(b.modelMatrix, gobj.scaleX, gobj.scaleY, gobj.scaleZ, gobj.rotationX, gobj.rotationY, gobj.rotationZ, gobj.translationX, gobj.translationY, gobj.translationZ);
            mat4.mul(b.modelMatrix, posMtx, b.modelMatrix);
            return b;
        };

        // Object IDs taken from http://wiki.tockdom.com/wiki/Object

        if (gobj.objectId === 0x0002) { // Psea
            const rres = getRRES(`Psea`);
            const b1 = this.spawnObjectFromRRES(device, renderer, rres, `Psea1sand`);
            const b2 = this.spawnObjectFromRRES(device, renderer, rres, `Psea2dark`);
            const b3 = this.spawnObjectFromRRES(device, renderer, rres, `Psea3nami`);
            const b4 = this.spawnObjectFromRRES(device, renderer, rres, `Psea4tex`);
            const b5 = this.spawnObjectFromRRES(device, renderer, rres, `Psea5spc`);

            // Value established by trial and error. Needs more research. See
            // http://wiki.tockdom.com/wiki/Object/Psea
            b1.modelMatrix[13] -= 8550;
            b2.modelMatrix[13] -= 8550;
            b3.modelMatrix[13] -= 8550;
            b4.modelMatrix[13] -= 8550;
            b5.modelMatrix[13] -= 8550;
        } else if (gobj.objectId === 0x0003) { // lensFX
            // Lens flare effect -- runtime determined, not a BRRES.
        } else if (gobj.objectId === 0x0015) { // sound_Mii
            // sound generator
        } else if (gobj.objectId === 0x00D2) { // skyship
            spawnObject(`skyship`);
        } else if (gobj.objectId === 0x0065) { // itembox
            const b = spawnObject(`itembox`);
            b.modelMatrix[13] += 20;
        } else if (gobj.objectId === 0x006F) { // sun
            // TODO(jstpierre): Sun doesn't show up? Need to figure out what this is...
            spawnObject(`sun`);
        } else if (gobj.objectId === 0x0071) { // KmoonZ
            spawnObject(`KmoonZ`);
        } else if (gobj.objectId === 0x0072) { // sunDS
            spawnObject(`sunDS`);
        } else if (gobj.objectId === 0x0073) { // coin
            spawnObject(`coin`);  
            // Kinda partially clipped into the floor, and doesn't spin
        } else if (gobj.objectId === 0x00ca) { // MashBalloonGC
            spawnObject(`MashBalloonGC`);
        } else if (gobj.objectId === 0x00cb) { // WLwallGC
            spawnObject(`WLwallGC`);
        } else if (gobj.objectId === 0x00cc) { // CarA1
            spawnObject(`CarA1`);
        } else if (gobj.objectId === 0x00cd) { // basabasa
            spawnObject(`basabasa`);
        } else if (gobj.objectId === 0x00ce) { // HeyhoShipGBA
            spawnObject(`HeyhoShipGBA`);
        //} else if (gobj.objectId === 0x00d0) { // kart_truck
        //    spawnObject(`K_truck`);
        //} else if (gobj.objectId === 0x00d1) { // car_body
        //    spawnObject(`K_car_body`);
        } else if (gobj.objectId === 0x00d2) { // skyship
            spawnObject(`skyship`);
        } else if (gobj.objectId === 0x00d7) { // penguin_s
            spawnObject(`penguin_s`);
            // wiki says they should be creating a mirrored one below it, for the fake reflection but it isnt
        } else if (gobj.objectId === 0x00d8) { // penguin_m
            spawnObject(`penguin_m`);
        } else if (gobj.objectId === 0x00d9) { // penguin_l
            spawnObject(`penguin_l`);
            // penguins are missing eyes, the horror!
        } else if (gobj.objectId === 0x00da) { // castleballoon1
            spawnObject(`castleballoon1`);
        } else if (gobj.objectId === 0x00db) { // dossunc
            spawnObject(`dossun`);
        } else if (gobj.objectId === 0x00dd) { // boble
            spawnObject(`boble`);
        } else if (gobj.objectId === 0x00de) { // K_bomb_car
            spawnObject(`K_bomb_car`);
        //} else if (gobj.objectId === 0x00e2) { // hanachan
        //    spawnObject(`hanachan`);
            // only shows up as his head
        } else if (gobj.objectId === 0x00e3) { // seagull
            spawnObject(`seagull`);
        } else if (gobj.objectId === 0x00e4) { // moray
            spawnObject(`moray`);
        } else if (gobj.objectId === 0x00e5) { // crab
            spawnObject(`crab`);
        } else if (gobj.objectId === 0x00e7) { // CarA2
            spawnObject(`CarA2`);
        } else if (gobj.objectId === 0x00e8) { // CarA3
            spawnObject(`CarA3`);
        //} else if (gobj.objectId === 0x00e9) { // Hwanwan
        //    spawnObject(`wanwan`);
            // smaller than it should be and half clipped into the floor
        } else if (gobj.objectId === 0x00eb) { // Twanwan
            const b = spawnObject(`Twanwan`);
            b.modelMatrix[13] += 150;
            // offset a bit so he fits into the pipe nicer.
        } else if (gobj.objectId === 0x00ec) { // cruiserR
            spawnObject(`cruiser`);
        } else if (gobj.objectId === 0x00ed) { // bird
            spawnObject(`bird`);
        } else if (gobj.objectId === 0x012E) { // dokan_sfc
            spawnObject(`dokan_sfc`);
        } else if (gobj.objectId === 0x012f) { // castletree1
            spawnObject(`castletree1`);
        } else if (gobj.objectId === 0x0130) { // castletree1c
            spawnObject(`castletree1`);
        } else if (gobj.objectId === 0x0131) { // castletree2
            spawnObject(`castletree2`);
        } else if (gobj.objectId === 0x0132) { // castleflower1
            spawnObject(`castleflower1`);
        } else if (gobj.objectId === 0x0133) { // mariotreeGC
            spawnObject(`mariotreeGC`);
        } else if (gobj.objectId === 0x0134) { // mariotreeGCc
            spawnObject(`mariotreeGC`);
        } else if (gobj.objectId === 0x0135) { // donkytree1GC
            spawnObject(`donkytree1GC`);
        } else if (gobj.objectId === 0x0136) { // donkytree2GC
            spawnObject(`donkytree2GC`);
        } else if (gobj.objectId === 0x0137) { // peachtreeGC
            spawnObject(`peachtreeGC`);
        } else if (gobj.objectId === 0x0138) { // peachtreeGCc
            spawnObject(`peachtreeGC`);
        } else if (gobj.objectId === 0x013c) { // obakeblockSFCc
            spawnObject(`obakeblockSFC`);
        } else if (gobj.objectId === 0x014D) { // MiiObj01
            spawnObject(`MiiObj01`);
        } else if (gobj.objectId === 0x014E) { // MiiObj02
            spawnObject(`MiiObj02`);
        } else if (gobj.objectId === 0x014F) { // MiiObj03
            spawnObject(`MiiObj03`);
        } else if (gobj.objectId === 0x0150) { // gardentreeDS
            spawnObject(`gardentreeDS`);
        } else if (gobj.objectId === 0x0151) { // gardentreeDSc
            spawnObject(`gardentreeDS`);
        } else if (gobj.objectId === 0x0152) { // FlagA1
            spawnObject(`FlagA1`);
        } else if (gobj.objectId === 0x0153) { // FlagA2
            spawnObject(`FlagA2`);
        } else if (gobj.objectId === 0x0154) { // FlagB1
            spawnObject(`FlagB1`);
        } else if (gobj.objectId === 0x0155) { // FlagB2
            spawnObject(`FlagB2`);
        } else if (gobj.objectId === 0x0156) { // FlagA3
            spawnObject(`FlagA3`);
        } else if (gobj.objectId === 0x0157) { // DKtreeA64
            spawnObject(`DKtreeA64`);
        } else if (gobj.objectId === 0x0158) { // DKtreeA64c
            spawnObject(`DKtreeA64`);
        } else if (gobj.objectId === 0x0159) { // DKtreeB64
            spawnObject(`DKtreeB64`);
        } else if (gobj.objectId === 0x015a) { // DKtreeB64c
            spawnObject(`DKtreeB64`);
        } else if (gobj.objectId === 0x015b) { // TownTreeDSc
            spawnObject(`TownTreeDS`);
        } else if (gobj.objectId === 0x018E) { // MiiKanban
            spawnObject(`MiiKanban`);
        } else if (gobj.objectId === 0x0191) { // kuribo
            const b = spawnObject(`kuribo`);
            const rres = getRRES(`kuribo`);
            b.bindCHR0(renderer.animationController, rres.chr0.find((chr0) => chr0.name === 'walk_l'));
        } else if (gobj.objectId === 0x02D0) { // Flash_L
            // particle effect; unsupported
        } else if (gobj.objectId === 0x02E1) { // MiiStatueL3
            spawnObject(`MiiStatueL3`);
        } else {
            console.warn(`Unimplemented object ${hexzero(gobj.objectId, 4)}`);
        }
    }

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        return fetchData(`mkwii/${this.id}.szs`).then((buffer: ArrayBufferSlice) => {
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice): Viewer.SceneGfx => {
            const arc = U8.parse(buffer);
            const kmp = parseKMP(arc.findFileData(`./course.kmp`));
            console.log(arc, kmp);
            const renderer = new MarioKartWiiRenderer(device);

            const modelCache = renderer.modelCache;

            const courseRRES = modelCache.ensureRRES(device, renderer, arc, `./course_model.brres`);;
            const courseInstance = this.spawnObjectFromRRES(device, renderer, courseRRES, 'course');
            mat4.copy(courseInstance.modelMatrix, posMtx);

            const skyboxRRES = modelCache.ensureRRES(device, renderer, arc, `./vrcorn_model.brres`);
            const skyboxInstance = this.spawnObjectFromRRES(device, renderer, skyboxRRES, 'vrcorn');
            mat4.copy(skyboxInstance.modelMatrix, posMtx);
            skyboxInstance.passMask = MKWiiPass.SKYBOX;

            for (let i = 0; i < kmp.gobj.length; i++)
                this.spawnObjectFromKMP(device, renderer, arc, kmp.gobj[i]);

            renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);

            return renderer;
        });
    }
}

const id = 'mkwii';
const name = 'Mario Kart Wii';
// Courses named and organized by Starschulz
const sceneDescs = [
    "Mushroom Cup",
    new MarioKartWiiSceneDesc('beginner_course', "Luigi Circuit"),
    new MarioKartWiiSceneDesc('farm_course', "Moo Moo Meadows"),
    new MarioKartWiiSceneDesc('kinoko_course', "Mushroom Gorge"),
    new MarioKartWiiSceneDesc('factory_course', "Toad's Factory"),
    "Flower Cup",
    new MarioKartWiiSceneDesc('castle_course', "Mario Circuit"),
    new MarioKartWiiSceneDesc('shopping_course', "Coconut Mall"),
    new MarioKartWiiSceneDesc('boardcross_course', "DK Summit"),
    new MarioKartWiiSceneDesc('truck_course', "Wario's Gold Mine"),
    "Star Cup",
    new MarioKartWiiSceneDesc('senior_course', "Daisy Circuit"),
    new MarioKartWiiSceneDesc('water_course', "Koopa Cape"),
    new MarioKartWiiSceneDesc('treehouse_course', "Maple Treeway"),
    new MarioKartWiiSceneDesc('volcano_course', "Grumble Volcano"),
    "Special Cup",
    new MarioKartWiiSceneDesc('desert_course', "Dry Dry Ruins"),
    new MarioKartWiiSceneDesc('ridgehighway_course', "Moonview Highway"),
    new MarioKartWiiSceneDesc('koopa_course', "Bowser's Castle"),
    new MarioKartWiiSceneDesc('rainbow_course', "Rainbow Road"),
    "Shell Cup",
    new MarioKartWiiSceneDesc('old_peach_gc', "GCN Peach Beach"),
    new MarioKartWiiSceneDesc('old_falls_ds', "DS Yoshi Falls"),
    new MarioKartWiiSceneDesc('old_obake_sfc', "SNES Ghost Valley 2"),
    new MarioKartWiiSceneDesc('old_mario_64', "N64 Mario Raceway"),
    "Banana Cup",
    new MarioKartWiiSceneDesc('old_sherbet_64', "N64 Sherbet Land"),
    new MarioKartWiiSceneDesc('old_heyho_gba', "GBA Shy Guy Beach"),
    new MarioKartWiiSceneDesc('old_town_ds', "DS Delfino Square"),
    new MarioKartWiiSceneDesc('old_waluigi_gc', "GCN Waluigi Stadium"),
    "Leaf Cup",
    new MarioKartWiiSceneDesc('old_desert_ds', "DS Desert Hills"),
    new MarioKartWiiSceneDesc('old_koopa_gba', "GBA Bowser's Castle 3"),
    new MarioKartWiiSceneDesc('old_donkey_64', "N64 DK's Jungle Parkway"),
    new MarioKartWiiSceneDesc('old_mario_gc', "GC Mario Circuit"),
    "Lightning Cup",
    new MarioKartWiiSceneDesc('old_mario_sfc', "SNES Mario Circuit 3"),
    new MarioKartWiiSceneDesc('old_garden_ds', "DS Peach Gardens"),
    new MarioKartWiiSceneDesc('old_donkey_gc', "GCN DK Mountain"),
    new MarioKartWiiSceneDesc('old_koopa_64', "N64 Bowser's Castle"),
    "Battle Courses",
    new MarioKartWiiSceneDesc('block_battle', "Block Plaza"),
    new MarioKartWiiSceneDesc('venice_battle', "Delfino Pier"),
    new MarioKartWiiSceneDesc('skate_battle', "Funky Stadium"),
    new MarioKartWiiSceneDesc('casino_battle', "Chain Chomp Wheel"),
    new MarioKartWiiSceneDesc('sand_battle', "Thwomp Desert"),
    new MarioKartWiiSceneDesc('old_battle4_sfc', "SNES Battle Course 4"),
    new MarioKartWiiSceneDesc('old_battle3_gba', "GBA Battle Course 3"),
    new MarioKartWiiSceneDesc('old_matenro_64', "N64 Skyscraper"),
    new MarioKartWiiSceneDesc('old_CookieLand_gc', "GCN Cookie Land"),
    new MarioKartWiiSceneDesc('old_House_ds', "DS Twilight House"),
    new MarioKartWiiSceneDesc('ring_mission', "Galaxy Colosseum"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
