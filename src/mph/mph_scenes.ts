
// Metroid Prime: Hunters

import * as Viewer from '../viewer';
import * as CX from '../Common/Compression/CX';
import * as ARC from './mph_arc';
import { parseMPH_Model } from './mph_binModel';

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
    private fetchFile(path: string): Promise<ArrayBufferSlice> {
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

const scratchMatrix = mat4.create();
class MetroidPrimeHuntersSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {

    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelCache = new ModelCache(dataFetcher);

        modelCache.fetchMPHARC(`archives/${this.id}.arc`);
        //modelCache.fetchFile(`levels/textures/${this.id}.bin`);
        await modelCache.waitForLoad();

        const stageBin = parseMPH_Model(assertExists(modelCache.getFileData(`${this.id}_model.bin`)));
        assert(stageBin.models.length === 1);

        const textureFile = modelCache.getFileData(`${this.id}.bin`);
        const stageTex = textureFile !== null ? parseNSBTX(textureFile) : null;
        const stageRenderer = new MPHRenderer(device, stageBin.models[0], stageBin.tex0 !== null ? stageBin.tex0 : assertExists(assertExists(stageTex).tex0));

        const renderer = new MPHSceneRenderer(device, stageRenderer);

        return renderer;
    }
}

const id = 'mph';
const name = 'Metroid Prime: Hunters';
const sceneDescs = [
    "TestRooms",
    new MetroidPrimeHuntersSceneDesc("unit1_b2", "biodefense chamber 06"),
    new MetroidPrimeHuntersSceneDesc("unit2_b2", "biodefense chamber 05"),
    new MetroidPrimeHuntersSceneDesc("unit3_b1", "biodefense chamber 03"),
    new MetroidPrimeHuntersSceneDesc("unit3_b2", "biodefense chamber 08"),
    new MetroidPrimeHuntersSceneDesc("unit4_b1", "biodefense chamber 04"),
    new MetroidPrimeHuntersSceneDesc("unit4_b2", "biodefense chamber 07"),
    "Multiplayer",
    new MetroidPrimeHuntersSceneDesc("mp3", "Combat Hall"),
    new MetroidPrimeHuntersSceneDesc("mp1", "Data Shrine"),
    //new MetroidPrimeHuntersSceneDesc("mp7", "Processor Core"),
    //new MetroidPrimeHuntersSceneDesc("mp4", "High Ground"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Ice Hive"),
    //new MetroidPrimeHuntersSceneDesc("unit1_rm2", "Alinos Perch"),
    new MetroidPrimeHuntersSceneDesc("mp12", "Sic Transit"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Transfer Lock"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Sanctorus"),
    //new MetroidPrimeHuntersSceneDesc("mp8", "Compression Chamber"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Incubation Vault"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Subterranean"),
    new MetroidPrimeHuntersSceneDesc("mp14", "Outer Reach"),
    new MetroidPrimeHuntersSceneDesc("mp2", "Harvester"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Weapons Complex"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Council Chamber"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Elder Passage"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Fuel Stack"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Fault Line"),
    new MetroidPrimeHuntersSceneDesc("e3Level", "Stasis Bunker"),
    new MetroidPrimeHuntersSceneDesc("mp6", "Head Shot"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Celestial Gateway"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Alinos Gateway"),
    //new MetroidPrimeHuntersSceneDesc("mp", "VDO Gateway"),
    //new MetroidPrimeHuntersSceneDesc("mp", "Arcterra Gateway"),
    new MetroidPrimeHuntersSceneDesc("Gorea_b2", "Oubliette"),
    "Celestial Archives,",
    "Alinos",
    "Vesper Defense Outpost",
    "Arcterra",
    "Stronghold Void",
    "Oubliette",
    "FirstHunt",
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
