
// Mario Kart DS

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as NARC from './narc';
import * as NSBMD from './nsbmd';
import * as NSBTA from './nsbta';
import * as NSBTP from './nsbtp';
import * as NSBTX from './nsbtx';

import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass } from './render';
import { assert } from '../util';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';

export class CourseRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    public textureHolder: FakeTextureHolder;

    constructor(device: GfxDevice, public courseRenderer: MDL0Renderer, public skyboxRenderer: MDL0Renderer | null) {
        this.textureHolder = new FakeTextureHolder(this.courseRenderer.viewerTextures);
        this.courseRenderer.addToViewRenderer(device, this.viewRenderer);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.courseRenderer.prepareToRender(hostAccessPass, viewerInput);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(hostAccessPass, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, G3DPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, G3DPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);

        this.courseRenderer.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
    }
}

class MarioKartDSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private fetchCARC(path: string, abortSignal: AbortSignal): Progressable<NARC.NitroFS> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            return NARC.parse(CX.decompress(buffer));
        });
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return Progressable.all([
            this.fetchCARC(`data/mkds/Course/${this.id}.carc`, abortSignal),
            this.fetchCARC(`data/mkds/Course/${this.id}Tex.carc`, abortSignal),
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
            }

            const c = new CourseRenderer(device, courseRenderer, skyboxRenderer);

            const courseBtaFile = courseNARC.files.find((file) => file.path === '/course_model.nsbta');
            const courseBta = courseBtaFile !== undefined ? NSBTA.parse(courseBtaFile.buffer) : null;
            if (courseBta !== null)
                courseRenderer.bindSRT0(courseBta.srt0);

            const courseBtpFile = courseNARC.files.find((file) => file.path === '/course_model.nsbtp');
            const courseBtp = courseBtpFile !== undefined ? NSBTP.parse(courseBtpFile.buffer) : null;
            if (courseBtp !== null) {
                assert(courseBtp.pat0.length === 1);
                courseRenderer.bindPAT0(device, courseBtp.pat0[0]);
            }

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
const sceneDescs = [
    "Mushroom Cup",
    new MarioKartDSSceneDesc("cross_course", "Figure-8 Circuit"),
    new MarioKartDSSceneDesc("bank_course", "Yoshi Falls"),
    new MarioKartDSSceneDesc("beach_course", "Cheep Cheep Beach"),
    new MarioKartDSSceneDesc("mansion_course", "Luigi's Mansion"),
    "Flower Cup",
    new MarioKartDSSceneDesc("desert_course", "Desert Hills"),
    new MarioKartDSSceneDesc("town_course", "Delfino Square"),
    new MarioKartDSSceneDesc("pinball_course", "Waluigi Pinball"),
    new MarioKartDSSceneDesc("ridge_course", "Shroom Ridge"),
    "Star Cup",
    new MarioKartDSSceneDesc("snow_course", "DK Pass"),
    new MarioKartDSSceneDesc("clock_course", "Tick Tock Clock"),
    new MarioKartDSSceneDesc("mario_course", "Mario Circuit"),
    new MarioKartDSSceneDesc("airship_course", "Airship Fortress"),
    "Special Cup",
    new MarioKartDSSceneDesc("stadium_course", "Wario's Stadium"),
    new MarioKartDSSceneDesc("garden_course", "Peach Gardens"),
    new MarioKartDSSceneDesc("koopa_course", "Bowser's Castle"),
    new MarioKartDSSceneDesc("rainbow_course", "Rainbow Road"),
    "Shell Cup",
    new MarioKartDSSceneDesc("old_mario_sfc", "SNES Mario Circuit 1"),
    new MarioKartDSSceneDesc("old_momo_64", "N64 Moo Moo Farm"),
    new MarioKartDSSceneDesc("old_peach_agb", "GBA Peach Cup"),
    new MarioKartDSSceneDesc("old_luigi_gc", "GCN Luigi Circuit"),
    "Banana Cup",
    new MarioKartDSSceneDesc("old_donut_sfc", "SNES Donut Plains 1"),
    new MarioKartDSSceneDesc("old_frappe_64", "N64 Frappe Snowland"),
    new MarioKartDSSceneDesc("old_koopa_agb", "GBA Bowser Castle 2"),
    new MarioKartDSSceneDesc("old_baby_gc", "GCN Baby Park"),
    "Leaf Cup",
    new MarioKartDSSceneDesc("old_noko_sfc", "SNES Koopa Beach 2"),
    new MarioKartDSSceneDesc("old_choco_64", "N64 Choco Mountain"),
    new MarioKartDSSceneDesc("old_luigi_agb", "GBA Luigi Circuit"),
    new MarioKartDSSceneDesc("old_mario_gc", "GCN Mushroom Bridge"),
    "Lightning Cup",
    new MarioKartDSSceneDesc("old_choco_sfc", "SNES Choco Island 2"),
    new MarioKartDSSceneDesc("old_hyudoro_64", "N64 Banshee Boardwalk"),
    new MarioKartDSSceneDesc("old_sky_agb", "GBA Sky Garden"),
    new MarioKartDSSceneDesc("old_yoshi_gc", "GCN Yoshi Circuit"),
    "Mission Stages",
    new MarioKartDSSceneDesc("mini_stage1", "mini_stage1"),
    new MarioKartDSSceneDesc("mini_stage2", "mini_stage2"),
    new MarioKartDSSceneDesc("mini_stage3", "mini_stage3"),
    new MarioKartDSSceneDesc("mini_stage4", "mini_stage4"),
    new MarioKartDSSceneDesc("MR_stage1", "MR_stage1"),
    new MarioKartDSSceneDesc("MR_stage2", "MR_stage2"),
    new MarioKartDSSceneDesc("MR_stage3", "MR_stage3"),
    new MarioKartDSSceneDesc("MR_stage4", "MR_stage4"),
    "Unused Test Courses",
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
