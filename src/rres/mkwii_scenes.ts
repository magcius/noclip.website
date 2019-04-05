
// Mario Kart Wii

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Yaz0 from '../compression/Yaz0';

import { assert, readString, hexzero } from '../util';
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

    public ensureModel(device: GfxDevice, arc: U8.U8Archive, renderer: MarioKartWiiRenderer, path: string): void {
        if (!this.rresCache.has(path)) {
            const rres = BRRES.parse(arc.findFileData(path));
            renderer.textureHolder.addRRESTextures(device, rres);
            this.rresCache.set(path, rres);

            for (let i = 0; i < rres.mdl0.length; i++) {
                const mdl0Model = new MDL0Model(device, renderer.renderHelper, rres.mdl0[i]);
                this.modelCache.set(rres.mdl0[i].name, mdl0Model);
            }
        }
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

    private spawnObjectFromRRESPath(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, arcPath: string, objectName: string): MDL0ModelInstance {
        const modelCache = renderer.modelCache;
        modelCache.ensureModel(device, arc, renderer, arcPath);
        const rres = modelCache.rresCache.get(arcPath);
        const mdl0Model = modelCache.modelCache.get(objectName);
        const mdl0Instance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model);
        mdl0Instance.bindRRESAnimations(renderer.animationController, rres);
        renderer.modelInstances.push(mdl0Instance);
        mdl0Instance.passMask = MKWiiPass.MAIN;
        return mdl0Instance;
    }

    private spawnObjectFromKMP(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, gobj: GOBJ): void {
        const spawnObject = (objectName: string): MDL0ModelInstance => {
            const arcPath = `./${objectName}.brres`;
            const b = this.spawnObjectFromRRESPath(device, renderer, arc, arcPath, objectName);
            calcModelMtx(b.modelMatrix, gobj.scaleX, gobj.scaleY, gobj.scaleZ, gobj.rotationX, gobj.rotationY, gobj.rotationZ, gobj.translationX, gobj.translationY, gobj.translationZ);
            mat4.mul(b.modelMatrix, posMtx, b.modelMatrix);
            return b;
        };

        // Object IDs taken from http://wiki.tockdom.com/wiki/Object

        if (gobj.objectId === 0x0003) { // lensFX
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
        } else if (gobj.objectId === 0x012E) { // dokan_sfc
            spawnObject(`dokan_sfc`);
        } else if (gobj.objectId === 0x014D) { // MiiObj01
            spawnObject(`MiiObj01`);
        } else if (gobj.objectId === 0x014E) { // MiiObj02
            spawnObject(`MiiObj02`);
        } else if (gobj.objectId === 0x014F) { // MiiObj03
            spawnObject(`MiiObj03`);
        } else if (gobj.objectId === 0x0155) { // FlagB2
            spawnObject(`FlagB2`);
        } else if (gobj.objectId === 0x018E) { // MiiKanban
            spawnObject(`MiiKanban`);
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

            const courseInstance = this.spawnObjectFromRRESPath(device, renderer, arc, `./course_model.brres`, 'course');
            mat4.copy(courseInstance.modelMatrix, posMtx);

            const skyboxInstance = this.spawnObjectFromRRESPath(device, renderer, arc, `./vrcorn_model.brres`, 'vrcorn');
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
