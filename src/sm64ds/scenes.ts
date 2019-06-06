
import * as Viewer from '../viewer';
import * as UI from '../ui';

import * as BYML from '../byml';
import * as LZ77 from './lz77';
import * as BMD from './sm64ds_bmd';

import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { NITROTextureHolder, BMDData, Sm64DSCRG1, BMDModelInstance, SM64DSPass, CRG1Level, CRG1Object, NITRO_Program } from './render';
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { vec3, mat4, mat2d } from 'gl-matrix';
import { assertExists, assert } from '../util';
import AnimationController from '../AnimationController';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';

const GLOBAL_SCALE = 1500;

const pathBase = `sm64ds`;
class ModelCache {
    private fileProgressableCache = new Map<string, Progressable<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private modelCache = new Map<string, BMDData>();

    public waitForLoad(): Progressable<any> {
        const p: Progressable<any>[] = [... this.fileProgressableCache.values()];
        return Progressable.all(p);
    }

    private fetchFile(path: string, abortSignal: AbortSignal): Progressable<ArrayBufferSlice> {
        assert(!this.fileProgressableCache.has(path));
        const p = fetchData(`${pathBase}/${path}`, abortSignal);
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

    public fetchModel(device: GfxDevice, filename: string, abortSignal: AbortSignal): Progressable<BMDData> {
        return this.fetchFileData(filename, abortSignal).then((buffer) => {
            return this.getModel(device, filename);
        });
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.modelCache.values())
            model.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 1 },
];
class SM64DSRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
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

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData('sm64ds/sm64ds.crg1', abortSignal).then((result: ArrayBufferSlice) => {
            const crg1 = BYML.parse<Sm64DSCRG1>(result, BYML.FileType.CRG1);
            const textureHolder = new NITROTextureHolder();
            return this._createSceneFromCRG1(device, textureHolder, crg1, abortSignal);
        });
    }

    private _createBMDRenderer(device: GfxDevice, renderer: SM64DSRenderer, abortSignal: AbortSignal, filename: string, scale: number, level: CRG1Level, isSkybox: boolean): Progressable<BMDModelInstance> {
        const modelCache = renderer.modelCache;
        return modelCache.fetchModel(device, filename, abortSignal).then((bmdData: BMDData) => {
            const bmdRenderer = new BMDModelInstance(device, renderer.textureHolder, bmdData, level);
            mat4.scale(bmdRenderer.modelMatrix, bmdRenderer.modelMatrix, [scale, scale, scale]);
            bmdRenderer.isSkybox = isSkybox;
            renderer.bmdRenderers.push(bmdRenderer);
            return bmdRenderer;
        });
    }

    private _createObjectRenderer(device: GfxDevice, renderer: SM64DSRenderer, bmdData: BMDData, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): BMDModelInstance {
        const bmdRenderer = new BMDModelInstance(device, renderer.textureHolder, bmdData);

        vec3.scale(translation, translation, GLOBAL_SCALE);
        mat4.translate(bmdRenderer.modelMatrix, bmdRenderer.modelMatrix, translation);

        mat4.rotateY(bmdRenderer.modelMatrix, bmdRenderer.modelMatrix, rotationY);

        // Don't ask, ugh.
        scale = scale * (GLOBAL_SCALE / 100);
        mat4.scale(bmdRenderer.modelMatrix, bmdRenderer.modelMatrix, [scale, scale, scale]);

        mat4.rotateY(bmdRenderer.normalMatrix, bmdRenderer.normalMatrix, rotationY);

        if (spinSpeed > 0)
            bmdRenderer.animation = new YSpinAnimation(spinSpeed, 0);

        renderer.bmdRenderers.push(bmdRenderer);
        return bmdRenderer;
    }

    private _createBMDObjRenderer(device: GfxDevice, renderer: SM64DSRenderer, abortSignal: AbortSignal, filename: string, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): Progressable<BMDModelInstance> {
        const modelCache = renderer.modelCache;
        return modelCache.fetchModel(device, filename, abortSignal).then((bmdData: BMDData) => {
            return this._createObjectRenderer(device, renderer, bmdData, translation, rotationY, scale, spinSpeed);
        });
    }

    private _createBMDRendererForObject(device: GfxDevice, renderer: SM64DSRenderer, abortSignal: AbortSignal, object: CRG1Object): Progressable<BMDModelInstance> {
        const translation = vec3.fromValues(object.Position.X, object.Position.Y, object.Position.Z);
        const rotationY = object.Rotation.Y / 180 * Math.PI;

        switch (object.ObjectId) {
        case 7: // Up/down lift thingy
        case 9: // Pathlift?
        case 10: // Chain Chomp (copy/pasted)
        case 13: // LONELY ROLLING BALL
        case 15: // Goomba
        case 19: // Bob-omb
        case 20: // Friendly Bob-omb
        case 21: // Koopa
            return null;
        case 23: // Brick Block
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 0.8);
        case 24: // Brick Block Larger
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 1.2);
        case 26: // Powerup inside block?
        case 29: // Cannon hatch
            return null;
        case 30: // Item Block
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_hatena_box/hatena_box.bmd`, translation, rotationY, 0.8);
        case 36: // Pole
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_pile/pile.bmd`, translation, rotationY, 0.8);
        case 37: // Coin
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/coin/coin_poly32.bmd`, translation, rotationY, 0.7, 0.1);
        case 38: // Red Coin
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/coin/coin_red_poly32.bmd`, translation, rotationY, 0.7, 0.1);
        case 39: // Blue Coin
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/coin/coin_blue_poly32.bmd`, translation, rotationY, 0.7, 0.1);
        case 41: { // Tree
            const treeType = (object.Parameters[0] >>> 4) & 0x07;
            const treeFilenames = ['bomb', 'toge', 'yuki', 'yashi', 'castle', 'castle', 'castle', 'castle'];
            const filename = `normal_obj/tree/${treeFilenames[treeType]}_tree.bmd`;
            return this._createBMDObjRenderer(device, renderer, abortSignal, filename, translation, rotationY);
        }
        case 42: { // Castle Painting
            const painting = (object.Parameters[0] >>> 8) & 0x1F;
            const filenames = [
                'for_bh', 'for_bk', 'for_ki', 'for_sm', 'for_cv_ex5', 'for_fl', 'for_dl', 'for_wl', 'for_sl', 'for_wc',
                'for_hm', 'for_hs', 'for_td_tt', 'for_ct', 'for_ex_mario', 'for_ex_luigi', 'for_ex_wario', 'for_vs_cross', 'for_vs_island',
            ];
            const filename = `picture/${filenames[painting]}.bmd`;
            const scaleX = (object.Parameters[0] & 0xF)+1;
            const scaleY = ((object.Parameters[0] >> 4) & 0x0F) + 1;
            const rotationX = object.Parameters[1] / 0x7FFF * (Math.PI);
            const isMirrored = ((object.Parameters[0] >> 13) & 0x03) === 3;
            return this._createBMDObjRenderer(device, renderer, abortSignal, filename, translation, rotationY, 0.8).then((renderer) => {
                mat4.rotateX(renderer.modelMatrix, renderer.modelMatrix, rotationX);
                mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scaleX, scaleY, 1]);
                mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [0, 100/16, 0]);
                if (isMirrored) {
                    renderer.extraTexCoordMat = mat2d.create();
                    renderer.extraTexCoordMat[0] *= -1;
                }
                return renderer;
            });
        }
        case 43: // Switch
        case 44: // Switch-powered Star
        case 45: // Switch-powered Trapdoor
        case 48: // Chain Chomp Unchained
        case 49: // 1-up
        case 50: // Cannon
        case 51: // Chain-chomp fence (BoB)
        case 52: // Water bombs (BoB)
        case 53: // Birds
        case 54: // Fish
        case 55: // Butterflies
        case 56: // Super Bob Fuckan Omb Bob-Omb In BoB (the summit)
        case 59: // Pirahna Plant
        case 60: // Star Camera Path
        case 61: // Star Target
            return null;
        case 62: // Silver Star
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/star/obj_star_silver.bmd`, translation, rotationY, 0.8, 0.08);
        case 63: // Star
            let filename = `normal_obj/star/obj_star.bmd`;
            let startype = (object.Parameters[0] >>> 4) & 0x0F;
            let rotateSpeed = 0.08;
            switch (startype)
            {
                case 0:
                    filename = `normal_obj/star/star_base.bmd`;
                    break;
                case 1:
                case 4:
                case 6:
                    filename = `normal_obj/star_box/star_box.bmd`;
                    rotateSpeed = 0;
                    break;
            }
            return this._createBMDObjRenderer(device, renderer, abortSignal, filename, translation, rotationY, 0.8, rotateSpeed);
        case 64: // Whomp
        case 65: // Big Whomp
        case 66: // Thwomp
        case 67: // Boo
        case 74: // Minigame Cabinet Trigger (Invisible)
            return null;
        case 75: // Wall sign
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_kanban/obj_kanban.bmd`, translation, rotationY, 0.8);
        case 76: // Signpost
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_tatefuda/obj_tatefuda.bmd`, translation, rotationY, 0.8);
        case 79: // Heart
        case 80: // Toad
        case 167: // Peach's Castle Tippy TTC Hour Hand
        case 168: // Peach's Castle Tippy TTC Minute Hand
        case 169: // Peach's Castle Tippy TTC Pendulum
            return null;
        case 187: // Left Arrow Sign
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_yajirusi_l/yajirusi_l.bmd`, translation, rotationY, 0.8);
        case 188: // Right Arrow Sign
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_yajirusi_r/yajirusi_r.bmd`, translation, rotationY, 0.8);
        case 196: // WF
        case 197: // WF
        case 198: // WF
        case 199: // WF
        case 200: // WF
        case 201: // WF
        case 202: // WF
        case 203: // WF Tower
            return null;
        case 204: // WF Spinning Island
            return this._createBMDObjRenderer(device, renderer, abortSignal, `special_obj/bk_ukisima/bk_ukisima.bmd`, translation, rotationY, 1, 0.05);
        case 205: // WF
        case 206: // WF
        case 207: // WF
        case 208: // WF
        case 209: // WF
        case 228: // Switch Pillar
        case 237: // MIPS
        case 239: // That Stupid Owl™
        case 243: // Invisible pole hitbox
        case 244: // Lakitu
        case 254: // Mario's Iconic Cap
        case 264: // Red Flame
        case 265: // Blue Flame
        case 269: // 1-Up Mushroom Inside Block
        case 270: // Some brick thing?
        case 273: // Peach's Castle First Floor Trapdoor
        case 274: // Peach's Castle First Floor Light Beam
        case 275: // Peach's Castle First Floor Peach/Bowser Fade Painting
        case 281: // Koopa the Quick
        case 282: // Koopa the Quick Finish Flag
            return null;
        case 284: // Wario Block
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/obj_block/broken_block_ll.bmd`, translation, rotationY);
        case 293: // Water
            return this._createBMDObjRenderer(device, renderer, abortSignal, `special_obj/mc_water/mc_water.bmd`, translation, rotationY, 0.8);
        case 295: // Metal net
            return this._createBMDObjRenderer(device, renderer, abortSignal, `special_obj/mc_metalnet/mc_metalnet.bmd`, translation, rotationY, 0.8);
        case 298: // Flag
            return this._createBMDObjRenderer(device, renderer, abortSignal, `special_obj/mc_flag/mc_flag.bmd`, translation, rotationY, 0.8);
        case 303: // Castle Basement Water
        case 304: // Secret number thingy
            return null;
        case 305: // Blue Coin Switch
            return this._createBMDObjRenderer(device, renderer, abortSignal, `normal_obj/b_coin_switch/b_coin_switch.bmd`, translation, rotationY, 0.8);
        case 314: // Hidden Pirahna Plant
        case 315: // Enemy spawner trigger
        case 316: // Enemy spawner
        case 323: // Ambient sound effects
        case 324: // Music
        case 511: // Appears to be a bug in the level layout
            return null;
        default:
            console.warn(`Unknown object type ${object.ObjectId}`);
            return null;
        }
    }

    private _createSceneFromCRG1(device: GfxDevice, textureHolder: NITROTextureHolder, crg1: Sm64DSCRG1, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const level = crg1.Levels[this.levelId];
        const modelCache = new ModelCache();

        const renderer = new SM64DSRenderer(device, modelCache, textureHolder);

        this._createBMDRenderer(device, renderer, abortSignal, level.MapBmdFile, GLOBAL_SCALE, level, false);

        if (level.VrboxBmdFile)
            this._createBMDRenderer(device, renderer, abortSignal, level.VrboxBmdFile, 0.8, level, true);

        for (let i = 0; i < level.Objects.length; i++)
            this._createBMDRendererForObject(device, renderer, abortSignal, level.Objects[i]);

        return modelCache.waitForLoad().then(() => {
            return renderer;
        });
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
