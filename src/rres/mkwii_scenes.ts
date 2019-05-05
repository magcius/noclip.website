
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
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { calcModelMtx } from '../oot3d/cmb';

const enum MKWiiPass { MAIN = 0x01 }

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
        const mainPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
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

    private static spawnObjectFromRRES(device: GfxDevice, renderer: MarioKartWiiRenderer, rres: BRRES.RRES, objectName: string): MDL0ModelInstance {
        const modelCache = renderer.modelCache;
        const mdl0Model = modelCache.modelCache.get(objectName);
        const mdl0Instance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model, objectName);
        mdl0Instance.bindRRESAnimations(renderer.animationController, rres, null);
        renderer.modelInstances.push(mdl0Instance);
        return mdl0Instance;
    }

    private static spawnObjectFromKMP(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, gobj: GOBJ): void {
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
        } else if (gobj.objectId === 0x013d) { // WLarrowGC
            spawnObject(`WLarrowGC`);
        } else if (gobj.objectId === 0x013e) { // WLscreenGC
            spawnObject(`WLscreenGC`);
        } else if (gobj.objectId === 0x013f) { // WLdokanGC
            spawnObject(`WLdokanGC`);
        } else if (gobj.objectId === 0x0140) { // MarioGo64c
            spawnObject(`MarioGo64`);
        } else if (gobj.objectId === 0x0141) { // PeachHunsuiGC
            spawnObject(`PeachHunsuiGC`);
        } else if (gobj.objectId === 0x0142) { // kinokoT1
            spawnObject(`kinokoT1`);
        } else if (gobj.objectId === 0x0144) { // pylon01
            spawnObject(`pylon01`);
        } else if (gobj.objectId === 0x0145) { // PalmTree
            spawnObject(`PalmTree`);
        } else if (gobj.objectId === 0x0146) { // parasol
            spawnObject(`parasol`);
        } else if (gobj.objectId === 0x0147) { // cruiser
            spawnObject(`cruiser`);
        } else if (gobj.objectId === 0x0148) { // K_sticklift00
            spawnObject(`K_sticklift00`);
        } else if (gobj.objectId === 0x0149) { // heyho2
            spawnObject(`heyho2`);
        } else if (gobj.objectId === 0x014a) { // HeyhoTreeGBAc
            spawnObject(`HeyhoTreeGBA`);
        } else if (gobj.objectId === 0x014c) { // truckChimSmk
            spawnObject(`truckChimSmk`);
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
        } else if (gobj.objectId === 0x015c) { // Piston
            spawnObject(`Piston`);
        } else if (gobj.objectId === 0x015d) { // oilSFC
            spawnObject(`oilSFC`);
        } else if (gobj.objectId === 0x0160) { // mii_balloon
            spawnObject(`mii_balloon`);
        } else if (gobj.objectId === 0x0161) { // windmill
            spawnObject(`windmill`);
        } else if (gobj.objectId === 0x0162) { // dossun
            spawnObject(`dossun`);
        } else if (gobj.objectId === 0x0163) { // TownTreeDS
            spawnObject(`TownTreeDS`);
        } else if (gobj.objectId === 0x0164) { // Ksticketc
            spawnObject(`Ksticketc`);
        } else if (gobj.objectId === 0x0165) { // monte_a
            spawnObject(`monte_a`);
        } else if (gobj.objectId === 0x0166) { // MiiStatueM1
            spawnObject(`MiiStatueM1`);
        } else if (gobj.objectId === 0x0167) { // ShMiiObj01
            spawnObject(`ShMiiObj01`);
        } else if (gobj.objectId === 0x0168) { // ShMiiObj02
            spawnObject(`ShMiiObj02`);
        } else if (gobj.objectId === 0x0169) { // ShMiiObj03
            spawnObject(`ShMiiObj03`);
        } else if (gobj.objectId === 0x016b) { // miiposter
            spawnObject(`miiposter`);
        } else if (gobj.objectId === 0x016c) { // dk_miiobj00
            spawnObject(`dk_miiobj00`);
        } else if (gobj.objectId === 0x016d) { // light_house
            spawnObject(`light_house`);
        } else if (gobj.objectId === 0x016e) { // r_parasol
            spawnObject(`r_parasol`);
        } else if (gobj.objectId === 0x016f) { // obakeblock2SFCc
            spawnObject(`obakeblockSFC`);
        } else if (gobj.objectId === 0x0170) { // obakeblock3SFCc
            spawnObject(`obakeblockSFC`);
        } else if (gobj.objectId === 0x0171) { // koopaFigure
            spawnObject(`koopaFigure`);
        } else if (gobj.objectId === 0x0172) { // pukupuku
            spawnObject(`pukupuku`);
        } else if (gobj.objectId === 0x0176) { // karehayama
            spawnObject(`karehayama`);
        } else if (gobj.objectId === 0x0177) { // EarthRing
            spawnObject(`EarthRing`);
        } else if (gobj.objectId === 0x0178) { // SpaceSun
            spawnObject(`SpaceSun`);
        } else if (gobj.objectId === 0x017a) { // StarRing
            spawnObject(`StarRing`);
        } else if (gobj.objectId === 0x017b) { // M_obj_kanban
            spawnObject(`M_obj_kanban`);
        } else if (gobj.objectId === 0x017c) { // MiiStatueL1
            spawnObject(`MiiStatueL1`);
        } else if (gobj.objectId === 0x017d) { // MiiStatueD1
            spawnObject(`MiiStatueD1`);
        } else if (gobj.objectId === 0x017e) { // MiiSphinxY1
            spawnObject(`MiiSphinxY1`);
        } else if (gobj.objectId === 0x017f) { // MiiSphinxY2
            spawnObject(`MiiSphinxY2`);
        } else if (gobj.objectId === 0x0180) { // FlagA5
            spawnObject(`FlagA5`);
        } else if (gobj.objectId === 0x0181) { // CarB
            spawnObject(`CarB`);
        } else if (gobj.objectId === 0x0185) { // group_monte_a
            spawnObject(`group_monte_a`);
        } else if (gobj.objectId === 0x0186) { // MiiStatueL2
            spawnObject(`MiiStatueL2`);
        } else if (gobj.objectId === 0x0187) { // MiiStatueD2
            spawnObject(`MiiStatueD2`);
        } else if (gobj.objectId === 0x0188) { // MiiStatueP1
            spawnObject(`MiiStatueP1`);
        } else if (gobj.objectId === 0x0189) { // SentakuDS
            spawnObject(`SentakuDS`);
        } else if (gobj.objectId === 0x018a) { // fks_screen_wii
            spawnObject(`fks_screen_wii`);
        } else if (gobj.objectId === 0x018b) { // KoopaFigure64
            spawnObject(`KoopaFigure64`);
        } else if (gobj.objectId === 0x018c) { // b_teresa
            spawnObject(`b_teresa`);
        } else if (gobj.objectId === 0x018E) { // MiiKanban
            spawnObject(`MiiKanban`);
        } else if (gobj.objectId === 0x018f) { // BGteresaSFC
            spawnObject(`BGteresaSFC`);
        } else if (gobj.objectId === 0x0191) { // kuribo
            const b = spawnObject(`kuribo`);
            const rres = getRRES(`kuribo`);
            b.bindCHR0(renderer.animationController, rres.chr0.find((chr0) => chr0.name === 'walk_l'));
        } else if (gobj.objectId === 0x0192) { // choropu
            spawnObject(`choropu`);
        } else if (gobj.objectId === 0x0193) { // cow
            spawnObject(`cow`);
        } else if (gobj.objectId === 0x0194) { // pakkun_f
            spawnObject(`pakkun_f`);
        } else if (gobj.objectId === 0x0195) { // WLfirebarGC
            spawnObject(`WLfirebarGC`);
        } else if (gobj.objectId === 0x0196) { // wanwan
            spawnObject(`wanwan`);
        } else if (gobj.objectId === 0x0197) { // poihana
            spawnObject(`poihana`);
        } else if (gobj.objectId === 0x0198) { // DKrockGC
            spawnObject(`DKrockGC`);
        } else if (gobj.objectId === 0x0199) { // sanbo
            spawnObject(`sanbo`);
        } else if (gobj.objectId === 0x019a) { // choropu2
            spawnObject(`choropu`);
        } else if (gobj.objectId === 0x019b) { // TruckWagon
            spawnObject(`TruckWagon`);
        } else if (gobj.objectId === 0x019c) { // heyho
            spawnObject(`heyho`);
        } else if (gobj.objectId === 0x019d) { // Press
            spawnObject(`Press`);
        } else if (gobj.objectId === 0x01a1) { // WLfireringGC
            spawnObject(`WLfirebarGC`);
        } else if (gobj.objectId === 0x01a2) { // pakkun_dokan
            spawnObject(`pakkun_dokan`);
        //} else if (gobj.objectId === 0x01a3) { // begoman_spike
        //    spawnObject(`begoman_spike`);
        } else if (gobj.objectId === 0x01a4) { // FireSnake
            spawnObject(`FireSnake`);
        } else if (gobj.objectId === 0x01a5) { // koopaFirebar
            spawnObject(`koopaFirebar`);
        } else if (gobj.objectId === 0x01a6) { // Epropeller
            spawnObject(`Epropeller`);
        } else if (gobj.objectId === 0x01a8) { // FireSnake_v
            spawnObject(`FireSnake`);
        } else if (gobj.objectId === 0x01aa) { // puchi_pakkun
            spawnObject(`puchi_pakkun`);
        //} else if (gobj.objectId === 0x01f5) { // kinoko_ud
        //    spawnObject(`kinoko`);
        //} else if (gobj.objectId === 0x01f6) { // kinoko_bend
        //    spawnObject(`kinoko`);
        } else if (gobj.objectId === 0x01f7) { // VolcanoRock1
            spawnObject(`VolcanoRock1`);
        } else if (gobj.objectId === 0x01f8) { // bulldozer_left
            spawnObject(`bulldozer_left`);
        } else if (gobj.objectId === 0x01f9) { // bulldozer_right
            spawnObject(`bulldozer_right`);
        //} else if (gobj.objectId === 0x01fa) { // kinoko_nm
        //    spawnObject(`kinoko`);
        } else if (gobj.objectId === 0x01fb) { // Crane
            spawnObject(`Crane`);
        } else if (gobj.objectId === 0x01fc) { // VolcanoPiece
            spawnObject(`VolcanoPiece1`);
        } else if (gobj.objectId === 0x01fd) { // FlamePole
            spawnObject(`FlamePole`);
        } else if (gobj.objectId === 0x01fe) { // TwistedWay
            spawnObject(`TwistedWay`);
        } else if (gobj.objectId === 0x01ff) { // TownBridgeDSc
            spawnObject(`TownBridgeDS`);
        } else if (gobj.objectId === 0x0200) { // DKship64
            spawnObject(`DKship64`);
        } else if (gobj.objectId === 0x0202) { // DKturibashiGCc
            spawnObject(`DKturibashiGC`);
        } else if (gobj.objectId === 0x0204) { // aurora
            spawnObject(`aurora`);
        } else if (gobj.objectId === 0x0205) { // venice_saku
            spawnObject(`venice_saku`);
        } else if (gobj.objectId === 0x0206) { // casino_roulette
            spawnObject(`casino_roulette`);
        } else if (gobj.objectId === 0x0209) { // dc_sandcone
            spawnObject(`dc_sandcone`);
        } else if (gobj.objectId === 0x020a) { // venice_hasi 
            spawnObject(`venice_hasi`);
        } else if (gobj.objectId === 0x020b) { // bblock
            spawnObject(`bblock1`);
        } else if (gobj.objectId === 0x020e) { // ami
            spawnObject(`ami`);
        //} else if (gobj.objectId === 0x0212) { // FlamePole_v
        //    spawnObject(`FlamePole_v`);
        } else if (gobj.objectId === 0x0214) { // InsekiA
            spawnObject(`InsekiA`);
        } else if (gobj.objectId === 0x0215) { // InsekiB
            spawnObject(`InsekiB`);
        //} else if (gobj.objectId === 0x0216) { // FlamePole_v_big
        //    spawnObject(`FlamePole_v_big`);
        } else if (gobj.objectId === 0x0217) { // Mdush
            spawnObject(`Mdush`);
        } else if (gobj.objectId === 0x0259) { // DonkyCannonGC
            spawnObject(`DonkyCannonGC`);
        } else if (gobj.objectId === 0x025a) { // BeltEasy
            spawnObject(`BeltEasy`);
        } else if (gobj.objectId === 0x025b) { // BeltCrossing
            spawnObject(`BeltCrossing`);
        } else if (gobj.objectId === 0x025c) { // BeltCurveA
            spawnObject(`BeltCurveA`);
        } else if (gobj.objectId === 0x025e) { // escalator
            spawnObject(`escalator`);
        } else if (gobj.objectId === 0x025f) { // DonkyCannon_wii
            spawnObject(`DonkyCannon_wii`);
        } else if (gobj.objectId === 0x0260) { // escalator_group
            spawnObject(`escalator`);
        } else if (gobj.objectId === 0x0261) { // tree_cannon
            spawnObject(`tree_cannon`);
        } else if (gobj.objectId === 0x02bd) { // group_enemy_b
            spawnObject(`group_enemy_b`);
        } else if (gobj.objectId === 0x02be) { // group_enemy_c
            spawnObject(`group_enemy_c`);
        //} else if (gobj.objectId === 0x02bf) { // taimatsu
        //    spawnObject(`taimatsu`);
        } else if (gobj.objectId === 0x02c0) { // truckChimSmkW
            spawnObject(`truckChimSmkW`);
        } else if (gobj.objectId === 0x02c2) { // dkmonitor
            spawnObject(`dkmonitor`);
        } else if (gobj.objectId === 0x02c3) { // group_enemy_a
            spawnObject(`group_enemy_a`);
        } else if (gobj.objectId === 0x02c4) { // FlagB3
            spawnObject(`FlagB3`);
        } else if (gobj.objectId === 0x02c5) { // spot
            spawnObject(`spot`);
        } else if (gobj.objectId === 0x02c7) { // FlagB4
            spawnObject(`FlagB4`);
        } else if (gobj.objectId === 0x02c8) { // group_enemy_e
            spawnObject(`group_enemy_e`);
        } else if (gobj.objectId === 0x02c9) { // group_monte_L
            spawnObject(`group_monte_a`);
        } else if (gobj.objectId === 0x02ca) { // group_enemy_f
            spawnObject(`group_enemy_f`);
        //} else if (gobj.objectId === 0x02cc) { // FallBsB
        //    spawnObject(`FallBsB`);
        //} else if (gobj.objectId === 0x02ce) { // volsmk
        //    spawnObject(`volsmk`);
        } else if (gobj.objectId === 0x02cf) { // ridgemii00
            spawnObject(`ridgemii00`);
        } else if (gobj.objectId === 0x02D0) { // Flash_L
            // particle effect; unsupported
        } else if (gobj.objectId === 0x02d5) { // MiiSignNoko
            spawnObject(`MiiSignNoko`);
        } else if (gobj.objectId === 0x02d6) { // UtsuboDokan
            spawnObject(`UtsuboDokan`);
        } else if (gobj.objectId === 0x02d7) { // Spot64
            spawnObject(`Spot64`);
        //} else if (gobj.objectId === 0x02d9) { // Fall_MH
        //    spawnObject(`Fall_MH`);
        //} else if (gobj.objectId === 0x02da) { // Fall_Y
        //    spawnObject(`Fall_Y`);
        } else if (gobj.objectId === 0x02df) { // MiiStatueM2
            spawnObject(`MiiStatueM2`);
        } else if (gobj.objectId === 0x02e0) { // RhMiiKanban
            spawnObject(`RhMiiKanban`);
        } else if (gobj.objectId === 0x02E1) { // MiiStatueL3
            spawnObject(`MiiStatueL3`);
        } else if (gobj.objectId === 0x02e2) { // MiiSignWario
            spawnObject(`MiiSignWario`);
        } else if (gobj.objectId === 0x02e3) { // MiiStatueBL1
            spawnObject(`MiiStatueBL1`);
        } else if (gobj.objectId === 0x02e4) { // MiiStatueBD1
            spawnObject(`MiiStatueBD1`);
        } else if (gobj.objectId === 0x02e5) { // Kamifubuki
            spawnObject(`Kamifubuki`);
        } else if (gobj.objectId === 0x02e6) { // Crescent64
            spawnObject(`Crescent64`);
        } else if (gobj.objectId === 0x02e7) { // MiiSighKino
            spawnObject(`MiiSighKino`);
        } else if (gobj.objectId === 0x02e8) { // MiiObjD01
            spawnObject(`MiiObjD01`);
        } else if (gobj.objectId === 0x02e9) { // MiiObjD02
            spawnObject(`MiiObjD02`);
        } else if (gobj.objectId === 0x02ea) { // MiiObjD03
            spawnObject(`MiiObjD03`);
        } else if (gobj.objectId === 0x02eb) { // mare_a
            spawnObject(`mare_a`);
        } else if (gobj.objectId === 0x02ec) { // mare_b
            spawnObject(`mare_b`);
        //} else if (gobj.objectId === 0x02f3) { // DKfalls
        //    spawnObject(`DKfalls`);
        } else {
            console.warn(`Unimplemented object ${hexzero(gobj.objectId, 4)}`);
        }
    }

    public static createSceneFromU8Archive(device: GfxDevice, arc: U8.U8Archive): MarioKartWiiRenderer {
        const kmp = parseKMP(arc.findFileData(`./course.kmp`));
        console.log(arc, kmp);
        const renderer = new MarioKartWiiRenderer(device);

        const modelCache = renderer.modelCache;

        const courseRRES = modelCache.ensureRRES(device, renderer, arc, `./course_model.brres`);
        const courseInstance = this.spawnObjectFromRRES(device, renderer, courseRRES, 'course');
        mat4.copy(courseInstance.modelMatrix, posMtx);

        const skyboxRRES = modelCache.ensureRRES(device, renderer, arc, `./vrcorn_model.brres`);
        const skyboxInstance = this.spawnObjectFromRRES(device, renderer, skyboxRRES, 'vrcorn');
        mat4.copy(skyboxInstance.modelMatrix, posMtx);

        for (let i = 0; i < kmp.gobj.length; i++)
            this.spawnObjectFromKMP(device, renderer, arc, kmp.gobj[i]);

        renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);

        return renderer;
}

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        return fetchData(`mkwii/${this.id}.szs`).then((buffer: ArrayBufferSlice) => {
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            const arc = U8.parse(buffer);
            return MarioKartWiiSceneDesc.createSceneFromU8Archive(device, arc);
        });
    }
}

export function createMarioKartWiiSceneFromU8Archive(device: GfxDevice, arc: U8.U8Archive) {
    return MarioKartWiiSceneDesc.createSceneFromU8Archive(device, arc);
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
