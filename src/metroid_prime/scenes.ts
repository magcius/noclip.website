
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceSystem, NameData } from './resource';
import { MREARenderer, RetroTextureHolder, CMDLRenderer, RetroPass } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { assert } from '../util';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as BYML from '../byml';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { mat4 } from 'gl-matrix';
import { GXRenderHelperGfx } from '../gx/gx_render';

export class RetroSceneRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;
    public areaRenderers: MREARenderer[] = [];
    public cmdlRenderers: CMDLRenderer[] = [];

    constructor(device: GfxDevice, public mlvl: MLVL.MLVL, public textureHolder = new RetroTextureHolder()) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(2, 75000);
        this.renderHelper.fillSceneParams(viewerInput);

        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(viewerInput);
        for (let i = 0; i < this.cmdlRenderers.length; i++)
            this.cmdlRenderers[i].prepareToRender(viewerInput);

        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        this.viewRenderer.prepareToRender(device);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, RetroPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, RetroPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].destroy(device);
        for (let i = 0; i < this.cmdlRenderers.length; i++)
            this.cmdlRenderers[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.areaRenderers);
        return [layersPanel];
    }
}

class MP1SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string) {
        this.id = filename;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const stringsPakP = fetchData(`metroid_prime/mp1/Strings.pak`, abortSignal);
        const levelPakP = fetchData(`metroid_prime/mp1/${this.filename}`, abortSignal);
        const nameDataP = fetchData(`metroid_prime/mp1/MP1_NameData.crg1`, abortSignal);
        return Progressable.all([levelPakP, stringsPakP, nameDataP]).then((datas: ArrayBufferSlice[]) => {
            const levelPak = PAK.parse(datas[0]);
            const stringsPak = PAK.parse(datas[1]);
            const nameData = BYML.parse<NameData>(datas[2], BYML.FileType.CRG1);
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
                    skyboxRenderer = new CMDLRenderer(device, renderer.renderHelper, renderer.textureHolder, null, skyboxName, mat4.create(), skyboxCMDL);
                    skyboxRenderer.isSkybox = true;
                    renderer.cmdlRenderers.push(skyboxRenderer);
                }

                for (let i = 0; i < areas.length; i++) {
                    const mreaEntry = areas[i];
                    const mrea: MREA.MREA = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    const areaRenderer = new MREARenderer(device, renderer.renderHelper, renderer.textureHolder, mreaEntry.areaName, mrea);
                    renderer.areaRenderers.push(areaRenderer);

                    // By default, set only the first 10 area renderers to visible, so as to not "crash my browser please".
                    areaRenderer.visible = (i < 1);
                }

                renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);
                return renderer;
            }

            return null;
        });
    }
}

const id = "mp1";
const name = "Metroid Prime 1";
const sceneDescs: Viewer.SceneDesc[] = [
    new MP1SceneDesc(`Metroid1.pak`, "Space Pirate Frigate"),
    new MP1SceneDesc(`Metroid2.pak`, "Chozo Ruins"),
    new MP1SceneDesc(`Metroid3.pak`, "Phendrana Drifts"),
    new MP1SceneDesc(`Metroid4.pak`, "Tallon Overworld"),
    new MP1SceneDesc(`Metroid5.pak`, "Phazon Mines"),
    new MP1SceneDesc(`Metroid6.pak`, "Magmoor Caverns"),
    new MP1SceneDesc(`Metroid7.pak`, "Impact Crater"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
