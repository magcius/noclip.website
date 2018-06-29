
import * as BFRES from './bfres';
import * as SARC from './sarc';
import * as Yaz0 from '../compression/Yaz0';
import { createSceneFromSARCBuffer } from './scenes';
import { Scene } from './render';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import Progressable from 'Progressable';
import { fetch } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

class SplatoonRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[];

    constructor(public mainScene: Viewer.Scene, public skyScene: Viewer.Scene) {
        this.textures = collectTextures([this.mainScene, this.skyScene]);
    }

    public render(state: RenderState) {
        const gl = state.gl;
        state.setClipPlanes(0.2, 500000);

        if (this.skyScene) {
            this.skyScene.render(state);
        }
        gl.clear(gl.DEPTH_BUFFER_BIT);
        if (this.mainScene) {
            this.mainScene.render(state);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        if (this.skyScene)
            this.skyScene.destroy(gl);
        if (this.mainScene)
            this.mainScene.destroy(gl);
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

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return Progressable.all([
            this._createSceneFromPath(gl, `data/spl/${this.path}`, false),
            this._createSceneFromPath(gl, 'data/spl/VR_SkyDayCumulonimbus.szs', true),
        ]).then((scenes: Viewer.Scene[]): Viewer.MainScene => {
            const [mainScene, skyScene] = scenes;
            return new SplatoonRenderer(mainScene, skyScene);
        });
    }

    private _createSceneFromPath(gl: WebGL2RenderingContext, path: string, isSkybox: boolean): Progressable<Viewer.Scene> {
        return fetch(path).then((result: ArrayBufferSlice): Promise<Viewer.Scene> => {
            return createSceneFromSARCBuffer(gl, result, isSkybox);
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
