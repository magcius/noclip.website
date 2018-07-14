
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceSystem, NameData } from './resource';
import { MREARenderer, RetroTextureHolder } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { fetch, assert } from '../util';
import Progressable from 'Progressable';
import { RenderState } from '../render';
import ArrayBufferSlice from 'ArrayBufferSlice';
import * as BYML from 'byml';

// PAK Files are too big for GitHub.
function findPakBase() {
    if (document.location.protocol === 'file:') {
        return `data/metroid_prime/mp1/`;
    } else {
        return `https://funny.computer/cloud/MetroidPrime1/`;
    }
}

const pakBase = findPakBase();

export class MetroidPrimeWorldScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];

    constructor(public mlvl: MLVL.MLVL, public textureHolder: RetroTextureHolder, public areas: MREARenderer[]) {
        this.textures = textureHolder.viewerTextures;
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.areas);
        return [layersPanel];
    }

    public render(state: RenderState) {
        this.areas.forEach((area) => {
            area.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textureHolder.destroy(gl);
        this.areas.forEach((area) => area.destroy(gl));
    }
}

class MP1SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string) {
        this.id = filename;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const stringsPakP = fetch(`${pakBase}/Strings.pak`);
        const levelPakP = fetch(`${pakBase}/${this.filename}`);
        const nameDataP = fetch(`data/metroid_prime/mp1/MP1_NameData.crg1`);
        return Progressable.all([levelPakP, stringsPakP, nameDataP]).then((datas: ArrayBufferSlice[]) => {
            const levelPak = PAK.parse(datas[0]);
            const stringsPak = PAK.parse(datas[1]);
            const nameData = BYML.parse(datas[2], BYML.FileType.CRG1);
            const resourceSystem = new ResourceSystem([levelPak, stringsPak], <NameData> <any> nameData);

            for (const mlvlEntry of levelPak.namedResourceTable.values()) {
                assert(mlvlEntry.fourCC === 'MLVL');
                const mlvl: MLVL.MLVL = resourceSystem.loadAssetByID(mlvlEntry.fileID, mlvlEntry.fourCC);
                // Crash my browser please.
                const areas = mlvl.areaTable;
                const textureHolder = new RetroTextureHolder();
                const scenes = areas.map((mreaEntry) => {
                    const mrea: MREA.MREA = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    return new MREARenderer(gl, textureHolder, mreaEntry.areaName, mrea);
                });
                return new MetroidPrimeWorldScene(mlvl, textureHolder, scenes);
            }

            return null;
        });
    }
}

const id = "mp1";
const name = "Metroid Prime 1";
const sceneDescs: Viewer.SceneDesc[] = [
    new MP1SceneDesc(`Metroid1.pak`, "Space Pirate Frigate"),
    new MP1SceneDesc(`Metroid4.pak`, "Tallon Overworld"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
