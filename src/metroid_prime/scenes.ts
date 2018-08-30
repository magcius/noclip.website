
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceSystem, NameData } from './resource';
import { MREARenderer, RetroTextureHolder, CMDLRenderer } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { assert } from '../util';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import { RenderState, depthClearFlags } from '../render';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as BYML from '../byml';

export class MetroidPrimeWorldScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];

    constructor(public mlvl: MLVL.MLVL, public textureHolder: RetroTextureHolder, public skyboxRenderer: CMDLRenderer, public areaRenderers: MREARenderer[]) {
        this.textures = textureHolder.viewerTextures;
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.areaRenderers);
        return [layersPanel];
    }

    public render(state: RenderState) {
        const gl = state.gl;

        if (this.skyboxRenderer)
            this.skyboxRenderer.render(state);

        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.areaRenderers.forEach((areaRenderer) => {
            areaRenderer.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textureHolder.destroy(gl);
        if (this.skyboxRenderer)
            this.skyboxRenderer.destroy(gl);
        this.areaRenderers.forEach((areaRenderer) => areaRenderer.destroy(gl));
    }
}

class MP1SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string) {
        this.id = filename;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const stringsPakP = fetchData(`data/metroid_prime/mp1/Strings.pak`);
        const levelPakP = fetchData(`data/metroid_prime/mp1/${this.filename}`);
        const nameDataP = fetchData(`data/metroid_prime/mp1/MP1_NameData.crg1`);
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
                let skyboxRenderer = null;
                const skyboxCMDL = resourceSystem.loadAssetByID(mlvl.defaultSkyboxID, 'CMDL');
                if (skyboxCMDL) {
                    const skyboxName = resourceSystem.findResourceNameByID(mlvl.defaultSkyboxID);
                    skyboxRenderer = new CMDLRenderer(gl, textureHolder, skyboxName, skyboxCMDL);
                    skyboxRenderer.isSkybox = true;
                }
                const areaRenderers = areas.map((mreaEntry) => {
                    const mrea: MREA.MREA = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    return new MREARenderer(gl, textureHolder, mreaEntry.areaName, mrea);
                });

                // By default, set only the first 10 area renderers to visible, so as to not "crash my browser please".
                areaRenderers.slice(10).forEach((areaRenderer) => {
                    areaRenderer.visible = false;
                });

                return new MetroidPrimeWorldScene(mlvl, textureHolder, skyboxRenderer, areaRenderers);
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
