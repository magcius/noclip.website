
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
import { mat4, vec3 } from 'gl-matrix';

export class RetroSceneRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice, public mlvl: MLVL.MLVL, public textureHolder: RetroTextureHolder, public skyboxRenderer: CMDLRenderer | null, public areaRenderers: MREARenderer[]) {
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.addToViewRenderer(device, this.viewRenderer);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(hostAccessPass, viewerInput);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(hostAccessPass, viewerInput);
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
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
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
                const areas = mlvl.areaTable;
                const textureHolder = new RetroTextureHolder();
                let skyboxRenderer: CMDLRenderer = null;
                const skyboxCMDL = resourceSystem.loadAssetByID(mlvl.defaultSkyboxID, 'CMDL');
                if (skyboxCMDL) {
                    const skyboxName = resourceSystem.findResourceNameByID(mlvl.defaultSkyboxID);
                    skyboxRenderer = new CMDLRenderer(device, textureHolder, skyboxName, mat4.create(), skyboxCMDL);
                    skyboxRenderer.isSkybox = true;
                }
                const areaRenderers = areas.map((mreaEntry) => {
                    const mrea: MREA.MREA = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    return new MREARenderer(device, textureHolder, mreaEntry.areaName, mrea);
                });

                // By default, set only the first 10 area renderers to visible, so as to not "crash my browser please".
                areaRenderers.slice(10).forEach((areaRenderer) => {
                    areaRenderer.setVisible(false);
                });

                return new RetroSceneRenderer(device, mlvl, textureHolder, skyboxRenderer, areaRenderers);
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
