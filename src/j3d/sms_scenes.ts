
import { RenderPass, RenderState } from '../render';
import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as Viewer from '../viewer';
import { createScene, J3DScene } from './scenes';
import { Scene, ColorOverride } from './render';
import Progressable from 'Progressable';
import { fetch } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

function collectTextures(scenes: J3DScene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

export class SunshineRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    constructor(public skyScene: J3DScene, public mapScene: J3DScene, public seaScene: J3DScene, public extraScenes: J3DScene[]) {
        this.textures = collectTextures([skyScene, mapScene, seaScene].concat(extraScenes));
    }

    public render(renderState: RenderState): void {
        const gl = renderState.gl;
        gl.clearColor(0, 0, 0.125, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (this.skyScene) {
            this.skyScene.render(renderState);
            gl.clear(gl.DEPTH_BUFFER_BIT);
        }

        if (this.mapScene)
            this.mapScene.render(renderState);
        if (this.seaScene)
            this.seaScene.render(renderState);

        for (const scene of this.extraScenes)
            scene.render(renderState);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        if (this.skyScene)
            this.skyScene.destroy(gl);
        if (this.mapScene)
            this.mapScene.destroy(gl);
        if (this.seaScene)
            this.seaScene.destroy(gl);
        this.extraScenes.forEach((scene) => scene.destroy(gl));
    }
}

export class SunshineSceneDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(path: string, name: string) {
        this.name = name;
        this.path = path;
        this.id = this.name;
    }

    public static createSunshineSceneForBasename(gl: WebGL2RenderingContext, rarc: RARC.RARC, basename: string, isSkybox: boolean): Scene {
        const bmdFile = rarc.findFile(`map/map/${basename}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`map/map/${basename}.btk`);
        const bmtFile = rarc.findFile(`map/map/${basename}.bmt`);
        const scene = createScene(gl, bmdFile, btkFile, bmtFile);
        scene.name = basename;
        scene.setIsSkybox(isSkybox);
        scene.setUseMaterialTexMtx(false);
        return scene;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(this.path).then((result: ArrayBufferSlice) => {
            const rarc = RARC.parse(Yaz0.decompress(result));

            // For those curious, the "actual" way the engine loads files is done through
            // the scene description in scene.bin, with the "map/map" paths hardcoded in
            // the binary, and for a lot of objects, too. My heuristics below are a cheap
            // approximation of the actual scene data...

            const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'sky', true);
            const mapScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'map', false);
            const seaScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'sea', false);

            const extraScenes: J3DScene[] = [];
            for (const file of rarc.findDir('map/map').files) {
                const [basename, extension] = file.name.split('.');
                if (extension !== 'bmd')
                    continue;
                if (['sky', 'map', 'sea'].includes(basename))
                    continue;
                // Indirect stuff would require engine support.
                if (basename.includes('indirect'))
                    continue;
                const scene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, basename, false);
                extraScenes.push(scene);
            }

            return new SunshineRenderer(skyScene, mapScene, seaScene, extraScenes);
        });
    }
}

const id = "sms";
const name = "Super Mario Sunshine";

const sceneDescs: Viewer.SceneDesc[] = [
    new SunshineSceneDesc("data/j3d/dolpic0.szs", "Delfino Plaza"),
    new SunshineSceneDesc("data/j3d/mare0.szs", "Noki Bay"),
    new SunshineSceneDesc("data/j3d/sirena0.szs", "Sirena Beach",),
    new SunshineSceneDesc("data/j3d/ricco0.szs", "Ricco Harbor",),
    new SunshineSceneDesc("data/j3d/delfino0.szs", "Delfino Hotel"),
    new SunshineSceneDesc("data/j3d/monte3.szs", "Pianta Village"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
