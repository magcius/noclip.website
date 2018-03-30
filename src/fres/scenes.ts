
import * as BFRES from './bfres';
import * as SARC from './sarc';
import * as Yaz0 from '../yaz0';
import { Scene } from './render';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import Progressable from 'Progressable';
import { fetch, readString } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

class MultiScene implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;
    public scenes: Viewer.Scene[];
    public textures: Viewer.Texture[];

    constructor(scenes: Viewer.Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public render(state: RenderState) {
        const gl = state.viewport.gl;
        this.scenes.forEach((scene) => scene.render(state));
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

export function createSceneFromFRESBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice, isSkybox: boolean = false) {
    const fres = BFRES.parse(buffer);
    return new MultiScene([new Scene(gl, fres, isSkybox)]);
}

export function createSceneFromSARCBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice, isSkybox: boolean = false) {
    if (readString(buffer, 0, 4) === 'Yaz0')
        buffer = Yaz0.decompress(buffer);

    const sarc = SARC.parse(buffer);
    const file = sarc.files.find((file) => file.name.endsWith('.bfres'));
    return createSceneFromFRESBuffer(gl, file.buffer, isSkybox);
}

export class SceneDesc implements Viewer.SceneDesc {
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
            this._createSceneFromPath(gl, this.path, false),
            this._createSceneFromPath(gl, 'data/spl/VR_SkyDayCumulonimbus.szs', true),
        ]).then((scenes): Viewer.Scene => {
            return new MultiScene(scenes);
        });
    }

    private _createSceneFromPath(gl: WebGL2RenderingContext, path: string, isSkybox: boolean): Progressable<Scene> {
        return fetch(path).then((result: ArrayBufferSlice) => {
            return createSceneFromSARCBuffer(gl, result, isSkybox);
        });
    }
}

// Splatoon Models
const name = "Splatoon";
const id = "fres";
const sceneDescs: SceneDesc[] = [
    { name: 'Inkopolis Plaza', path: 'Fld_Plaza00.szs' },
    { name: 'Inkopolis Plaza Lobby', path: 'Fld_PlazaLobby.szs' },
    { name: 'Ancho-V Games', path: 'Fld_Office00.szs' },
    { name: 'Arrowana Mall', path: 'Fld_UpDown00.szs' },
    { name: 'Blackbelly Skatepark', path: 'Fld_SkatePark00.szs' },
    { name: 'Bluefin Depot', path: 'Fld_Ruins00.szs' },
    { name: 'Camp Triggerfish', path: 'Fld_Athletic00.szs' },
    { name: 'Flounder Heights', path: 'Fld_Jyoheki00.szs' },
    { name: 'Hammerhead Bridge', path: 'Fld_Kaisou00.szs' },
    { name: 'Kelp Dome', path: 'Fld_Maze00.szs' },
    { name: 'Mahi-Mahi Resort', path: 'Fld_Hiagari00.szs' },
    { name: 'Moray Towers', path: 'Fld_Tuzura00.szs' },
    { name: 'Museum d\'Alfonsino', path: 'Fld_Pivot00.szs' },
    { name: 'Pirahna Pit', path: 'Fld_Quarry00.szs' },
    { name: 'Port Mackerel', path: 'Fld_Amida00.szs' },
    { name: 'Saltspray Rig', path: 'Fld_SeaPlant00.szs' },
    { name: 'Urchin Underpass (New)', path: 'Fld_Crank01.szs' },
    { name: 'Urchin Underpass (Old)', path: 'Fld_Crank00.szs' },
    { name: 'Walleye Warehouse', path: 'Fld_Warehouse00.szs' },
    { name: 'Octo Valley', path: 'Fld_World00.szs' },
    { name: 'Object: Tree', path: 'Obj_Tree02.szs' },
].map((entry): SceneDesc => {
    const name = entry.name || entry.path;
    const path = `data/spl/${entry.path}`;
    return new SceneDesc(name, path);
});

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
