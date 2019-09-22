
// Mario Kart DS

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as NARC from './narc';
import * as NSBMD from './nsbmd';
import * as NSBTA from './nsbta';
import * as NSBTP from './nsbtp';
import * as NSBTX from './nsbtx';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass } from './render';
import { assert, readString, assertExists } from '../util';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { SceneContext } from '../SceneBase';

export class MKDSRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    public textureHolder: FakeTextureHolder;
    public objectRenderers: MDL0Renderer[] = [];

    constructor(device: GfxDevice, public courseRenderer: MDL0Renderer, public skyboxRenderer: MDL0Renderer | null) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
        this.textureHolder = new FakeTextureHolder(this.courseRenderer.viewerTextures);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        this.courseRenderer.prepareToRender(this.renderInstManager, viewerInput);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(this.renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.renderInstManager, viewerInput);
        this.renderInstManager.popTemplateRenderInst();

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.SKYBOX);
        this.renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.MAIN);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);

        this.courseRenderer.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

interface OBJI {
    objectId: number;
    routeId: number;
    objectArg0: number;
    objectArg1: number;
    objectArg2: number;
    objectArg3: number;
    showInTimeTrials: number;
    translationX: number;
    translationY: number;
    translationZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

interface NKM {
    obji: OBJI[];
}

function parseNKM(buffer: ArrayBufferSlice): NKM {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'NKMD');
    const version = view.getUint16(0x04, true);
    const headerSize = view.getUint16(0x06, true);
    const objiOffs_ = view.getUint32(0x08, true);
    assert(objiOffs_ === 0x00);

    const objiOffs = headerSize + objiOffs_;
    assert(readString(buffer, objiOffs + 0x00, 0x04) === 'OBJI');
    const objiTableCount = view.getUint32(objiOffs + 0x04, true);
    let objiTableIdx = objiOffs + 0x08;

    const obji: OBJI[] = [];
    for (let i = 0; i < objiTableCount; i++) {
        const translationX = NSBMD.fx32(view.getInt32(objiTableIdx + 0x00, true)) / 16;
        const translationY = NSBMD.fx32(view.getInt32(objiTableIdx + 0x04, true)) / 16;
        const translationZ = NSBMD.fx32(view.getInt32(objiTableIdx + 0x08, true)) / 16;
        const rotationX = NSBMD.fx32(view.getInt32(objiTableIdx + 0x0C, true)) * MathConstants.DEG_TO_RAD;
        const rotationY = NSBMD.fx32(view.getInt32(objiTableIdx + 0x10, true)) * MathConstants.DEG_TO_RAD;
        const rotationZ = NSBMD.fx32(view.getInt32(objiTableIdx + 0x14, true)) * MathConstants.DEG_TO_RAD;
        const scaleX = NSBMD.fx32(view.getInt32(objiTableIdx + 0x18, true));
        const scaleY = NSBMD.fx32(view.getInt32(objiTableIdx + 0x1C, true));
        const scaleZ = NSBMD.fx32(view.getInt32(objiTableIdx + 0x20, true));

        const objectId = view.getUint16(objiTableIdx + 0x24, true);
        const routeId = view.getUint16(objiTableIdx + 0x26, true);
        const objectArg0 = view.getUint32(objiTableIdx + 0x28, true);
        const objectArg1 = view.getUint32(objiTableIdx + 0x2C, true);
        const objectArg2 = view.getUint32(objiTableIdx + 0x30, true);
        const objectArg3 = view.getUint32(objiTableIdx + 0x34, true);
        const showInTimeTrials = view.getUint32(objiTableIdx + 0x38, true);
        obji.push({
            objectId, routeId, objectArg0, objectArg1, objectArg2, objectArg3, showInTimeTrials,
            translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ,
        });

        objiTableIdx += 0x3C;
    }

    return { obji };
}

const scratchMatrix = mat4.create();
class MarioKartDSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private fetchCARC(path: string, dataFetcher: DataFetcher): Promise<NARC.NitroFS> {
        return dataFetcher.fetchData(path).then((buffer: ArrayBufferSlice) => {
            return NARC.parse(CX.decompress(buffer));
        });
    }

    private spawnObjectFromNKM(device: GfxDevice, courseNARC: NARC.NitroFS, renderer: MKDSRenderer, obji: OBJI): void {
        function getFileBuffer(filePath: string): ArrayBufferSlice | null {
            const file = courseNARC.files.find((file) => file.path === filePath);
            if (file !== undefined)
                return file.buffer;
            else
                return null;
        }

        function setModelMtx(mdl0Renderer: MDL0Renderer, bby: boolean = false): void {
            const rotationY = bby ? 0 : obji.rotationY;
            computeModelMatrixSRT(scratchMatrix, obji.scaleX, obji.scaleY, obji.scaleZ, obji.rotationX, rotationY, obji.rotationZ, obji.translationX, obji.translationY, obji.translationZ);
            const posScale = 50;
            mat4.fromScaling(mdl0Renderer.modelMatrix, [posScale, posScale, posScale]);
            mat4.mul(mdl0Renderer.modelMatrix, mdl0Renderer.modelMatrix, scratchMatrix);
        }

        function spawnModel(filePath: string): MDL0Renderer {
            const buffer = assertExists(getFileBuffer(filePath));
            const bmd = NSBMD.parse(buffer);
            assert(bmd.models.length === 1);
            const mdl0Renderer = new MDL0Renderer(device, bmd.models[0], assertExists(bmd.tex0));
            setModelMtx(mdl0Renderer);
            renderer.objectRenderers.push(mdl0Renderer);
            return mdl0Renderer;
        }

        function parseBTA(filePath: string): NSBTA.SRT0 {
            const bta = NSBTA.parse(assertExists(getFileBuffer(filePath)));
            return bta.srt0;
        }

        function parseBTP(filePath: string): NSBTP.PAT0 {
            const btp = NSBTP.parse(assertExists(getFileBuffer(filePath)));
            assert(btp.pat0.length === 1);
            return btp.pat0[0];
        }

        function animFrame(frame: number): AnimationController {
            const a = new AnimationController();
            a.setTimeInFrames(frame);
            return a;
        }

        // Based on ObjiDatabase.xml from Mario Kart Toolbox by Gericom, Ermelber and the MKDS modding community.
        if (obji.objectId === 0x0001) { // beach_water
            const waterC = spawnModel(`/MapObj/beach_waterC.nsbmd`);
            waterC.modelMatrix[13] += 30;
        } else if (obji.objectId === 0x0003) { // town_water
            spawnModel(`/MapObj/town_waterC.nsbmd`);
        } else if (obji.objectId === 0x0006) { // yoshi_water
            spawnModel(`/MapObj/yoshi_waterC.nsbmd`);
        } else if (obji.objectId === 0x0009) { // hyudoro_water
            spawnModel(`/MapObj/hyudoro_waterC.nsbmd`);
        } else if (obji.objectId === 0x000C) { // mini_stage3_water
            const b = spawnModel(`/MapObj/mini_stage3_waterC.nsbmd`);
            b.modelMatrix[13] += 150;
        } else if (obji.objectId === 0x000D) { // puddle
            spawnModel(`/MapObj/puddle.nsbmd`);
        } else if (obji.objectId === 0x0067) { // woodbox
            const b = spawnModel(`/MapObj/woodbox1.nsbmd`);
            b.modelMatrix[13] += 32;
        } else if (obji.objectId === 0x00CA) { // koopa_block
            if (getFileBuffer(`/MapObj/koopa_block.nsbmd`) !== null)
                spawnModel(`/MapObj/koopa_block.nsbmd`);
        } else if (obji.objectId === 0x00CB) { // gear
            spawnModel(`/MapObj/gear_black.nsbmd`);
        } else if (obji.objectId === 0x00CC) { // bridge
            spawnModel(`/MapObj/bridge.nsbmd`);
        } else if (obji.objectId === 0x00CD) { // second_hand
            spawnModel(`/MapObj/second_hand.nsbmd`);
        } else if (obji.objectId === 0x00CE) { // test_cylinder
            spawnModel(`/MapObj/test_cylinder.nsbmd`);
        } else if (obji.objectId === 0x00CF) { // pendulum
            spawnModel(`/MapObj/pendulum.nsbmd`);
        } else if (obji.objectId === 0x00D0) { // rotary_room
            spawnModel(`/MapObj/rotary_room.nsbmd`);
        } else if (obji.objectId === 0x00D1) { // rotary_bridge
            spawnModel(`/MapObj/rotary_bridge.nsbmd`);
        } else if (obji.objectId === 0x00D2) { // dram
            spawnModel(`/MapObj/dram.nsbmd`);
        } else if (obji.objectId === 0x012E) { // BeachTree1
            spawnModel(`/MapObj/BeachTree1.nsbmd`);
        } else if (obji.objectId === 0x012F) { // earthen_pipe
            const b = spawnModel(`/MapObj/earthen_pipe1.nsbmd`);
            setModelMtx(b, true);
            b.modelMatrix[13] += 40;
        } else if (obji.objectId === 0x0130) { // opa_tree1
            spawnModel(`/MapObj/opa_tree1.nsbmd`);
        } else if (obji.objectId === 0x0131) { // OlgPipe1
            const b = spawnModel(`/MapObj/OlgPipe1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0132) { // OlgMush1
            const b = spawnModel(`/MapObj/OlgMush1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0133) { // of6yoshi1
            spawnModel(`/MapObj/of6yoshi1.nsbmd`);
        } else if (obji.objectId === 0x0134) { // cow
            const b = spawnModel(`/MapObj/cow.nsbmd`);
            // TODO(jstpierre): How does the game decide the BTP frame?
            // b.bindPAT0(device, parseBTP(`/MapObj/cow.nsbtp`));
        } else if (obji.objectId === 0x0136) { // mini_dokan
            const b = spawnModel(`/MapObj/mini_dokan.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0138) { // GardenTree1
            spawnModel(`/MapObj/GardenTree1.nsbmd`);
        } else if (obji.objectId === 0x013A) { // CrossTree1
            const b = spawnModel(`/MapObj/CrossTree1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x013E) { // Bank_Tree1
            spawnModel(`/MapObj/Bank_Tree1.nsbmd`);
        } else if (obji.objectId === 0x013F) { // GardenTree1
            spawnModel(`/MapObj/GardenTree1.nsbmd`);
        } else if (obji.objectId === 0x0142) { // MarioTree3
            spawnModel(`/MapObj/MarioTree3.nsbmd`);
        } else if (obji.objectId === 0x0145) { // TownTree1
            spawnModel(`/MapObj/TownTree1.nsbmd`);
        } else if (obji.objectId === 0x0146) { // Snow_Tree1
            spawnModel(`/MapObj/Snow_Tree1.nsbmd`);
        } else if (obji.objectId === 0x0148) { // DeTree1
            const b = spawnModel(`/MapObj/DeTree1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0149) { // BankEgg1
            const b = spawnModel(`/MapObj/BankEgg1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x014B) { // KinoHouse1
            spawnModel(`/MapObj/KinoHouse1.nsbmd`);
        } else if (obji.objectId === 0x014C) { // KinoHouse2
            spawnModel(`/MapObj/KinoHouse2.nsbmd`);
        } else if (obji.objectId === 0x014D) { // KinoMount1
            spawnModel(`/MapObj/KinoMount1.nsbmd`);
        } else if (obji.objectId === 0x014E) { // KinoMount2
            spawnModel(`/MapObj/KinoMount2.nsbmd`);
        } else if (obji.objectId === 0x014F) { // olaTree1c
            spawnModel(`/MapObj/olaTree1c.nsbmd`);
        } else if (obji.objectId === 0x0150) { // osaTree1c
            spawnModel(`/MapObj/osaTree1c.nsbmd`);
        } else if (obji.objectId === 0x0153) { // om6Tree1
            const b = spawnModel(`/MapObj/om6Tree1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0154) { // RainStar
            const b = spawnModel(`/MapObj/RainStar.nsbmd`);
            b.bindSRT0(parseBTA(`/MapObj/RainStar.nsbta`));
        } else if (obji.objectId === 0x0156) { // Of6Tree1
            spawnModel(`/MapObj/Of6Tree1.nsbmd`);
        } else if (obji.objectId === 0x0157) { // TownMonte
            const whichFrame = obji.objectArg0;
            const b = spawnModel(`/MapObj/TownMonte.nsbmd`);
            b.bindPAT0(device, parseBTP(`/MapObj/TownMonte.nsbtp`), animFrame(whichFrame));
        } else if (obji.objectId === 0x01A6) { // ob_pakkun_sf
            const b = spawnModel(`/MapObj/ob_pakkun_sf.nsbmd`);
            b.modelMatrix[13] += 30;
        } else if (obji.objectId === 0x01A8) { // bound
            const b = spawnModel(`/MapObj/bound.nsbmd`)!;
            b.bindPAT0(device, parseBTP(`/MapObj/bound.nsbtp`));
        } else if (obji.objectId === 0x01A9) { // flipper
            if (getFileBuffer(`/MapObj/flipper.nsbmd`) === null)
                return;
            const b = spawnModel(`/MapObj/flipper.nsbmd`);
            if (getFileBuffer(`/MapObj/flipper.nsbtp`) !== null)
                b.bindPAT0(device, parseBTP(`/MapObj/flipper.nsbtp`));
            if (getFileBuffer(`/MapObj/flipper.nsbta`) !== null)
                b.bindSRT0(parseBTA(`/MapObj/flipper.nsbta`));
            if (obji.objectArg0 === 0x01)
                mat4.rotateY(b.modelMatrix, b.modelMatrix, Math.PI * 9/8);
        } else if (obji.objectId === 0x01B4) { // cream
            spawnModel(`/MapObj/cream.nsbmd`);
        } else if (obji.objectId === 0x01B5) { // berry
            spawnModel(`/MapObj/berry.nsbmd`);
        }
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all([
            this.fetchCARC(`mkds/Course/${this.id}.carc`, dataFetcher),
            this.fetchCARC(`mkds/Course/${this.id}Tex.carc`, dataFetcher),
        ]).then(([courseNARC, textureNARC]) => {
            const courseBmdFile = assertExists(courseNARC.files.find((file) => file.path === '/course_model.nsbmd'));
            const courseBmd = NSBMD.parse(courseBmdFile.buffer);
            const courseBtxFile = textureNARC.files.find((file) => file.path === '/course_model.nsbtx');
            const courseBtx = courseBtxFile !== undefined ? NSBTX.parse(courseBtxFile.buffer) : null;
            assert(courseBmd.models.length === 1);
            const courseRenderer = new MDL0Renderer(device, courseBmd.models[0], courseBtx !== null ? courseBtx.tex0 : assertExists(courseBmd.tex0));

            let skyboxRenderer: MDL0Renderer | null = null;
            const skyboxBmdFile = courseNARC.files.find((file) => file.path === '/course_model_V.nsbmd');
            if (skyboxBmdFile !== undefined) {
                const skyboxBmd = NSBMD.parse(skyboxBmdFile.buffer);
                const skyboxBtxFile = textureNARC.files.find((file) => file.path === '/course_model_V.nsbtx');
                const skyboxBtx = skyboxBtxFile !== undefined ? NSBTX.parse(skyboxBtxFile.buffer) : null;
                assert(skyboxBmd.models.length === 1);
                skyboxRenderer = new MDL0Renderer(device, skyboxBmd.models[0], skyboxBtx !== null ? skyboxBtx.tex0 : assertExists(skyboxBmd.tex0));
                skyboxRenderer.modelMatrix[13] -= 1500;
                skyboxRenderer.isSkybox = true;
            }

            const renderer = new MKDSRenderer(device, courseRenderer, skyboxRenderer);

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

            // Now spawn objects
            const courseNKM = courseNARC.files.find((file) => file.path === '/course_map.nkm');
            if (courseNKM !== undefined) {
                const nkm = parseNKM(courseNKM.buffer);
                (renderer as any).nkm = nkm;
                for (let i = 0; i < nkm.obji.length; i++)
                    this.spawnObjectFromNKM(device, courseNARC, renderer, nkm.obji[i]);
            }

            return renderer;
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
    new MarioKartDSSceneDesc("old_kinoko_gc", "GCN Mushroom Bridge"),
    "Lightning Cup",
    new MarioKartDSSceneDesc("old_choco_sfc", "SNES Choco Island 2"),
    new MarioKartDSSceneDesc("old_hyudoro_64", "N64 Banshee Boardwalk"),
    new MarioKartDSSceneDesc("old_sky_agb", "GBA Sky Garden"),
    new MarioKartDSSceneDesc("old_yoshi_gc", "GCN Yoshi Circuit"),
    "Battle Stages",
    new MarioKartDSSceneDesc("mini_stage1", "Nintendo DS"),
    new MarioKartDSSceneDesc("mini_stage2", "Twilight House"),
    new MarioKartDSSceneDesc("mini_stage3", "Palm Shore"),
    new MarioKartDSSceneDesc("mini_stage4", "Tart Top"),
    new MarioKartDSSceneDesc("mini_block_64", "Block Fort"),
    new MarioKartDSSceneDesc("mini_dokan_gc", "Pipe Plaza"),
    "Mission Stages",
    new MarioKartDSSceneDesc("MR_stage1", "Big Bully's Stage; Chief Chilly's Stage"),
    new MarioKartDSSceneDesc("MR_stage2", "Eyerok's Stage; Big Bomb-omb's Stage"),
    new MarioKartDSSceneDesc("MR_stage3", "King Boo's Stage"),
    new MarioKartDSSceneDesc("MR_stage4", "Wiggler's Stage"),
    "Unused Test Courses",
    new MarioKartDSSceneDesc("dokan_course", "dokan_course"),
    new MarioKartDSSceneDesc("wario_course", "wario_course"),

    // These try to reference items that aren't in the archive, so we crash.
    // TODO(jstpierre): Put these back and don't crash on the missing items.
    new MarioKartDSSceneDesc("donkey_course", "donkey_course"),
    new MarioKartDSSceneDesc("luigi_course", "luigi_course"),
    new MarioKartDSSceneDesc("test1_course", "test1_course"),

    new MarioKartDSSceneDesc("test_circle", "test_circle"),
    new MarioKartDSSceneDesc("mini_block_course", "mini_block_course"),
    new MarioKartDSSceneDesc("nokonoko_course", "nokonoko_course"),
    new MarioKartDSSceneDesc("old_mario_gc", "old_mario_gc"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
