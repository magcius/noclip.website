
// Metroid Prime: Hunters

import * as Viewer from '../viewer';
import * as CX from '../Common/Compression/CX';
import * as ARC from './mph_arc';
import { parseMPH_Model, parseTEX0Texture } from './mph_binModel';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MPHRenderer, G3DPass } from './render';
import { assert, readString, assertExists } from '../util';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { SceneContext } from '../SceneBase';
import { fx32, SRT0, PAT0, parseNSBTX } from '../nns_g3d/NNS_G3D';
import { FMDLRenderer } from '../fres_nx/render';

const pathBase = `mph`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    private mountARC(arc: ARC.NitroFS): void {
        for (let i = 0; i < arc.files.length; i++) {
            const file = arc.files[i];
            this.fileDataCache.set(assertExists(file.path), file.buffer);
        }
    }

    //public async fetchFile(path: string): Promise<ArrayBufferSlice> {
    fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public async fetchMPHARC(path: string) {
        const fileData = await this.fetchFile(path);
        const arc = ARC.parse(CX.decompress(fileData));
        this.mountARC(arc);
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        if (this.fileDataCache.has(path))
            return this.fileDataCache.get(path)!;
        else
            return null;
    }
}

export class MPHSceneRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    public textureHolder: FakeTextureHolder;
    public objectRenderers: MPHRenderer[] = [];

    constructor(device: GfxDevice, public stageRenderer: MPHRenderer) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
        this.textureHolder = new FakeTextureHolder(this.stageRenderer.viewerTextures);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        this.stageRenderer.prepareToRender(this.renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.renderInstManager, viewerInput);
        this.renderInstManager.popTemplateRenderInst();

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.SKYBOX);
        this.renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.MAIN);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);

        this.stageRenderer.destroy(device);
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

//const scratchMatrix = mat4.create();
class MetroidPrimeHuntersSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public arcName: string | null, public texName: string | null) {

    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelCache = new ModelCache(dataFetcher);
        if (this.arcName !== null) {
            modelCache.fetchMPHARC(`archives/${this.arcName}.arc`);
            if (this.texName !== null)
                modelCache.fetchFile(`levels/textures/${this.texName}.bin`);
        } else {
            modelCache.fetchFile(`${this.id}.bin`);
        }
        await modelCache.waitForLoad();

        const bin_Model = modelCache.getFileData(`${this.id}.bin`);
        const stageBin = parseMPH_Model(assertExists(bin_Model));

        assert(stageBin.models.length === 1);

        const textureFile = modelCache.getFileData(`${this.id}.bin`);
        const stageTex = textureFile !== null ? parseTEX0Texture(textureFile, stageBin.mphTex) : parseTEX0Texture(assertExists(bin_Model), stageBin.mphTex);
        const stageRenderer = new MPHRenderer(device, stageBin.models[0], stageBin.tex0 !== null ? stageBin.tex0 : assertExists(stageTex));

        const renderer = new MPHSceneRenderer(device, stageRenderer);

        return renderer;
    }
}

const id = 'mph';
const name = 'Metroid Prime: Hunters';
const sceneDescs = [
    "TestRooms",
    new MetroidPrimeHuntersSceneDesc("unit1_b2_model", "biodefense chamber 06", "unit1_b2", null),
    new MetroidPrimeHuntersSceneDesc("unit2_b2_model", "biodefense chamber 05", "unit2_b2", null),
    new MetroidPrimeHuntersSceneDesc("unit3_b1_model", "biodefense chamber 03", "unit3_b1", null),
    new MetroidPrimeHuntersSceneDesc("unit3_b2_model", "biodefense chamber 08", "unit3_b2", null),
    new MetroidPrimeHuntersSceneDesc("unit4_b1_model", "biodefense chamber 04", "unit4_b1", null),
    new MetroidPrimeHuntersSceneDesc("unit4_b2_model", "biodefense chamber 07", "unit4_b2", null),
    "Multiplayer",
    new MetroidPrimeHuntersSceneDesc("mp3_Model", "Combat Hall", "mp3", "mp3_tex"),
    new MetroidPrimeHuntersSceneDesc("mp1_Model", "Data Shrine", "mp1", "mp1_tex"),
    new MetroidPrimeHuntersSceneDesc("mp7_model", "Processor Core", "mp7", "mp7_tex"),
    new MetroidPrimeHuntersSceneDesc("mp4_model", "High Ground", "mp4", "mp4_Tex"),
    new MetroidPrimeHuntersSceneDesc("mp9_model", "Ice Hive", "mp9", "mp9_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_rm2_model", "Alinos Perch", "unit1_RM2", "unit1_RM2_Tex"),
    new MetroidPrimeHuntersSceneDesc("mp12_model", "Sic Transit", "mp12", "mp12_Tex"),
    //new MetroidPrimeHuntersSceneDesc("ad1", "Transfer Lock"),
    new MetroidPrimeHuntersSceneDesc("mp11_model", "Sanctorus", "mp11", "mp11_tex"),
    new MetroidPrimeHuntersSceneDesc("mp5_Model", "Compression Chamber", "mp5", "mp5_tex"),
    new MetroidPrimeHuntersSceneDesc("mp10_model", "Incubation Vault", "mp10", "mp10_tex"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Subterranean", true),
    new MetroidPrimeHuntersSceneDesc("mp14_model", "Outer Reach", "mp14", "mp14_tex"),
    new MetroidPrimeHuntersSceneDesc("mp2_model", "Harvester", "mp2", "mp2_tex"),
    new MetroidPrimeHuntersSceneDesc("mp8_model", "Weapons Complex", "mp8", "mp8_Tex"),
    new MetroidPrimeHuntersSceneDesc("ad2_model", "Council Chamber", "ad2", "ad2_tex"),
    new MetroidPrimeHuntersSceneDesc("mp4_model", "High Ground", "mp4", "mp4_Tex"),
    new MetroidPrimeHuntersSceneDesc("mp13_model", "Fuel Stack", "mp13", "mp13_tex"),
    new MetroidPrimeHuntersSceneDesc("ctf1_model", "Fault Line", "ctf1", "ctf1_tex"),
    new MetroidPrimeHuntersSceneDesc("e3Level_Model", "Stasis Bunker", "e3Level", "e3Level_tex"),
    new MetroidPrimeHuntersSceneDesc("mp6_model", "Head Shot", "mp6", "mp6_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_Land_model", "Celestial Gateway", "unit2_Land", "unit2_land_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_land_model", "Alinos Gateway", "unit1_Land", "unit1_land_tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_land_model", "VDO Gateway", "unit3_Land", "unit3_land_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_land_model", "Arcterra Gateway", "unit4_Land", "unit4_land_tex"),
    new MetroidPrimeHuntersSceneDesc("gorea_b2_Model", "Oubliette", "Gorea_b2", "Gorea_b2_tex"),
    new MetroidPrimeHuntersSceneDesc("ad1_model", "Transfer Lock [Defence Mode]", "ad1", "ad1_tex"),
    "Celestial Archives,",
    "Alinos",
    new MetroidPrimeHuntersSceneDesc("unit1_rm3_model", "Council Chamber", "unit1_RM3", "unit1_RM3_Tex"),
    "Vesper Defense Outpost",
    "Arcterra",
    "Stronghold Void",
    new MetroidPrimeHuntersSceneDesc("TeleportRoom_model", "Cretaphid Void", "TeleportRoom", "teleportroom_tex"),
    //new MetroidPrimeHuntersSceneDesc("BigEye_C1_CZ", "Cretaphid void", "BigEye_C1_CZ", "BigEye_C1_CZ"), 
    new MetroidPrimeHuntersSceneDesc("cylinderroom_model", "Cretaphid Room", "cylinderroom", "cylinderroom_tex"),
    //new MetroidPrimeHuntersSceneDesc("BigEye_C1_CZ", "Slench void", "BigEye_C1_CZ", "BigEye_C1_CZ"), 
    new MetroidPrimeHuntersSceneDesc("bigeyeroom_model", "Slench Room", "bigeyeroom", "bigeyeroom_tex"), 
    "Oubliette",
    //"FirstHunt",
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/blueRoom", "Regulator Stage", false), 
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/e3Level_Model.bin", "Morphball Stage", false),
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp1_Model.bin", "Trooper Module", false),
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp2_Model.bin", "Assault Cradle / Survivour Stage", false),
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp3_Model.bin", "Ancient Vestige", false),
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp3_Model.bin", "MAP 5", false),
    //new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/testLevel_Model.bin", "Test Room", false),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
