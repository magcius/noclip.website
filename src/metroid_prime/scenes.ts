import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { MaterialSet } from './mrea';
import { ResourceGame, ResourceSystem } from './resource';
import { CMDLData, CMDLRenderer, ModelCache, MREARenderer, RetroPass } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { GroupLayerPanel } from './ui';
import { assert, assertExists } from '../util';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { mat4 } from 'gl-matrix';
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx, GXTextureHolder } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import { CameraController } from '../Camera';
import BitMap, { bitMapDeserialize, bitMapGetSerializedByteLength, bitMapSerialize } from '../BitMap';
import { CMDL } from './cmdl';
import { colorNewCopy, OpaqueBlack } from '../Color';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { executeOnPass } from '../gfx/render/GfxRenderInstManager';
import { Vec3One } from '../MathHelpers';
import { parseMP1Tweaks, parseMP2Tweaks } from './tweaks';
import { GeneratorMaterialHelpers } from './particles/base_generator';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { TXTR } from './txtr';

function layerVisibilitySyncToBitMap(layers: UI.Layer[], b: BitMap): void {
    for (let i = 0; i < layers.length; i++)
        b.setBit(i, layers[i].visible);
}

function layerVisibilitySyncFromBitMap(layers: UI.Layer[], b: BitMap): void {
    assert(b.numBits === layers.length);
    for (let i = 0; i < layers.length; i++)
        layers[i].setVisible(b.getBit(i));
}

export class RetroSceneRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public renderCache: GfxRenderCache;
    public modelCache = new ModelCache();
    public textureHolder = new GXTextureHolder<TXTR>();
    public generatorMaterialHelpers = new GeneratorMaterialHelpers();
    public areaRenderers: MREARenderer[] = [];
    public defaultSkyRenderer: CMDLRenderer | null = null;
    public worldAmbientColor = colorNewCopy(OpaqueBlack);
    public showAllActors: boolean = false;
    private showAllActorsCheckbox: UI.Checkbox;
    public enableAnimations: boolean = true;
    private enableAnimationsCheckbox: UI.Checkbox;
    public enableParticles: boolean = true;
    private enableParticlesCheckbox: UI.Checkbox;
    public suitModel: number = 0;
    private suitModelButtons: UI.RadioButtons;
    private groupLayerPanel: GroupLayerPanel;

    public onstatechanged!: () => void;

    constructor(public device: GfxDevice, public mlvl: MLVL.MLVL, public game: ResourceGame) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.renderCache = this.renderHelper.getCache();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.01);
    }

    private prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        viewerInput.camera.setClipPlanes(0.2);
        fillSceneParamsDataOnTemplate(template, viewerInput, 0);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(this, viewerInput);
        this.prepareToRenderSkybox(viewerInput);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    private prepareToRenderSkybox(viewerInput: Viewer.ViewerRenderInput): void {
        // Pick an active skybox and render it...

        let skybox: CMDLRenderer | null = null;
        for (let i = 0; i < this.areaRenderers.length; i++) {
            if (this.areaRenderers[i].visible && this.areaRenderers[i].needSky) {
                if (this.areaRenderers[i].overrideSky !== null)
                    skybox = this.areaRenderers[i].overrideSky;
                else
                    skybox = this.defaultSkyRenderer;
                break;
            }
        }

        if (skybox !== null)
            skybox.prepareToRender(this, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        assert(device === this.device);
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, passRenderer, RetroPass.SKYBOX);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, passRenderer, RetroPass.MAIN);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy();
        this.modelCache.destroy(device);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].destroy(device);
    }

    public setShowAllActors(enabled: boolean) {
        this.showAllActors = enabled;
        this.onstatechanged();
    }

    public setEnableAnimations(enabled: boolean) {
        this.enableAnimations = enabled;
        this.onstatechanged();
    }

    public setEnableParticles(enabled: boolean) {
        this.enableParticles = enabled;
        this.onstatechanged();
    }

    private _setSuitModel(index: number) {
        this.suitModel = index;
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].setSuitModel(index);
    }

    public setSuitModel(index: number) {
        this._setSuitModel(index);
        this.onstatechanged();
    }

    private createRenderHacksPanel(): UI.Panel {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        this.showAllActorsCheckbox = new UI.Checkbox('Show All Actors');
        this.showAllActorsCheckbox.onchanged = () => {
            this.setShowAllActors(this.showAllActorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(this.showAllActorsCheckbox.elem);

        this.enableAnimationsCheckbox = new UI.Checkbox('Enable Animations');
        this.enableAnimationsCheckbox.onchanged = () => {
            this.setEnableAnimations(this.enableAnimationsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(this.enableAnimationsCheckbox.elem);

        this.enableParticlesCheckbox = new UI.Checkbox('Enable Particles');
        this.enableParticlesCheckbox.onchanged = () => {
            this.setEnableParticles(this.enableParticlesCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(this.enableParticlesCheckbox.elem);

        if (this.game === ResourceGame.MP1 || this.game === ResourceGame.MP2) {
            this.suitModelButtons = new UI.RadioButtons('Suit Model',
                this.game === ResourceGame.MP2 ? ['Varia', 'Dark', 'Light'] : ['Power', 'Gravity', 'Varia', 'Phazon']);
            this.suitModelButtons.onselectedchange = () => {
                this.setSuitModel(this.suitModelButtons.selectedIndex);
            };
            renderHacksPanel.contents.appendChild(this.suitModelButtons.elem);
        }

        return renderHacksPanel;
    }

    public createPanels(): UI.Panel[] {
        this.groupLayerPanel = new GroupLayerPanel(this.areaRenderers);
        this.groupLayerPanel.layerPanel.onlayertoggled = () => {
            this.onstatechanged();
        };
        return [this.groupLayerPanel, this.createRenderHacksPanel()];
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        const b = new BitMap(this.areaRenderers.length);
        layerVisibilitySyncToBitMap(this.areaRenderers, b);
        offs = bitMapSerialize(view, offs, b);
        view.setUint8(offs, this.showAllActors ? 1 : 0);
        offs += 1;
        view.setUint8(offs, this.suitModel);
        offs += 1;
        view.setUint8(offs, this.enableAnimations ? 1 : 0);
        offs += 1;
        view.setUint8(offs, this.enableParticles ? 1 : 0);
        offs += 1;
        return offs;
    }

    public deserializeSaveState(src: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(src);
        const numBytes = bitMapGetSerializedByteLength(this.areaRenderers.length);
        if (offs + numBytes <= byteLength) {
            const b = new BitMap(this.areaRenderers.length);
            offs = bitMapDeserialize(view, offs, b);
            layerVisibilitySyncFromBitMap(this.areaRenderers, b);
            this.groupLayerPanel.layerPanel.syncLayerVisibility();
        }

        if (offs + 1 <= byteLength) {
            this.showAllActors = view.getUint8(offs) !== 0;
            offs += 1;
        }
        this.showAllActorsCheckbox.setChecked(this.showAllActors);

        if (this.game === ResourceGame.MP1 || this.game === ResourceGame.MP2) {
            if (offs + 1 <= byteLength) {
                this._setSuitModel(view.getUint8(offs));
                offs += 1;
            } else {
                this._setSuitModel(this.game === ResourceGame.MP1 ? 2 : 0);
            }
            this.suitModelButtons.setSelectedIndex(this.suitModel);
        }

        if (offs + 1 <= byteLength) {
            this.enableAnimations = view.getUint8(offs) !== 0;
            offs += 1;
        }
        this.enableAnimationsCheckbox.setChecked(this.enableAnimations);

        if (offs + 1 <= byteLength) {
            this.enableParticles = view.getUint8(offs) !== 0;
            offs += 1;
        }
        this.enableParticlesCheckbox.setChecked(this.enableParticles);

        return offs;
    }

    public getCMDLData(cmdl: CMDL): CMDLData {
        return this.modelCache.getCMDLData(this, cmdl);
    }

    public addTextures(textures: TXTR[]): void {
        this.textureHolder.addTextures(this.device, textures);
    }

    public addMaterialSetTextures(materialSet: MaterialSet): void {
        this.addTextures(materialSet.textures);
    }
}

class RetroSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public filename: string, public game: ResourceGame, public gameCompressionMethod: PAK.CompressionMethod,
                public name: string, public worldName: string = '') {
        this.id = worldName ? worldName : filename;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const levelPak = PAK.parse(await dataFetcher.fetchData(`metroid_prime/${this.filename}`), this.gameCompressionMethod);
        const paks = [levelPak];
        if (this.game === ResourceGame.MP1) {
            paks.push(PAK.parse(await dataFetcher.fetchData(`metroid_prime/mp1/Tweaks.pak`), this.gameCompressionMethod));
            paks.push(PAK.parse(await dataFetcher.fetchData(`metroid_prime/mp1/TestAnim.pak`), this.gameCompressionMethod));
        } else if (this.game === ResourceGame.MP2) {
            paks.push(PAK.parse(await dataFetcher.fetchData(`metroid_prime/mp2/TestAnim.pak`), this.gameCompressionMethod));
        }
        const resourceSystem = new ResourceSystem(this.game, paks);

        let tweaks = null;
        if (this.game === ResourceGame.MP1)
            tweaks = parseMP1Tweaks(resourceSystem);
        else if (this.game === ResourceGame.MP2)
            tweaks = parseMP2Tweaks(resourceSystem);

        for (const mlvlEntry of levelPak.namedResourceTable.values()) {
            assert(mlvlEntry.fourCC === 'MLVL');

            if (this.worldName !== '' && this.worldName !== mlvlEntry.name) {
                continue;
            }

            const mlvl: MLVL.MLVL = assertExists(resourceSystem.loadAssetByID<MLVL.MLVL>(mlvlEntry.fileID, mlvlEntry.fourCC));

            const renderer = new RetroSceneRenderer(device, mlvl, this.game);

            const areas = mlvl.areaTable;
            const defaultSkyboxCMDL = resourceSystem.loadAssetByID<CMDL>(mlvl.defaultSkyboxID, 'CMDL');
            if (defaultSkyboxCMDL) {
                const defaultSkyboxName = resourceSystem.findResourceNameByID(mlvl.defaultSkyboxID);
                const defaultSkyboxCMDLData = renderer.getCMDLData(defaultSkyboxCMDL);
                const modelMatrix = mat4.create();
                const defaultSkyboxRenderer = new CMDLRenderer(renderer, null, defaultSkyboxName, modelMatrix, modelMatrix, Vec3One, defaultSkyboxCMDLData, null);
                defaultSkyboxRenderer.isSkybox = true;
                renderer.defaultSkyRenderer = defaultSkyboxRenderer;
            }

            for (let i = 0; i < areas.length; i++) {
                const mreaEntry = areas[i];
                const mrea = resourceSystem.loadAssetByID<MREA.MREA>(mreaEntry.areaMREAID, 'MREA');

                if (mrea !== null && mreaEntry.areaName.indexOf('worldarea') === -1) {
                    const areaRenderer = new MREARenderer(renderer, mreaEntry.areaName, mrea, resourceSystem, tweaks);
                    renderer.areaRenderers.push(areaRenderer);

                    // By default, set only the first area renderer is visible, so as to not "crash my browser please".
                    areaRenderer.visible = (renderer.areaRenderers.length === 1);
                }
            }

            return renderer;
        }

        throw 'whoops';
    }
}

const idMP1 = 'mp1';
const nameMP1 = 'Metroid Prime';
const compressionMP1 = PAK.CompressionMethod.ZLIB;
const sceneDescsMP1: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp1/Metroid1.pak`, ResourceGame.MP1, compressionMP1, 'Space Pirate Frigate'),
    new RetroSceneDesc(`mp1/Metroid2.pak`, ResourceGame.MP1, compressionMP1, 'Chozo Ruins'),
    new RetroSceneDesc(`mp1/Metroid3.pak`, ResourceGame.MP1, compressionMP1, 'Phendrana Drifts'),
    new RetroSceneDesc(`mp1/Metroid4.pak`, ResourceGame.MP1, compressionMP1, 'Tallon Overworld'),
    new RetroSceneDesc(`mp1/Metroid5.pak`, ResourceGame.MP1, compressionMP1, 'Phazon Mines'),
    new RetroSceneDesc(`mp1/Metroid6.pak`, ResourceGame.MP1, compressionMP1, 'Magmoor Caverns'),
    new RetroSceneDesc(`mp1/Metroid7.pak`, ResourceGame.MP1, compressionMP1, 'Impact Crater'),
];

export const sceneGroupMP1: Viewer.SceneGroup = { id: idMP1, name: nameMP1, sceneDescs: sceneDescsMP1 };

const idMP2 = 'mp2';
const nameMP2 = 'Metroid Prime 2: Echoes';
const compressionMP2 = PAK.CompressionMethod.LZO;
const sceneDescsMP2: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp2/Metroid1.pak`, ResourceGame.MP2, compressionMP2, 'Temple Grounds'),
    new RetroSceneDesc(`mp2/Metroid2.pak`, ResourceGame.MP2, compressionMP2, 'Great Temple'),
    new RetroSceneDesc(`mp2/Metroid3.pak`, ResourceGame.MP2, compressionMP2, 'Agon Wastes'),
    new RetroSceneDesc(`mp2/Metroid4.pak`, ResourceGame.MP2, compressionMP2, 'Torvus Bog'),
    new RetroSceneDesc(`mp2/Metroid5.pak`, ResourceGame.MP2, compressionMP2, 'Sanctuary Fortress'),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, 'Multiplayer - Sidehopper Station', 'M01_SidehopperStation'),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, 'Multiplayer - Spires', 'M02_Spires'),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, 'Multiplayer - Crossfire Chaos', 'M03_CrossfireChaos'),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, 'Multiplayer - Pipeline', 'M04_Pipeline'),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, 'Multiplayer - Spider Complex', 'M05_SpiderComplex'),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, 'Multiplayer - Shooting Gallery', 'M06_ShootingGallery'),
];

export const sceneGroupMP2: Viewer.SceneGroup = { id: idMP2, name: nameMP2, sceneDescs: sceneDescsMP2 };

const idMP3 = 'mp3';
const nameMP3 = 'Metroid Prime 3: Corruption';
const compressionMP3 = PAK.CompressionMethod.CMPD_LZO;
const sceneDescsMP3: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp3/Metroid1.pak`, ResourceGame.MP3, compressionMP3, 'G.F.S. Olympus', '01a_GFShip_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid1.pak`, ResourceGame.MP3, compressionMP3, 'Norion', '01b_GFPlanet_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid1.pak`, ResourceGame.MP3, compressionMP3, 'G.F.S. Valhalla', '01c_Abandoned_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid3.pak`, ResourceGame.MP3, compressionMP3, 'Bryyo Cliffside', '03a_Bryyo_Reptilicus_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid3.pak`, ResourceGame.MP3, compressionMP3, 'Bryyo Fire', '03b_Bryyo_Fire_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid3.pak`, ResourceGame.MP3, compressionMP3, 'Bryyo Ice', '03c_Bryyo_Ice_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid4.pak`, ResourceGame.MP3, compressionMP3, 'SkyTown, Elysia', '04a_Skytown_Main_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid4.pak`, ResourceGame.MP3, compressionMP3, 'Eastern SkyTown, Elysia', '04b_Skytown_Pod_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid5.pak`, ResourceGame.MP3, compressionMP3, 'Pirate Research', '05a_Pirate_Research_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid5.pak`, ResourceGame.MP3, compressionMP3, 'Pirate Command', '05b_Pirate_Command_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid5.pak`, ResourceGame.MP3, compressionMP3, 'Pirate Mines', '05c_Pirate_Mines_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid6.pak`, ResourceGame.MP3, compressionMP3, 'Phaaze', '06_Phaaze_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid7.pak`, ResourceGame.MP3, compressionMP3, 'Bryyo Seed', '03d_Bryyo_Seed_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid7.pak`, ResourceGame.MP3, compressionMP3, 'Elysia Seed', '04c_Skytown_Seed_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid7.pak`, ResourceGame.MP3, compressionMP3, 'Pirate Homeworld Seed', '05d_Pirate_Seed_#SERIAL#'),
    new RetroSceneDesc(`mp3/Metroid8.pak`, ResourceGame.MP3, compressionMP3, 'Space', '08_Space_#SERIAL#')
];

export const sceneGroupMP3: Viewer.SceneGroup = { id: idMP3, name: nameMP3, sceneDescs: sceneDescsMP3 };
