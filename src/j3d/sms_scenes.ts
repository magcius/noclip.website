
import { RenderPass, RenderState } from '../render';
import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as Viewer from '../viewer';
import { MultiScene, createScene } from './scenes';
import { Scene, ColorOverride } from './render';
import { Progressable } from '../progress';
import { fetch } from '../util';

export class SunshineClearScene implements Viewer.Scene {
    public textures = [];
    public renderPasses = [ RenderPass.CLEAR ];

    public render(renderState: RenderState) {
        const gl = renderState.gl;
        gl.clearColor(0, 0, 0.125, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    public destroy() {
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
        const btkFile = rarc.findFile(`map/map/${basename}.btk`);
        const bmtFile = rarc.findFile(`map/map/${basename}.bmt`);
        const scene = createScene(gl, bmdFile, btkFile, bmtFile);
        scene.name = basename;
        scene.setIsSkybox(isSkybox);
        scene.setUseMaterialTexMtx(false);
        return scene;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const rarc = RARC.parse(Yaz0.decompress(result));

            // For those curious, the "actual" way the engine loads files is done through
            // the scene description in scene.bin, with the "map/map" paths hardcoded in
            // the binary, and for a lot of objects, too. My heuristics below are a cheap
            // approximation of the actual scene data...

            const scenes: Viewer.Scene[] = [];
            for (const file of rarc.findDir('map/map').files) {
                const [basename, extension] = file.name.split('.');
                if (extension !== 'bmd')
                    continue;
                // Indirect stuff would require engine support.
                if (basename.includes('indirect'))
                    continue;

                // Sky always gets sorted first.
                if (basename === 'sky')
                    continue;
                const scene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, basename, false);
                scenes.push(scene);
            }

            scenes.unshift(SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, `sky`, true));
            scenes.unshift(new SunshineClearScene());

            return new MultiScene(scenes);
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
