
// Mario Kart DS

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as NARC from './narc';
import * as NSBMD from './nsbmd';
import * as NSBTA from './nsbta';
import * as NSBTX from './nsbtx';

import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { CourseRenderer, MDL0Renderer, MKDSPass } from './render';
import { assert } from '../util';

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

            const c = new CourseRenderer(device, courseRenderer, skyboxRenderer);

            const courseBtaFile = courseNARC.files.find((file) => file.path === '/course_model.nsbta');
            const courseBta = courseBtaFile !== undefined ? NSBTA.parse(courseBtaFile.buffer) : null;
            if (courseBta !== null)
                courseRenderer.bindSRT0(courseBta.srt0);

            if (skyboxRenderer !== null) {
                const skyboxBtaFile = courseNARC.files.find((file) => file.path === '/course_model_V.nsbta');
                const skyboxBta = skyboxBtaFile !== undefined ? NSBTA.parse(skyboxBtaFile.buffer) : null;
                if (skyboxBta !== null)
                    skyboxRenderer.bindSRT0(skyboxBta.srt0);
            }
            return c;
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

    new MarioKartDSSceneDesc("old_baby_gc", "old_baby_gc"),
    new MarioKartDSSceneDesc("old_choco_64", "old_choco_64"),
    new MarioKartDSSceneDesc("old_choco_sfc", "old_choco_sfc"),
    new MarioKartDSSceneDesc("old_donut_sfc", "old_donut_sfc"),
    new MarioKartDSSceneDesc("old_frappe_64", "old_frappe_64"),
    new MarioKartDSSceneDesc("old_hyudoro_64", "old_hyudoro_64"),
    new MarioKartDSSceneDesc("old_kinoko_gc", "old_kinoko_gc"),
    new MarioKartDSSceneDesc("old_koopa_agb", "old_koopa_agb"),
    new MarioKartDSSceneDesc("old_luigi_agb", "old_luigi_agb"),
    new MarioKartDSSceneDesc("old_luigi_gc", "old_luigi_gc"),
    new MarioKartDSSceneDesc("old_mario_gc", "old_mario_gc"),
    new MarioKartDSSceneDesc("old_mario_sfc", "old_mario_sfc"),
    new MarioKartDSSceneDesc("old_momo_64", "old_momo_64"),
    new MarioKartDSSceneDesc("old_noko_sfc", "old_noko_sfc"),
    new MarioKartDSSceneDesc("old_peach_agb", "old_peach_agb"),
    new MarioKartDSSceneDesc("old_sky_agb", "old_sky_agb"),
    new MarioKartDSSceneDesc("old_yoshi_gc", "old_yoshi_gc"),

    new MarioKartDSSceneDesc("mini_stage1", "mini_stage1"),
    new MarioKartDSSceneDesc("mini_stage2", "mini_stage2"),
    new MarioKartDSSceneDesc("mini_stage3", "mini_stage3"),
    new MarioKartDSSceneDesc("mini_stage4", "mini_stage4"),
    new MarioKartDSSceneDesc("MR_stage1", "MR_stage1"),
    new MarioKartDSSceneDesc("MR_stage2", "MR_stage2"),
    new MarioKartDSSceneDesc("MR_stage3", "MR_stage3"),
    new MarioKartDSSceneDesc("MR_stage4", "MR_stage4"),

    new MarioKartDSSceneDesc("dokan_course", "dokan_course"),
    new MarioKartDSSceneDesc("wario_course", "wario_course"),
    new MarioKartDSSceneDesc("donkey_course", "donkey_course"),
    new MarioKartDSSceneDesc("luigi_course", "luigi_course"),
    new MarioKartDSSceneDesc("test1_course", "test1_course"),
    new MarioKartDSSceneDesc("test_circle", "test_circle"),
    new MarioKartDSSceneDesc("mini_block_course", "mini_block_course"),
    new MarioKartDSSceneDesc("mini_block_64", "mini_block_64"),
    new MarioKartDSSceneDesc("mini_dokan_gc", "mini_dokan_gc"),
    new MarioKartDSSceneDesc("nokonoko_course", "nokonoko_course"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
