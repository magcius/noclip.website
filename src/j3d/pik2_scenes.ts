
import * as Viewer from '../viewer';

import { createModelInstance, BasicRenderer } from './scenes';
import * as Yaz0 from '../compression/Yaz0';

import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assertExists } from '../util';
import { fetchData } from '../fetch';
import { mat4, } from 'gl-matrix';
import * as RARC from './rarc';
import { J3DTextureHolder, BMDModelInstance } from './render';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

const id = "pik2";
const name = "Pikmin 2";


class Pik2SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public name: string, public path: string) {
        this.id = this.path;
    }

    private spawnBMD(device: GfxDevice, renderer: BasicRenderer, rarc: RARC.RARC, basename: string, modelMatrix: mat4 = null): BMDModelInstance {
        const bmdFile = rarc.findFile(`${basename}.bmd`);
        assertExists(bmdFile);
        const btkFile = rarc.findFile(`${basename}.btk`);
        const brkFile = rarc.findFile(`${basename}.brk`);
        const bmtFile = rarc.findFile(`${basename}.bmt`);
        const scene = createModelInstance(device, renderer.renderHelper, renderer.textureHolder, bmdFile, btkFile, brkFile, null, bmtFile);
        scene.name = basename;
        if (modelMatrix !== null)
            mat4.copy(scene.modelMatrix, modelMatrix);
        return scene;
    }

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        const path = `j3d/pik2/Areas/${this.path}`;
        return fetchData(path).then((result: ArrayBufferSlice) => {
            return Yaz0.decompress(result);
        }).then((buffer: ArrayBufferSlice) => {
            const rarc = RARC.parse(buffer);
            debugger;
            console.log(rarc);

            const renderer = new BasicRenderer(device, new J3DTextureHolder());

            renderer.addModelInstance(this.spawnBMD(device, renderer, rarc, `model`));

            renderer.finish(device);
            return renderer;
        });
    }
}

const sceneDescs = [
    "Areas",
    new Pik2SceneDesc(`Valley of Repose`, 'valley_of_repose.szs'),
    new Pik2SceneDesc(`Awakening Wood`, 'awakening_wood.szs'),
    new Pik2SceneDesc(`Perplexing Pool`, 'perplexing_pool.szs'),
    new Pik2SceneDesc(`Wistful Wild`, 'wistful_wild.szs'),
    "Unused Test Maps",
    new Pik2SceneDesc(`TestMap`, 'newtest.szs'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
