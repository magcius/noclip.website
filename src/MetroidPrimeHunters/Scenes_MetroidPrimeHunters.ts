
// Metroid Prime: Hunters

import * as Viewer from '../viewer.js';
import * as CX from '../Common/Compression/CX.js';
import * as ARC from './mph_arc.js';
import { parseMPH_Model, parseTEX0Texture } from './mph_binModel.js';
import { parseMPHAnimation } from './mph_anim.js';
import { findAreaMetadata, MPHAreaMetadata, sceneIdToModelStem } from './area_metadata.js';
import { MPHEntityFile, MPHEntityMetadata, parseMPHEntities } from './entity.js';

import { DataFetcher } from '../DataFetcher.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { MPHLighting, MPHRenderer, MPHSceneMode } from './render.js';
import { assertExists } from '../util.js';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { FakeTextureHolder } from '../TextureHolder.js';
import { SceneContext } from '../SceneBase.js';
import { CameraController } from '../Camera.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';

const pathBase = `MetroidPrimeHunters`;

class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private arcPromiseCache = new Map<string, Promise<void>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public async waitForLoad(): Promise<void> {
        await Promise.all([...this.filePromiseCache.values(), ...this.arcPromiseCache.values()]);
    }

    private mountARC(arc: ARC.SNDFILE): void {
        for (let i = 0; i < arc.files.length; i++) {
            const file = arc.files[i];
            this.setFileData(assertExists(file.path), file.buffer);
        }
    }

    private setFileData(path: string, buffer: ArrayBufferSlice): void {
        this.fileDataCache.set(path.toLowerCase(), buffer);
    }

    public fetchFile(path: string): Promise<ArrayBufferSlice> {
        path = path.toLowerCase();
        const existingPromise = this.filePromiseCache.get(path);
        if (existingPromise !== undefined)
            return existingPromise;
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchMPHARC(path: string): Promise<void> {
        const existingPromise = this.arcPromiseCache.get(path);
        if (existingPromise !== undefined)
            return existingPromise;
        const p = this.fetchFile(path).then((fileData) => {
            this.mountARC(ARC.parse(CX.decompress(fileData)));
        });
        this.arcPromiseCache.set(path, p);
        return p;
    }

    public async fetchMPFile(path: string): Promise<void> {
        this.setFileData(path, await this.fetchFile(path));
    }

    public async fetchJSON<T>(path: string): Promise<T> {
        const data = await this.fetchFile(path);
        return JSON.parse(new TextDecoder().decode(data.createTypedArray(Uint8Array))) as T;
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        return this.fileDataCache.get(path.toLowerCase()) ?? null;
    }
}

export class MPHSceneRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    public stageRenderer: MPHRenderer;
    public objectRenderers: MPHRenderer[] = [];
    public entities: MPHEntityFile | null = null;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderCache;
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.5/60);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);
        this.stageRenderer.prepareToRender(renderInstManager, viewerInput);
        this.entities?.update(viewerInput.time);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy();

        this.stageRenderer.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public sceneMode: MPHSceneMode = { kind: 'singlePlayer', geometrySet: 1 }) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelCache = new ModelCache(dataFetcher);
        const [areaMetadata, entityMetadata, archiveTextures, modelArchives] = await Promise.all([
            modelCache.fetchJSON<readonly MPHAreaMetadata[]>('area_metadata.json'),
            modelCache.fetchJSON<MPHEntityMetadata>('entity_metadata.json'),
            modelCache.fetchJSON<Record<string, string>>('archive_textures.json'),
            modelCache.fetchJSON<Record<string, string>>('model_archives.json'),
        ]);
        const modelId = sceneIdToModelStem(this.id);
        const area = this.id.startsWith('mp_fh_data/') ? null :
            findAreaMetadata(areaMetadata, modelId, this.sceneMode.kind === 'multiplayer');
        const sceneMode: MPHSceneMode = this.sceneMode.kind === 'singlePlayer' && area !== null ?
            { kind: 'singlePlayer', geometrySet: area.geometrySet ?? 1 } : this.sceneMode;
        const modelFilename = area?.modelFilename ?? `${modelId}.bin`;
        const archiveName = modelArchives[modelFilename] ?? null;
        const textureFilename = archiveName !== null ? archiveTextures[archiveName] ?? null : null;
        const animationFilename = area?.animationFilename ?? `${modelId.replace(/_model$/, '_anim')}.bin`;

        if (archiveName !== null) {
            modelCache.fetchMPHARC(`archives/${archiveName}.arc`);
            if (textureFilename !== null)
                modelCache.fetchMPFile(`levels/textures/${textureFilename}`);
        } else {
            modelCache.fetchMPFile(modelFilename);
        }
        if (area !== null)
            modelCache.fetchMPFile(`levels/entities/${area.entityFilename}`);
        await modelCache.waitForLoad();

        const bin_Model = modelCache.getFileData(modelFilename);
        const stageBin = parseMPH_Model(assertExists(bin_Model));
        const entityLayerId = sceneMode.kind === 'multiplayer' && sceneMode.captureTheFlag === true ? 12 : 0;
        const entityFile = area !== null ? assertExists(modelCache.getFileData(`levels/entities/${area.entityFilename}`)) : null;
        const entities = entityFile !== null ? new MPHEntityFile(parseMPHEntities(entityFile, entityLayerId), entityMetadata, modelCache, sceneMode) : null;
        if (entities !== null) {
            entities.requestResources();
            await modelCache.waitForLoad();
        }

        const renderer = new MPHSceneRenderer(device);
        const lighting: MPHLighting | null = area !== null ? {
            colors: [
                [area.lightColor0[0] / 31, area.lightColor0[1] / 31, area.lightColor0[2] / 31],
                [area.lightColor1[0] / 31, area.lightColor1[1] / 31, area.lightColor1[2] / 31],
            ],
            directions: [
                [-area.lightVector0[0] / 0x1000, -area.lightVector0[1] / 0x1000, -area.lightVector0[2] / 0x1000],
                [-area.lightVector1[0] / 0x1000, -area.lightVector1[1] / 0x1000, -area.lightVector1[2] / 0x1000],
            ],
        } : null;

        const textureFile = textureFilename !== null ? modelCache.getFileData(`levels/textures/${textureFilename}`) : null;
        const stageTex = textureFile !== null ? parseTEX0Texture(textureFile, stageBin.mphTex) : parseTEX0Texture(assertExists(bin_Model), stageBin.mphTex);
        const animationFile = modelCache.getFileData(animationFilename);
        const animation = animationFile !== null ? parseMPHAnimation(animationFile) : null;
        renderer.stageRenderer = new MPHRenderer(device, renderer.getCache(), stageBin, stageBin.tex0 !== null ? stageBin.tex0 : assertExists(stageTex), animation, {
            sceneMode,
        });
        if (entities !== null) {
            renderer.objectRenderers.push(...entities.createRenderers(device, renderer.getCache(), assertExists(lighting)));
            renderer.entities = entities;
        }

        return renderer;
    }
}

const mp: MPHSceneMode = { kind: 'multiplayer', layout: 0 };
const mp_ctf: MPHSceneMode = { kind: 'multiplayer', layout: 0, captureTheFlag: true };

const id = 'mph';
const name = 'Metroid Prime: Hunters';
const sceneDescs = [
    "Multiplayer",
    new SceneDesc("mp3_Model", "Combat Hall", mp),
    new SceneDesc("mp1_Model", "Data Shrine", mp),
    new SceneDesc("mp7_model", "Processor Core", mp),
    new SceneDesc("unit1_RM1_model_mp", "High Ground", mp),
    new SceneDesc("mp9_model", "Ice Hive", mp),
    new SceneDesc("unit1_rm2_model_mp", "Alinos Perch", mp),
    new SceneDesc("mp12_model", "Sic Transit", mp),
    new SceneDesc("ad1_model", "Transfer Lock", mp),
    new SceneDesc("mp11_model", "Sanctorus", mp),
    new SceneDesc("mp5_Model", "Compression Chamber", mp),
    new SceneDesc("mp10_model", "Incubation Vault", mp),
    new SceneDesc("unit4_rm5_model_mp", "Subterranean", mp),
    new SceneDesc("mp14_model", "Outer Reach", mp),
    new SceneDesc("mp2_model", "Harvester", mp),
    new SceneDesc("mp8_model", "Weapons Complex", mp),
    new SceneDesc("ad2_model", "Council Chamber", mp),
    new SceneDesc("mp4_model", "Elder Passage", mp),
    new SceneDesc("mp13_model", "Fuel Stack", mp),
    new SceneDesc("ctf1_model", "Fault Line", mp_ctf),
    new SceneDesc("e3Level_Model_mp", "Stasis Bunker", mp),
    new SceneDesc("mp6_model", "Head Shot", mp),
    new SceneDesc("unit2_Land_model_mp", "Landing Bay", mp),
    new SceneDesc("unit1_land_model_mp", "Alinos Landfall", mp),
    new SceneDesc("unit3_land_model_mp", "Vesper Starport", mp),
    new SceneDesc("unit4_land_model_mp", "Arcterra Base", mp),
    new SceneDesc("gorea_b2_Model_mp", "Oubliette", mp),
    "Celestial Archives",
    new SceneDesc("unit2_Land_model", "Celestial Gateway"),
    new SceneDesc("unit2_c0_model", "Helm Room"),
    new SceneDesc("unit2_c1_model", "Meditation Room"),
    new SceneDesc("unit2_c2_model", "Fan Room Alpha"),
    new SceneDesc("unit2_c3_model", "Fan Room Beta"),
    new SceneDesc("unit2_RM3_model", "Data Shrine 03"),
    new SceneDesc("unit2_c4_model", "Synergy Core"),
    new SceneDesc("unit2_rm4_model", "Transfer Lock"),
    new SceneDesc("unit2_rm8_model", "Docking Bay"),
    new SceneDesc("unit2_c6_model", "Tetra Vista"),
    new SceneDesc("unit2_c7_model", "New Arrival Registration"),
    new SceneDesc("unit2_cx_model", "1_CX"),
    new SceneDesc("unit2_cz_model", "1_CZ"),
    "Alinos",
    new SceneDesc("unit1_land_model", "Alinos Gateway"),
    new SceneDesc("unit1_c0_model", "Echo Hall"),
    new SceneDesc("unit1_RM1_model", "High Ground"),
    new SceneDesc("unit1_rm6_model", "Elder Passage"),
    new SceneDesc("unit1_c1_model", "Alimbic Gardens"),
    new SceneDesc("unit1_c2_model", "Thermal Vast"),
    new SceneDesc("unit1_rm2_model", "Alinos Perch"),
    new SceneDesc("unit1_rm3_model", "Council Chamber"),
    new SceneDesc("unit1_c3_model", "Crash Site"),
    new SceneDesc("unit1_c4_model", "Magma Drop"),
    new SceneDesc("unit1_c5_model", "Piston Cave"),
    new SceneDesc("crystalroom_model", "Alimbic Cannon Control Room"),
    new SceneDesc("unit1_cx_model", "1_CX"),
    new SceneDesc("unit1_cz_model", "1_CZ"),
    new SceneDesc("unit1_morph_cx_model", "1_morphCX"),
    new SceneDesc("unit1_morph_cz_model", "1_morphCZ"),
    new SceneDesc("unit1_rm1_cx_model", "1_RM_CX"),
    "Vesper Defense Outpost",
    new SceneDesc("unit3_land_model", "VDO Gateway"),
    new SceneDesc("unit3_c0_model", "Bioweaponry Lab"),
    new SceneDesc("unit3_rm1_model", "Weapons Complex"),
    new SceneDesc("unit3_c2_model", "Cortex CPU"),
    new SceneDesc("e3Level_Model", "Stasis Bunker"),
    new SceneDesc("unit3_c1_model", "Ascension"),
    new SceneDesc("unit3_rm2_model", "Fuel Stack"),
    new SceneDesc("unit3_cx_model", "3_CX"),
    new SceneDesc("unit3_cz_model", "3_CZ"),
    new SceneDesc("unit3_morph_cz_model", "3_morphCZ"),
    "Arcterra",
    new SceneDesc("unit4_land_model", "Arcterra Gateway"),
    new SceneDesc("unit4_rm1_model", "Ice Hive"),
    new SceneDesc("unit4_c0_model", "Frost Labyrinth"),
    new SceneDesc("unit4_rm5_model", "Subterranean"),
    new SceneDesc("unit4_c1_model", "Drip Moat"),
    new SceneDesc("unit4_rm2_model", "Fault Line"),
    new SceneDesc("unit4_cx_model", "4_CX"),
    new SceneDesc("unit4_cz_model", "4_CZ"),
    "Stronghold Void",
    new SceneDesc("TeleportRoom_model", "Stronghold Gateway"),
    new SceneDesc("Cylinder_C1_model", "Biodefense Chamber A Connect"),
    new SceneDesc("cylinderroom_model", "Biodefense Chamber A"),
    new SceneDesc("bigeye_c1_model", "Biodefense Chamber B Connect"),
    new SceneDesc("bigeyeroom_model", "Biodefense Chamber B"),
    "Oubliette",
    new SceneDesc("Gorea_Land_Model", "Oubliette Gateway"),
    new SceneDesc("Gorea_b1_Model", "Gorea Room"),
    new SceneDesc("gorea_b2_Model", "Gorea Soul Room"),
    new SceneDesc("Gorea_c1_Model", "Gorea Connect Room(unused)"),
    "TestRooms",
    new SceneDesc("unit1_b2_model", "biodefense chamber 06"),
    new SceneDesc("unit2_b2_model", "biodefense chamber 05"),
    new SceneDesc("unit3_b1_model", "biodefense chamber 03"),
    new SceneDesc("unit3_b2_model", "biodefense chamber 08"),
    new SceneDesc("unit4_b1_model", "biodefense chamber 04"),
    new SceneDesc("unit4_b2_model", "biodefense chamber 07"),
    "FirstHunt",
    new SceneDesc("mp_fh_data/levels/models/blueRoom_Model", "Regulator Stage"),
    new SceneDesc("mp_fh_data/levels/models/e3Level_Model", "Morphball Stage"),
    new SceneDesc("mp_fh_data/levels/models/mp1_Model", "Trooper Module"),
    new SceneDesc("mp_fh_data/levels/models/mp2_Model", "Assault Cradle / Survivour Stage"),
    new SceneDesc("mp_fh_data/levels/models/mp3_Model", "Ancient Vestige"),
    new SceneDesc("mp_fh_data/levels/models/mp5_Model", "MAP 5"),
    new SceneDesc("mp_fh_data/levels/models/testLevel_Model", "Test Room"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
