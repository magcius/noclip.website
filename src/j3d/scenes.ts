
import { Scene } from 'render';

import * as BMD from './bmd';
import * as BTK from './btk';
import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as Viewer from '../viewer';

import { Progressable } from '../progress';
import { RenderPass, RenderState } from '../render';
import { fetch } from '../util';

const id = "j3d";
const name = "J3D Models";

export class MultiScene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public renderPasses = [ RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
    public scenes: Viewer.Scene[];
    public textures: HTMLCanvasElement[];

    constructor(scenes: Viewer.Scene[]) {
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

function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    return new Scene(gl, bmd, btk);
}

class SunshineSceneDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(path: string, name: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const rarc = RARC.parse(Yaz0.decompress(result));
            const scenes = this.createSceneForPrefixes(gl, rarc, ['map/map/map', 'map/map/sea']);
            return new MultiScene(scenes);
        });
    }

    private createSceneForPrefixes(gl: WebGL2RenderingContext, rarc: RARC.RARC, fns: string[]) {
        return fns.map((fn) => this.createSceneForPrefix(gl, rarc, fn)).filter((x) => x !== null);
    }

    private createSceneForPrefix(gl: WebGL2RenderingContext, rarc: RARC.RARC, fn: string) {
        const bmdFile = rarc.findFile(`${fn}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`${fn}.btk`);
        return createScene(gl, bmdFile, btkFile);
    }
}

class RARCDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(path: string, name: string = "") {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const rarc = RARC.parse(Yaz0.decompress(result));
            // Find a BMD and a BTK.
            const bmdFile = rarc.files.find((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
            const btkFile = rarc.files.find((f) => f.name.endsWith('.btk'));
            return createScene(gl, bmdFile, btkFile);
        });
    }
}

class MultiSceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public subscenes: Viewer.SceneDesc[];

    constructor(id: string, name: string, subscenes: Viewer.SceneDesc[]) {
        this.id = id;
        this.name = name;
        this.subscenes = subscenes;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        return Progressable.all(this.subscenes.map((sceneDesc) => sceneDesc.createScene(gl))).then((scenes) => {
            return new MultiScene(scenes);
        });
    }
}

class WindWakerSceneDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(path: string, name: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const rarc = RARC.parse(result);
            const bdl = rarc.findDir('bdl');
            const scenes = bdl.files.map((bdlFile) => {
                // Find the corresponding btk.
                const basename = bdlFile.name.split('.')[0];
                const btkFile = rarc.findFile(`btk/${basename}.btk`);
                return createScene(gl, bdlFile, btkFile);
            });
            return new MultiScene(scenes.filter((s) => !!s));
        });
    }
}

const sceneDescs: Viewer.SceneDesc[] = [
    new SunshineSceneDesc("data/j3d/dolpic0.szs", "Delfino Plaza"),
    new SunshineSceneDesc("data/j3d/sirena0.szs", "Sirena Beach",),
    new SunshineSceneDesc("data/j3d/ricco0.szs", "Ricco Harbor",),
    new SunshineSceneDesc("data/j3d/delfino0.szs", "Delfino Hotel"),

    new RARCDesc("data/j3d/MarioFaceShipPlanet.arc", "Faceship"),

    new MultiSceneDesc("data/j3d/PeachCastleGardenPlanet.arc", "Peach's Castle Garden", [
        new RARCDesc("data/j3d/PeachCastleGardenPlanet.arc"),
        new RARCDesc("data/j3d/GalaxySky.arc"),
    ]),

    new WindWakerSceneDesc("data/j3d/Room11.arc", "Windfall Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
