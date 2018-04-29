
import ArrayBufferSlice from 'ArrayBufferSlice';
import Progressable from 'Progressable';
import { RenderState } from '../render';
import { assert, fetch, readString } from '../util';

import * as GX_Material from 'gx/gx_material';
import * as Viewer from '../viewer';
import * as Yaz0 from '../yaz0';

import { BMD, BMT, BTK, BRK } from './j3d';
import * as RARC from './rarc';
import { Scene } from './render';

export class MultiScene implements Viewer.MainScene {
    public scenes: Scene[];
    public textures: Viewer.Texture[];

    constructor(scenes: Scene[]) {
        this.setScenes(scenes);
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }

    protected setScenes(scenes: Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }
}

export function createScene(gl: WebGL2RenderingContext, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile, brkFile: RARC.RARCFile, bmtFile: RARC.RARCFile) {
    const bmd = BMD.parse(bmdFile.buffer);
    const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
    const brk = brkFile ? BRK.parse(brkFile.buffer) : null;
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    return new Scene(gl, bmd, btk, brk, bmt);
}

function boolSort(a: boolean, b: boolean): number {
    if (a && !b)
        return -1;
    else if (b && !a)
        return 1;
    else
        return 0;
}

export function createScenesFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): Scene[] {
    if (readString(buffer, 0, 4) === 'Yaz0')
        buffer = Yaz0.decompress(buffer);

    if (readString(buffer, 0, 4) === 'RARC') {
        const rarc = RARC.parse(buffer);
        const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
        let scenes = bmdFiles.map((bmdFile) => {
            // Find the corresponding btk.
            const basename = bmdFile.name.split('.')[0];
            const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`);
            const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`);
            const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`);
            const scene = createScene(gl, bmdFile, btkFile, brkFile, bmtFile);
            scene.name = basename;
            if (basename.includes('_sky'))
                scene.setIsSkybox(true);
            return scene;
        });

        // Sort skyboxen before non-skyboxen.
        scenes = scenes.sort((a, b) => {
            return boolSort(a.isSkybox, b.isSkybox);
        });

        return scenes;
    }

    if (['J3D2bmd3', 'J3D2bdl4'].includes(readString(buffer, 0, 8))) {
        const bmd = BMD.parse(buffer);
        return [new Scene(gl, bmd, null, null, null)];
    }

    return null;
}

export function createMultiSceneFromBuffer(gl: WebGL2RenderingContext, buffer: ArrayBufferSlice): MultiScene {
    return new MultiScene(createScenesFromBuffer(gl, buffer));
}
