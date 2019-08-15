
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceSystem, NameData } from './resource';
import { MREARenderer, RetroTextureHolder, CMDLRenderer, RetroPass, CMDLData } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { assert } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as BYML from '../byml';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { mat4 } from 'gl-matrix';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import { FPSCameraController } from '../Camera';
import { DataFetcherFlags } from '../DataFetcher';

export class RetroSceneRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public renderTarget = new BasicRenderTarget();
    public areaRenderers: MREARenderer[] = [];
    public cmdlRenderers: CMDLRenderer[] = [];
    public cmdlData: CMDLData[] = [];

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
        viewerInput.camera.setClipPlanes(0.2, 750);
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(device, this.renderHelper, viewerInput);
        for (let i = 0; i < this.cmdlRenderers.length; i++)
            this.cmdlRenderers[i].prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
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
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].destroy(device);
        for (let i = 0; i < this.cmdlRenderers.length; i++)
            this.cmdlRenderers[i].destroy(device);
        for (let i = 0; i < this.cmdlData.length; i++)
            this.cmdlData[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.areaRenderers);
        return [layersPanel];
    }
}

class RetroSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string) {
        this.id = filename;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const folder = this.id.substring(0, this.id.indexOf(`/`));
        const stringsPakP = dataFetcher.fetchData(`metroid_prime/${folder}/Strings.pak`);
        const levelPakP = dataFetcher.fetchData(`metroid_prime/${this.filename}`);
        const nameDataP = dataFetcher.fetchData(`metroid_prime/mp1/MP1_NameData.crg1`, DataFetcherFlags.ALLOW_404);

        return Promise.all([levelPakP, stringsPakP, nameDataP]).then((datas: ArrayBufferSlice[]) => {
            const levelPak = PAK.parse(datas[0]);
            const stringsPak = PAK.parse(datas[1]);
            const nameData = (datas[2] != null ? BYML.parse<NameData>(datas[2], BYML.FileType.CRG1) : null);
            const resourceSystem = new ResourceSystem([levelPak, stringsPak], nameData);

            for (const mlvlEntry of levelPak.namedResourceTable.values()) {
                assert(mlvlEntry.fourCC === 'MLVL');
                const mlvl: MLVL.MLVL = resourceSystem.loadAssetByID(mlvlEntry.fileID, mlvlEntry.fourCC);

                const renderer = new RetroSceneRenderer(device, mlvl);

                const areas = mlvl.areaTable;
                let skyboxRenderer: CMDLRenderer = null;
                const skyboxCMDL = resourceSystem.loadAssetByID(mlvl.defaultSkyboxID, 'CMDL');
                if (skyboxCMDL) {
                    const skyboxName = resourceSystem.findResourceNameByID(mlvl.defaultSkyboxID);
                    const skyboxCMDLData = new CMDLData(device, renderer.renderHelper, skyboxCMDL);
                    renderer.cmdlData.push(skyboxCMDLData);
                    skyboxRenderer = new CMDLRenderer(device, renderer.renderHelper, renderer.textureHolder, null, skyboxName, mat4.create(), skyboxCMDLData);
                    skyboxRenderer.isSkybox = true;
                    renderer.cmdlRenderers.push(skyboxRenderer);
                }

                for (let i = 0; i < areas.length; i++) {
                    const mreaEntry = areas[i];
                    const mrea: MREA.MREA = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    const areaRenderer = new MREARenderer(device, renderer.renderHelper, renderer.textureHolder, mreaEntry.areaName, mrea);
                    renderer.areaRenderers.push(areaRenderer);

                    // By default, set only the first area renderer is visible, so as to not "crash my browser please".
                    areaRenderer.visible = (i < 1);
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
    new RetroSceneDesc(`mp2/metroid5.pak`, "Sanctuary Fortress"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, "Multiplayer"),
];

export const sceneGroupMP2: Viewer.SceneGroup = { id: idMP2, name: nameMP2, sceneDescs: sceneDescsMP2 };