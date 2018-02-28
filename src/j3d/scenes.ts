
import { Scene } from 'render';

import { BMD, BTK, BMT } from './j3d';
import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as Viewer from '../viewer';

import { Progressable } from '../progress';
import { RenderPass, RenderState } from '../render';
import { fetch, readString } from '../util';

const id = "j3d";
const name = "J3D Models";

export class MultiScene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public renderPasses = [ RenderPass.CLEAR, RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
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
            if (!scene.renderPasses.includes(renderState.currentPass))
                return;
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, bmtFile: RARC.RARCFile, isSkybox: boolean = false) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    return new Scene(gl, bmd, btk, bmt, isSkybox);
}

class SunshineClearScene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
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
            return new MultiScene([
                new SunshineClearScene(),
                this.createSceneForBasename(gl, rarc, 'map/map/sky', true),
                this.createSceneForBasename(gl, rarc, 'map/map/map', false),
                this.createSceneForBasename(gl, rarc, 'map/map/sea', false),
            ]);
        });
    }

    private createSceneForBasename(gl: WebGL2RenderingContext, rarc: RARC.RARC, fn: string, isSkybox: boolean) {
        const bmdFile = rarc.findFile(`${fn}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`${fn}.btk`);
        const bmtFile = rarc.findFile(`${fn}.bmt`);
        return createScene(gl, bmdFile, btkFile, bmtFile, isSkybox);
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

export function createSceneFromRARCBuffer(gl: WebGL2RenderingContext, buffer: ArrayBuffer): Viewer.Scene {
    if (readString(buffer, 0, 4) === 'Yaz0')
        buffer = Yaz0.decompress(buffer);
    const rarc = RARC.parse(buffer);
    const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
    const scenes = bmdFiles.map((bmdFile) => {
        // Find the corresponding btk.
        const basename = bmdFile.name.split('.')[0];
        const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
        const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
        return createScene(gl, bmdFile, btkFile, bmtFile);
    });
    return new MultiScene(scenes);
}

class RARCSceneDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(path: string, name?: string) {
        this.name = name || path;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            return createSceneFromRARCBuffer(gl, result);
        });
    }
}

const sceneDescs: Viewer.SceneDesc[] = [
    new SunshineSceneDesc("data/j3d/dolpic0.szs", "Delfino Plaza"),
    new SunshineSceneDesc("data/j3d/mare0.szs", "Noki Bay"),
    new SunshineSceneDesc("data/j3d/sirena0.szs", "Sirena Beach",),
    new SunshineSceneDesc("data/j3d/ricco0.szs", "Ricco Harbor",),
    new SunshineSceneDesc("data/j3d/delfino0.szs", "Delfino Hotel"),

    new RARCSceneDesc("data/j3d/MarioFaceShipPlanet.arc", "Faceship"),

    new MultiSceneDesc("data/j3d/PeachCastleGardenPlanet.arc", "Peach's Castle Garden", [
        new RARCSceneDesc("data/j3d/PeachCastleGardenPlanet.arc"),
        new RARCSceneDesc("data/j3d/GalaxySky.arc"),
    ]),

    new RARCSceneDesc("data/j3d/Room11.arc", "Windfall Island"),
    new RARCSceneDesc("data/j3d/Room13.arc", "Dragon Roost Island"),
    new RARCSceneDesc("data/j3d/Room41.arc", "Forest Haven"),
    new RARCSceneDesc("data/j3d/Room44.arc", "Outset Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
