
import * as PAK from './pak';
import * as MLVL from './mlvl';
import { ResourceSystem } from './resource';
import { Scene } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { fetch, assert } from '../util';
import Progressable from 'Progressable';
import { RenderState } from '../render';
import ArrayBufferSlice from 'ArrayBufferSlice';

// Files are too big for GitHub.
function findPakBase() {
    if (document.location.protocol === 'file:') {
        return `data/metroid_prime/mp1/`;
    } else {
        return `https://funny.computer/cloud/MetroidPrime1/`;
    }
}

const pakBase = findPakBase();

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

export class MetroidPrimeAreaScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];

    constructor(public mlvl: MLVL.MLVL, public scenes: Scene[]) {
        this.textures = collectTextures(scenes);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.scenes);
        return [layersPanel];
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

class MP1SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string) {
        this.id = filename;
    }

    private fetchPak(path: string): Progressable<PAK.PAK> {
        return fetch(path).then((buffer: ArrayBufferSlice) => {
            return PAK.parse(buffer);
        });
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const paks = [`${pakBase}/${this.filename}`, `${pakBase}/Strings.pak`];
        return Progressable.all(paks.map((pakPath) => this.fetchPak(pakPath))).then((paks: PAK.PAK[]) => {
            const resourceSystem = new ResourceSystem(paks);
            const levelPak = paks[0];

            for (const mlvlEntry of levelPak.namedResourceTable.values()) {
                assert(mlvlEntry.fourCC === 'MLVL');
                const mlvl: MLVL.MLVL = resourceSystem.loadAssetByID(mlvlEntry.fileID, mlvlEntry.fourCC);
                // Crash my browser please.
                const areas = mlvl.areaTable;
                const scenes = areas.map((mreaEntry) => {
                    const mrea = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    return new Scene(gl, mreaEntry.areaMREAID, mrea);
                });
                return new MetroidPrimeAreaScene(mlvl, scenes);
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
