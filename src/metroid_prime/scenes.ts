
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceSystem, NameData } from './resource';
import { MREARenderer, RetroTextureHolder, CMDLRenderer, RetroPass, ModelCache } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { assert } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as BYML from '../byml';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { mat4 } from 'gl-matrix';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import { FPSCameraController } from '../Camera';
import { DataFetcherFlags } from '../DataFetcher';
import BitMap, { bitMapSerialize, bitMapDeserialize } from '../BitMap';
import { CMDL } from './cmdl';
import { colorNewCopy, OpaqueBlack } from '../Color';

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
    public renderTarget = new BasicRenderTarget();
    public modelCache = new ModelCache();
    public areaRenderers: MREARenderer[] = [];
    public defaultSkyRenderer: CMDLRenderer | null = null;
    public worldAmbientColor = colorNewCopy(OpaqueBlack);
    private layersPanel: UI.LayerPanel;

    constructor(device: GfxDevice, public mlvl: MLVL.MLVL, public textureHolder = new RetroTextureHolder()) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createCameraController() {
        const controller = new FPSCameraController();
        controller.sceneKeySpeedMult = 0.1;
        return controller;
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        viewerInput.camera.setClipPlanes(0.2);
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(device, this.renderHelper, viewerInput, this.worldAmbientColor);
        this.prepareToRenderSkybox(device, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    private prepareToRenderSkybox(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
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
            skybox.prepareToRender(device, this.renderHelper, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.setVisibleByFilterKeyExact(RetroPass.SKYBOX);
        renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.setVisibleByFilterKeyExact(RetroPass.MAIN);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].destroy(device);
        if (this.defaultSkyRenderer !== null)
            this.defaultSkyRenderer.destroy(device);
    }

    public createPanels(): UI.Panel[] {
        this.layersPanel = new UI.LayerPanel(this.areaRenderers);
        return [this.layersPanel];
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        const b = new BitMap(this.areaRenderers.length);
        layerVisibilitySyncToBitMap(this.areaRenderers, b);
        offs = bitMapSerialize(view, offs, b);
        return offs;
    }

    public deserializeSaveState(src: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(src);
        const numBytes = (this.areaRenderers.length + 7) >>> 3;
        if (offs + numBytes <= byteLength) {
            const b = new BitMap(this.areaRenderers.length);
            offs = bitMapDeserialize(view, offs, b);
            layerVisibilitySyncFromBitMap(this.areaRenderers, b);
            this.layersPanel.syncLayerVisibility();
        }
        return offs;
    }
}

class RetroSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string, public worldName: string = "") {
        this.id = filename;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const folder = this.id.substring(0, this.id.indexOf(`/`));
        const levelPakP = dataFetcher.fetchData(`metroid_prime/${this.filename}`);
        const nameDataP = dataFetcher.fetchData(`metroid_prime/mp1/MP1_NameData.crg1`, DataFetcherFlags.ALLOW_404);

        return Promise.all([levelPakP, nameDataP]).then((datas: ArrayBufferSlice[]) => {
            const levelPak = PAK.parse(datas[0]);
            const nameData = (datas[1] != null ? BYML.parse<NameData>(datas[1], BYML.FileType.CRG1) : null);
            const resourceSystem = new ResourceSystem([levelPak], nameData);

            for (const mlvlEntry of levelPak.namedResourceTable.values()) {
                assert(mlvlEntry.fourCC === 'MLVL');
                if (this.worldName !== "" && this.worldName !== mlvlEntry.name) {
                    continue;
                }

                const mlvl: MLVL.MLVL = resourceSystem.loadAssetByID<MLVL.MLVL>(mlvlEntry.fileID, mlvlEntry.fourCC);

                const renderer = new RetroSceneRenderer(device, mlvl);
                const cache = renderer.renderHelper.getCache();

                const areas = mlvl.areaTable;
                const defaultSkyboxCMDL = resourceSystem.loadAssetByID<CMDL>(mlvl.defaultSkyboxID, 'CMDL');
                if (defaultSkyboxCMDL) {
                    const defaultSkyboxName = resourceSystem.findResourceNameByID(mlvl.defaultSkyboxID);
                    const defaultSkyboxCMDLData = renderer.modelCache.getCMDLData(device, cache, defaultSkyboxCMDL);
                    const defaultSkyboxRenderer = new CMDLRenderer(device, renderer.textureHolder, null, defaultSkyboxName, mat4.create(), defaultSkyboxCMDLData);
                    defaultSkyboxRenderer.isSkybox = true;
                    renderer.defaultSkyRenderer = defaultSkyboxRenderer;
                }

                for (let i = 0; i < areas.length; i++) {
                    const mreaEntry = areas[i];
                    const mrea: MREA.MREA = resourceSystem.loadAssetByID<MREA.MREA>(mreaEntry.areaMREAID, 'MREA');

                    if (mrea !== null && mreaEntry.areaName.indexOf("worldarea") === -1) {
                        const areaRenderer = new MREARenderer(device, renderer.modelCache, cache, renderer.textureHolder, mreaEntry.areaName, mrea);
                        renderer.areaRenderers.push(areaRenderer);

                        // By default, set only the first area renderer is visible, so as to not "crash my browser please".
                        areaRenderer.visible = (renderer.areaRenderers.length === 1);
                    }
                }

                return renderer;
            }

            return null;
        });
    }
}

const idMP1 = "mp1";
const nameMP1 = "Metroid Prime";
const sceneDescsMP1: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp1/Metroid1.pak`, "Space Pirate Frigate"),
    new RetroSceneDesc(`mp1/Metroid2.pak`, "Chozo Ruins"),
    new RetroSceneDesc(`mp1/Metroid3.pak`, "Phendrana Drifts"),
    new RetroSceneDesc(`mp1/Metroid4.pak`, "Tallon Overworld"),
    new RetroSceneDesc(`mp1/Metroid5.pak`, "Phazon Mines"),
    new RetroSceneDesc(`mp1/Metroid6.pak`, "Magmoor Caverns"),
    new RetroSceneDesc(`mp1/Metroid7.pak`, "Impact Crater"),
];

export const sceneGroupMP1: Viewer.SceneGroup = { id: idMP1, name: nameMP1, sceneDescs: sceneDescsMP1 };


const idMP2 = "mp2";
const nameMP2 = "Metroid Prime 2: Echoes";
const sceneDescsMP2: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp2/Metroid1.pak`, "Temple Grounds"),
    new RetroSceneDesc(`mp2/Metroid2.pak`, "Great Temple"),
    new RetroSceneDesc(`mp2/Metroid3.pak`, "Agon Wastes"),
    new RetroSceneDesc(`mp2/Metroid4.pak`, "Torvus Bog"),
    new RetroSceneDesc(`mp2/Metroid5.pak`, "Sanctuary Fortress"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer - Sidehopper Station", "M01_SidehopperStation"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer - Spires", "M02_Spires"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer - Crossfire Chaos", "M03_CrossfireChaos"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer - Pipeline", "M04_Pipeline"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer - Spider Complex", "M05_SpiderComplex"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer - Shooting Gallery", "M06_ShootingGallery"),
];

export const sceneGroupMP2: Viewer.SceneGroup = { id: idMP2, name: nameMP2, sceneDescs: sceneDescsMP2 };

const idMP3 = "mp3";
const nameMP3 = "Metroid Prime 3: Corruption";
const sceneDescsMP3: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp3/Metroid1.pak`, "G.F.S. Olympus", "01a_GFShip_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid1.pak`, "Norion", "01b_GFPlanet_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid1.pak`, "G.F.S. Valhalla", "01c_Abandoned_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid3.pak`, "Bryyo Cliffside", "03a_Bryyo_Reptilicus_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid3.pak`, "Bryyo Fire", "03b_Bryyo_Fire_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid3.pak`, "Bryyo Ice", "03c_Bryyo_Ice_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid4.pak`, "SkyTown, Elysia", "04a_Skytown_Main_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid4.pak`, "Eastern SkyTown, Elysia", "04b_Skytown_Pod_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid5.pak`, "Pirate Research", "05a_Pirate_Research_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid5.pak`, "Pirate Command", "05b_Pirate_Command_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid5.pak`, "Pirate Mines", "05c_Pirate_Mines_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid6.pak`, "Phaaze", "06_Phaaze_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid7.pak`, "Bryyo Seed", "03d_Bryyo_Seed_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid7.pak`, "Elysia Seed", "04c_Skytown_Seed_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid7.pak`, "Pirate Homeworld Seed", "05d_Pirate_Seed_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid8.pak`, "Space", "08_Space_#SERIAL#")
];

export const sceneGroupMP3: Viewer.SceneGroup = { id: idMP3, name: nameMP3, sceneDescs: sceneDescsMP3 };
