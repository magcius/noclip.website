
import { BMD, BTK, BMT } from './j3d';
import { Scene } from './render';
import * as GX_Material from './gx_material';
import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as Viewer from '../viewer';

import { Progressable } from '../progress';
import { RenderPass, RenderState } from '../render';
import { assert, fetch, readString } from '../util';
import { SunshineSceneDesc } from './sms_scenes';

export class MultiScene implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;
    public renderPasses = [ RenderPass.CLEAR, RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
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
            if (!scene.renderPasses.includes(renderState.currentPass))
                return;
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

export function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    return new Scene(gl, bmd, btk, bmt);
}

export function createSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBuffer): MultiScene {
    if (readString(buffer, 0, 4) === 'Yaz0')
        buffer = Yaz0.decompress(buffer);

    if (readString(buffer, 0, 4) === 'RARC') {
        const rarc = RARC.parse(buffer);
        const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
        const scenes = bmdFiles.map((bmdFile) => {
            // Find the corresponding btk.
            const basename = bmdFile.name.split('.')[0];
            const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
            const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
            try {
                return createScene(gl, bmdFile, btkFile, bmtFile);
            } catch(e) {
                console.log("Error parsing", bmdFile.name);
                return null;
            }
        });

        return new MultiScene(scenes.filter((s) => !!s));
    }

    if (['J3D2bmd3', 'J3D2bdl4'].includes(readString(buffer, 0, 8))) {
        const bmd = BMD.parse(buffer);
        return new MultiScene([new Scene(gl, bmd, null, null)]);
    }

    return null;
}

export class RARCSceneDesc implements Viewer.SceneDesc {
    public name: string;
    public path: string;
    public id: string;

    constructor(path: string, name?: string) {
        this.name = name || path;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            return createSceneFromBuffer(gl, result);
        });
    }
}

class SMGSceneDesc implements Viewer.SceneDesc {
    id: string;
    paths: string[];
    name: string;

    constructor(paths: string[], name: string) {
        this.id = paths[0];
        this.paths = paths;
        this.name = name;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return Progressable.all(this.paths.map((path) => fetch(path).then((buffer: ArrayBuffer) => {
            return this.createSceneFromBuffer(gl, buffer);
        }))).then((scenes: Scene[]) => {
            return new MultiScene(scenes);
        });
    }

    protected createSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBuffer): Viewer.MainScene {
        const multiScene: MultiScene = createSceneFromBuffer(gl, buffer);
        assert(multiScene.scenes.length === 1);
        const scene: Scene = (<Scene> multiScene.scenes[0]);
        scene.setFPS(60);
        scene.setUseMaterialTexMtx(true);
        return multiScene;
    }
}

const id = "j3d";
const name = "GameCube Models";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc(["data/j3d/MarioFaceShipPlanet.arc"], "Faceship"),
    new SMGSceneDesc(["data/j3d/PeachCastleGardenPlanet.arc", "data/j3d/GalaxySky.arc"], "Peach's Castle Garden"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
