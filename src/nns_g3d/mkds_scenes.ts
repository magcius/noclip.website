
// Mario Kart DS

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as NARC from './narc';
import * as NSBMD from './nsbmd';
import * as NSBTX from './nsbtx';

import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { CourseRenderer, MDL0Renderer, MKDSPass } from './render';
import { assert } from '../util';
import { mat4 } from 'gl-matrix';

class MarioKartDSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private fetchCARC(path: string): Progressable<NARC.NitroFS> {
        return fetchData(path).then((buffer: ArrayBufferSlice) => {
            return NARC.parse(CX.decompress(buffer));
        });
    }

    public createScene_Device(device: GfxDevice): Progressable<Viewer.Scene_Device> {
        return Progressable.all([
            this.fetchCARC(`data/mkds/Course/${this.id}.carc`),
            this.fetchCARC(`data/mkds/Course/${this.id}Tex.carc`),
        ]).then(([courseNARC, textureNARC]) => {
            const courseBmdFile = courseNARC.files.find((file) => file.path === '/course_model.nsbmd');
            const courseBmd = NSBMD.parse(courseBmdFile.buffer);
            const courseBtxFile = textureNARC.files.find((file) => file.path === '/course_model.nsbtx');
            const courseBtx = courseBtxFile !== undefined ? NSBTX.parse(courseBtxFile.buffer) : null;
            assert(courseBmd.models.length === 1);
            const courseRenderer = new MDL0Renderer(device, courseBtx !== null ? courseBtx.tex0 : courseBmd.tex0, courseBmd.models[0]);

            let skyboxRenderer: MDL0Renderer | null = null;
            const skyboxBmdFile = courseNARC.files.find((file) => file.path === '/course_model_V.nsbmd');
            if (skyboxBmdFile !== undefined) {
                const skyboxBmd = skyboxBmdFile !== undefined ? NSBMD.parse(skyboxBmdFile.buffer) : null;
                const skyboxBtxFile = textureNARC.files.find((file) => file.path === '/course_model_V.nsbtx');
                const skyboxBtx = skyboxBtxFile !== undefined ? NSBTX.parse(skyboxBtxFile.buffer) : null;
                assert(skyboxBmd.models.length === 1);
                skyboxRenderer = new MDL0Renderer(device, skyboxBtx !== null ? skyboxBtx.tex0 : skyboxBmd.tex0, skyboxBmd.models[0]);
                skyboxRenderer.modelMatrix[13] -= 1500;
                skyboxRenderer.isSkybox = true;
                skyboxRenderer.pass = MKDSPass.SKYBOX;
            }

            return new CourseRenderer(device, courseRenderer, skyboxRenderer);
        });
    }
}

const id = 'mkds';
const name = 'Mario Kart DS';
const sceneDescs: Viewer.SceneDesc[] = [
    new MarioKartDSSceneDesc("cross_course", "Figure-8 Circuit"),
    new MarioKartDSSceneDesc("desert_course", "Desert Hills"),
    new MarioKartDSSceneDesc("snow_course", "DK Pass"),
    new MarioKartDSSceneDesc("stadium_course", "Wario's Stadium"),
    new MarioKartDSSceneDesc("bank_course", "Yoshi Falls"),
    new MarioKartDSSceneDesc("town_course", "Delfino Square"),
    new MarioKartDSSceneDesc("clock_course", "Tick Tock Clock"),
    new MarioKartDSSceneDesc("garden_course", "Peach Gardens"),
    new MarioKartDSSceneDesc("beach_course", "Cheep Cheep Beach"),
    new MarioKartDSSceneDesc("pinball_course", "Waluigi Pinball"),
    new MarioKartDSSceneDesc("mario_course", "Mario Circuit"),
    new MarioKartDSSceneDesc("koopa_course", "Bowser's Castle"),
    new MarioKartDSSceneDesc("mansion_course", "Luigi's Mansion"),
    new MarioKartDSSceneDesc("ridge_course", "Shroom Ridge"),
    new MarioKartDSSceneDesc("airship_course", "Airship Fortress"),
    new MarioKartDSSceneDesc("rainbow_course", "Rainbow Road"),

    new MarioKartDSSceneDesc("mini_stage1", "mini_stage1"),
    new MarioKartDSSceneDesc("mini_stage2", "mini_stage2"),
    new MarioKartDSSceneDesc("mini_stage3", "mini_stage3"),
    new MarioKartDSSceneDesc("mini_stage4", "mini_stage4"),

    new MarioKartDSSceneDesc("dokan_course", "dokan_course"),
    new MarioKartDSSceneDesc("wario_course", "wario_course"),
    new MarioKartDSSceneDesc("donkey_course", "donkey_course"),
    new MarioKartDSSceneDesc("luigi_course", "luigi_course"),
    new MarioKartDSSceneDesc("test1_course", "test1_course"),
    new MarioKartDSSceneDesc("mini_block_course", "mini_block_course"),
    new MarioKartDSSceneDesc("nokonoko_course", "nokonoko_course"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
