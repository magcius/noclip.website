
import * as Viewer from '../../viewer';

import { createModelInstance, BasicRenderer } from '../../j3d/scenes';
import * as Yaz0 from '../../Common/Compression/Yaz0';

import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assertExists } from '../../util';
import { mat4, } from 'gl-matrix';
import * as RARC from '../../Common/JSYSTEM/JKRArchive';
import { J3DModelInstanceSimple } from '../../Common/JSYSTEM/J3D/J3DGraphSimple';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { BTK } from '../../Common/JSYSTEM/J3D/J3DLoader';
import { SceneContext } from '../../SceneBase';

const id = "pik2";
const name = "Pikmin 2";

class Pik2SceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public name: string, public path: string) {
        this.id = this.path;
    }

    private spawnBMD(device: GfxDevice, renderer: BasicRenderer, rarc: RARC.JKRArchive, basename: string, modelMatrix: mat4 | null = null): J3DModelInstanceSimple {
        const bmdFile = assertExists(rarc.findFile(`${basename}.bmd`));
        const btkFile = rarc.findFile(`${basename}.btk`);
        const brkFile = rarc.findFile(`${basename}.brk`);
        const bmtFile = rarc.findFile(`${basename}.bmt`);
        const scene = createModelInstance(device, renderer.renderHelper.renderInstManager.gfxRenderCache, bmdFile, btkFile, brkFile, null, bmtFile);
        scene.name = basename;
        if (modelMatrix !== null)
            mat4.copy(scene.modelMatrix, modelMatrix);
        return scene;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const path = `j3d/pik2/${this.path}`;
        return dataFetcher.fetchData(path).then((result) => {
            return Yaz0.decompress(result);
        }).then((buffer: ArrayBufferSlice) => {
            const rarc = RARC.parse(buffer);
            console.log(rarc);

            const renderer = new BasicRenderer(device);

            if (rarc.findFile(`model.bmd`)) {
                const m = this.spawnBMD(device, renderer, rarc, `model`);
                const btk = rarc.findFileData(`texanm_1.btk`);
                if (btk !== null)
                    m.bindTTK1(BTK.parse(btk));
                renderer.addModelInstance(m);
            }

            if (rarc.findFile(`opening.bmd`))
                renderer.addModelInstance(this.spawnBMD(device, renderer, rarc, `opening`));

            return renderer;
        });
    }
}

const sceneDescs = [
    "Areas",
    new Pik2SceneDesc(`Valley of Repose`, 'user/Kando/map/tutorial/arc.szs'),
    new Pik2SceneDesc(`Awakening Wood`, 'user/Kando/map/forest/arc.szs'),
    new Pik2SceneDesc(`Perplexing Pool`, 'user/Kando/map/yakushima/arc.szs'),
    new Pik2SceneDesc(`Wistful Wild`, 'user/Kando/map/last/arc.szs'),

    "Piklopedia / Treasure Hoard",
    new Pik2SceneDesc(`Piklopedia - Spring`, 'user/Kando/map/zukan/forest/arc.szs'),
    new Pik2SceneDesc(`Piklopedia - Summer`, 'user/Kando/map/zukan/yakushima/arc.szs'),
    new Pik2SceneDesc(`Piklopedia - Autumn`, 'user/Kando/map/zukan/last/arc.szs'),
    new Pik2SceneDesc(`Piklopedia - Winter`, 'user/Kando/map/zukan/tutorial/arc.szs'),

    "Title Screen Backgrounds",
    new Pik2SceneDesc(`Title Screen - Spring`, 'user/Ebisawa/title/bg_spring.szs'),
    new Pik2SceneDesc(`Title Screen - Summer`, 'user/Ebisawa/title/bg_summer.szs'),
    new Pik2SceneDesc(`Title Screen - Autumn`, 'user/Ebisawa/title/bg_autumn.szs'),
    new Pik2SceneDesc(`Title Screen - Winter`, 'user/Ebisawa/title/bg_winter.szs'),

    "Cave Skyboxes",
    new Pik2SceneDesc(`build`, 'user/Kando/map/vrbox/build.szs'),
    new Pik2SceneDesc(`flooring`, 'user/Kando/map/vrbox/flooring.szs'),
    new Pik2SceneDesc(`hiroba`, 'user/Kando/map/vrbox/hiroba.szs'),
    new Pik2SceneDesc(`ice`, 'user/Kando/map/vrbox/ice.szs'),
    new Pik2SceneDesc(`tatami`, 'user/Kando/map/vrbox/tatami.szs'),
    new Pik2SceneDesc(`test`, 'user/Kando/map/vrbox/test.szs'),

    "Unused Test Maps",
    new Pik2SceneDesc(`TestMap`, 'user/Kando/map/newtest/arc.szs'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
