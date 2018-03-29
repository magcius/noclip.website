
import * as PAK from './pak';
import * as MLVL from './mlvl';
import { ResourceSystem } from './resource';
import { Scene } from './render';

import * as Viewer from '../viewer';
import { fetch, assert } from '../util';
import { Progressable } from '../progress';
import { RenderState } from '../render';

// Files are too big for GitHub.
function findPakBase() {
    if (document.location.protocol === 'file:') {
        return `data/metroid_prime/mp1/`;
    } else {
        return `https://funny.computer/cloud/MetroidPrime1/`;
    }
}

const pakBase = findPakBase();

export class MultiScene implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;
    public scenes: Viewer.Scene[];
    public textures: Viewer.Texture[];

    constructor(scenes: Viewer.Scene[]) {
        this.setScenes(scenes);
    }

    protected setScenes(scenes: Viewer.Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
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
        return fetch(path).then((buffer: ArrayBuffer) => {
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
                const areas = mlvl.areaTable.slice(0, 10);
                const scenes = areas.map((mreaEntry) => {
                    const mrea = resourceSystem.loadAssetByID(mreaEntry.areaMREAID, 'MREA');
                    return new Scene(gl, mrea);
                });
                return new MultiScene(scenes);
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
