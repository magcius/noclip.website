
import * as Viewer from '../viewer';
import * as Yaz0 from '../compression/Yaz0';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';

import * as SARC from './sarc';
import * as BFRES from './bfres';
import { GX2TextureHolder, FMDLRenderer, FMDLData } from './render';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, depthClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { SceneContext } from '../SceneBase';
import { deswizzler } from './gx2_texture';

enum SplatoonPass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

class SplatoonRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    public textureHolder = new GX2TextureHolder();

    public fmdlData: FMDLData[] = [];
    public fmdlRenderers: FMDLRenderer[] = [];

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SplatoonPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, SplatoonPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);

        for (let i = 0; i < this.fmdlData.length; i++)
            this.fmdlData[i].destroy(device);
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].destroy(device);

        deswizzler.terminate();
    }
}

class SplatoonSceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const renderer = new SplatoonRenderer();
        const dataFetcher = context.dataFetcher;

        return Promise.all([
            this._createRenderersFromPath(device, renderer, `spl/${this.path}`, false, dataFetcher),
            this._createRenderersFromPath(device, renderer, 'spl/VR_SkyDayCumulonimbus.szs', true, dataFetcher),
        ]).then(() => {
            return renderer;
        });
    }

    private _createRenderersFromPath(device: GfxDevice, renderer: SplatoonRenderer, path: string, isSkybox: boolean, dataFetcher: DataFetcher): Promise<void> {
        const textureHolder = renderer.textureHolder;

        return dataFetcher.fetchData(path).then((result: ArrayBufferSlice) => {
            return Yaz0.decompress(result);
        }).then((result: ArrayBufferSlice) => {
            const sarc = SARC.parse(result);
            const file = sarc.files.find((file) => file.name.endsWith('.bfres'));
            const fres = BFRES.parse(file.buffer);

            textureHolder.addFRESTextures(device, fres);

            for (let i = 0; i < fres.fmdl.length; i++) {
                const fmdl = fres.fmdl[i];

                // _drcmap is the map used for the Gamepad. It does nothing but cause Z-fighting.
                if (fmdl.name.endsWith('_drcmap'))
                    continue;

                // "_DV" seems to be the skybox. There are additional models which are powered
                // by skeleton animation, which we don't quite support yet. Kill them for now.
                if (fmdl.name.indexOf('_DV_') !== -1)
                    continue;

                const fmdlData = new FMDLData(device, fmdl);
                renderer.fmdlData.push(fmdlData);
                const fmdlRenderer = new FMDLRenderer(device, textureHolder, fmdlData);
                fmdlRenderer.isSkybox = isSkybox;
                fmdlRenderer.passMask = isSkybox ? SplatoonPass.SKYBOX : SplatoonPass.MAIN;
                fmdlRenderer.addToViewRenderer(device, renderer.viewRenderer);
                renderer.fmdlRenderers.push(fmdlRenderer);
            }
        });
    }
}

// Splatoon Models
const name = "Splatoon";
const id = "splatoon";
const sceneDescs: SplatoonSceneDesc[] = [
    new SplatoonSceneDesc('Inkopolis Plaza', 'Fld_Plaza00.szs'),
    new SplatoonSceneDesc('Inkopolis Plaza Lobby', 'Fld_PlazaLobby.szs'),
    new SplatoonSceneDesc('Ancho-V Games', 'Fld_Office00.szs'),
    new SplatoonSceneDesc('Arrowana Mall', 'Fld_UpDown00.szs'),
    new SplatoonSceneDesc('Blackbelly Skatepark', 'Fld_SkatePark00.szs'),
    new SplatoonSceneDesc('Bluefin Depot', 'Fld_Ruins00.szs'),
    new SplatoonSceneDesc('Camp Triggerfish', 'Fld_Athletic00.szs'),
    new SplatoonSceneDesc('Flounder Heights', 'Fld_Jyoheki00.szs'),
    new SplatoonSceneDesc('Hammerhead Bridge', 'Fld_Kaisou00.szs'),
    new SplatoonSceneDesc('Kelp Dome', 'Fld_Maze00.szs'),
    new SplatoonSceneDesc('Mahi-Mahi Resort', 'Fld_Hiagari00.szs'),
    new SplatoonSceneDesc('Moray Towers', 'Fld_Tuzura00.szs'),
    new SplatoonSceneDesc('Museum d\'Alfonsino', 'Fld_Pivot00.szs'),
    new SplatoonSceneDesc('Pirahna Pit', 'Fld_Quarry00.szs'),
    new SplatoonSceneDesc('Port Mackerel', 'Fld_Amida00.szs'),
    new SplatoonSceneDesc('Saltspray Rig', 'Fld_SeaPlant00.szs'),
    new SplatoonSceneDesc('Urchin Underpass (New)', 'Fld_Crank01.szs'),
    new SplatoonSceneDesc('Urchin Underpass (Old)', 'Fld_Crank00.szs'),
    new SplatoonSceneDesc('Walleye Warehouse', 'Fld_Warehouse00.szs'),
    new SplatoonSceneDesc('Octo Valley', 'Fld_World00.szs'),
    new SplatoonSceneDesc('Object: Tree', 'Obj_Tree02.szs'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
