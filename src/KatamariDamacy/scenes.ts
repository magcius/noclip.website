
import * as Viewer from '../viewer';
import { GfxDevice, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import { DataFetcher } from "../DataFetcher";
import * as BIN from "./bin";
import { BINModelInstance, BINModelSectorData, KatamariDamacyProgram } from './render';
import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists } from '../util';
import { fillMatrix4x4, fillVec3v } from '../gfx/helpers/UniformBufferHelpers';
import { Camera, CameraController } from '../Camera';
import { ColorTexture, BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { TextureMapping, FakeTextureHolder } from '../TextureHolder';
import { SceneContext } from '../SceneBase';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { gsMemoryMapNew } from '../Common/PS2/GS';
import { Vec3Zero } from '../MathHelpers';
import { ObjectRenderer } from './objects';
import { drawWorldSpaceLine, getDebugOverlayCanvas2D, drawWorldSpaceText } from '../DebugJunk';
import { Magenta } from '../Color';

const pathBase = `katamari_damacy`;

class LevelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const v: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(v);
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(path);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string): void {
        const p = this.filePromiseCache.get(path);
        if (p === undefined) {
            this.fetchFile(path).then((data) => {
                this.fileDataCache.set(path, data);
            });
        }
    }

    public getFileData(path: string): ArrayBufferSlice {
        return assertExists(this.fileDataCache.get(path));
    }
}

function getStageAreaFilePath(filename: string): string {
    return `${pathBase}/1879b0/${filename}.bin`;
}

function getMissionSetupFilePath(filename: string): string {
    return `${pathBase}/17f590/${filename}.bin`;
}

class StageAreaSector {
    public modelInstance: BINModelInstance[] = [];
}

class StageAreaRenderer {
    public stageAreaSector: StageAreaSector[] = [];
    public modelInstance: BINModelInstance[] = [];

    constructor(private areaIndex: number) {
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewRenderer: Viewer.ViewerRenderInput) {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].prepareToRender(renderInstManager, viewRenderer, katamariWorldSpaceToNoclipSpace, 0);
    }

    public setVisible(visible: boolean): void {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].setVisible(visible);
    }

    public setActiveAreaNo(areaNo: number): void {
        this.setVisible(areaNo === this.areaIndex);
    }
}

interface LightingConfiguration {
    topColor: vec3;
    topDir: vec3;
    bottomColor: vec3;
    bottomDir: vec3;
    ambient: vec3;
}

// from a table at 17BE40 in the ELF
const lightingData: LightingConfiguration[] = [
    {
        topColor: vec3.fromValues(.6, .59, .55),
        topDir: vec3.fromValues(-.1, 1, .2),
        bottomColor: vec3.fromValues(.04, .04, .05),
        bottomDir: vec3.fromValues(0, -1, 0),
        ambient: vec3.fromValues(.39, .375, .415),
    },
    {
        topColor: vec3.fromValues(.56, .55, .52),
        topDir: vec3.fromValues(.25, 1, -.65),
        bottomColor: vec3.fromValues(.08, .07, .1),
        bottomDir: vec3.fromValues(0, -1, 0),
        ambient: vec3.fromValues(.36, .36, .37),
    },
    {
        topColor: vec3.fromValues(.56, .56, .55),
        topDir: vec3.fromValues(.15, 1, -.2),
        bottomColor: vec3.fromValues(.13, .145, .15),
        bottomDir: vec3.fromValues(0, -1, 0),
        ambient: vec3.fromValues(.39, .375, .4),
    },
    {
        topColor: vec3.fromValues(.6, .55, .5),
        topDir: vec3.fromValues(.3, .5, .4),
        bottomColor: vec3.fromValues(.04, .04, .1),
        bottomDir: vec3.fromValues(-.3, -.5, -.4),
        ambient: vec3.fromValues(.2, .18, .3),
    },
    {
        topColor: vec3.fromValues(.6, .59, .55),
        topDir: vec3.fromValues(.2, 1, .1),
        bottomColor: vec3.fromValues(.04, .04, .05),
        bottomDir: vec3.fromValues(0, -1, 0),
        ambient: vec3.fromValues(.55, .5, .6),
    },
];

const lightingSetupList: number[] = [0, 0, 1, 2, 0, 0, 0, 0, 0, 3, 4, 0, 0];

const lightDirScratch = vec3.create();
function fillSceneParamsData(d: Float32Array, camera: Camera, lightingIndex: number = -1, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
    if (lightingIndex === -1) {
        for (let i = 0; i < 5; i++)
            offs += fillVec3v(d, offs, Vec3Zero);
    } else {
        const usedIndex = lightingSetupList[lightingIndex];
        vec3.normalize(lightDirScratch, lightingData[usedIndex].topDir);
        offs += fillVec3v(d, offs, lightDirScratch);
        vec3.normalize(lightDirScratch, lightingData[usedIndex].bottomDir);
        offs += fillVec3v(d, offs, lightDirScratch);

        offs += fillVec3v(d, offs, lightingData[usedIndex].topColor);
        offs += fillVec3v(d, offs, lightingData[usedIndex].bottomColor);
        offs += fillVec3v(d, offs, lightingData[usedIndex].ambient);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

function mod(a: number, b: number) {
    return (a + b) % b;
}

class KatamariDamacyRenderer implements Viewer.SceneGfx {
    private currentAreaNo: number = 0;
    private sceneTexture = new ColorTexture();
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public modelSectorData: BINModelSectorData[] = [];
    public framebufferTextureMapping = new TextureMapping();
    public textureHolder = new FakeTextureHolder([]);
    public currentPalette: number = 0;
    public areaCollision: BIN.CollisionList[][][] = [];

    public stageAreaRenderers: StageAreaRenderer[] = [];
    public objectRenderers: ObjectRenderer[] = [];

    public sceneMoveSpeedMult = 8/60;
    public motionCache: Map<number, BIN.MotionParameters | null> | null;
    private drawPaths = false;

    constructor(device: GfxDevice, public levelParams: BIN.LevelParameters, public missionSetupBin: BIN.LevelSetupBIN) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public addTextureData(sector: BINModelSectorData): void {
        for (let i = 0; i < sector.textureData.length; i++)
            [].push.apply(this.textureHolder.viewerTextures, sector.textureData[i].viewerTexture);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(this.sceneMoveSpeedMult);
    }

    private drawPath(viewerInput: Viewer.ViewerRenderInput, n: Float32Array): void {
        const scratchMatrix = mat4.create();
        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, katamariWorldSpaceToNoclipSpace);

        assert((n.length % 4) === 0);
        const numPoints = n.length / 4;

        const p0 = vec3.create();
        const p1 = vec3.create();
        for (let i = 1; i < numPoints + 1; i++) {
            const i0 = mod(i - 1, numPoints), i1 = mod(i, numPoints);
            vec3.set(p0, n[i0*4+0], n[i0*4+1], n[i0*4+2]);
            vec3.set(p1, n[i1*4+0], n[i1*4+1], n[i1*4+2]);
            drawWorldSpaceLine(getDebugOverlayCanvas2D(), scratchMatrix, p0, p1);
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        this.framebufferTextureMapping.gfxTexture = this.sceneTexture!.gfxTexture;
        renderInstManager.simpleRenderInstList!.resolveLateSamplerBinding('framebuffer', this.framebufferTextureMapping);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();

        if (this.motionCache !== null && this.drawPaths) {
            for (const [k, v] of this.motionCache.entries()) {
                if (v === null)
                    continue;
                this.drawPath(viewerInput, v.pathPoints);
            }
        }

        return passRenderer;
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentAreaNo);
        return offs;
    }

    public deserializeSaveState(src: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(src);
        if (offs < byteLength)
            this.setCurrentAreaNo(view.getUint8(offs++));
        return offs;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const offs = template.allocateUniformBuffer(KatamariDamacyProgram.ub_SceneParams, 16 + 20);
        const sceneParamsMapped = template.mapUniformBufferF32(KatamariDamacyProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, this.levelParams.lightingIndex, offs);

        let activeArea = 0;
        for (let i = 0; i < this.missionSetupBin.activeStageAreas.length; i++)
            if (this.missionSetupBin.activeStageAreas[i] === this.currentAreaNo) {
                activeArea = i;
                break;
            }

        for (let i = 0; i < this.stageAreaRenderers.length; i++)
            this.stageAreaRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, katamariWorldSpaceToNoclipSpace,
                this.currentPalette, this.missionSetupBin.zones, this.areaCollision[activeArea]);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public setCurrentAreaNo(areaNo: number): void {
        this.currentAreaNo = areaNo;
        for (let i = 0; i < this.stageAreaRenderers.length; i++)
            this.stageAreaRenderers[i].setActiveAreaNo(areaNo);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setActiveAreaNo(areaNo);
    }

    public createPanels(): UI.Panel[] {
        const areasPanel = new UI.Panel();
        areasPanel.setTitle(UI.LAYER_ICON, 'Areas');
        areasPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;

        const areaSelect = new UI.SingleSelect();
        areaSelect.setStrings(this.stageAreaRenderers.map((renderer, i) => `Area ${i+1}`));
        areaSelect.onselectionchange = (index: number) => {
            const areaNo = this.missionSetupBin.activeStageAreas[index];
            this.setCurrentAreaNo(areaNo);
        };
        areaSelect.selectItem(this.currentAreaNo);
        areasPanel.contents.appendChild(areaSelect.elem);

        const palettePanel = new UI.Panel();
        palettePanel.setTitle(UI.TIME_OF_DAY_ICON, 'Palette');
        palettePanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;

        const paletteSelect = new UI.SingleSelect();
        paletteSelect.setStrings(['Uncollected', 'Collected']);
        paletteSelect.onselectionchange = (index: number) => {
            this.currentPalette = index;
        };
        paletteSelect.selectItem(this.currentPalette);
        palettePanel.contents.append(paletteSelect.elem);

        return [areasPanel, palettePanel];
    }

    public destroy(device: GfxDevice): void {
        this.sceneTexture.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelSectorData.length; i++)
            this.modelSectorData[i].destroy(device);
    }
}

const katamariWorldSpaceToNoclipSpace = mat4.create();
mat4.rotateX(katamariWorldSpaceToNoclipSpace, katamariWorldSpaceToNoclipSpace, Math.PI);

class KatamariLevelSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, private index: number, public name: string, public cameraSpeedMult: number = 1) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const cache = new LevelCache(dataFetcher);

        cache.fetchFileData(`${pathBase}/transformBlock.bin`);
        cache.fetchFileData(`${pathBase}/randomBlock.bin?cache_bust=1`);
        cache.fetchFileData(`${pathBase}/levelBlock.bin`);
        cache.fetchFileData(`${pathBase}/missionBlock.bin`);
        cache.fetchFileData(`${pathBase}/pathBlock.bin`);
        cache.fetchFileData(`${pathBase}/movementBlock.bin`);
        cache.fetchFileData(`${pathBase}/objectBlock.bin`);
        cache.fetchFileData(`${pathBase}/parentBlock.bin`);

        await cache.waitForLoad();

        // first load level-specific data
        const levelParams = BIN.parseLevelParameters(this.index, cache.getFileData(`${pathBase}/levelBlock.bin`), cache.getFileData(`${pathBase}/missionBlock.bin`),);
        for (let i = 0; i < levelParams.missionSetupFiles.length; i++)
            cache.fetchFileData(getMissionSetupFilePath(levelParams.missionSetupFiles[i]));
        await cache.waitForLoad();

        // Parse through the mission setup data to get our stage spawns.
        const buffers: ArrayBufferSlice[] = [];
        for (let i = 0; i < levelParams.missionSetupFiles.length; i++)
            buffers.push(cache.getFileData(getMissionSetupFilePath(levelParams.missionSetupFiles[i])));

        const randomGroups = BIN.initRandomGroups(this.index, cache.getFileData(`${pathBase}/randomBlock.bin?cache_bust=1`));
        const missionSetupBin = BIN.parseMissionSetupBIN(buffers, levelParams.startArea, randomGroups, cache.getFileData(`${pathBase}/transformBlock.bin`));

        const renderer = new KatamariDamacyRenderer(device, levelParams, missionSetupBin);
        renderer.sceneMoveSpeedMult *= this.cameraSpeedMult;
        const gfxCache = renderer.renderHelper.getCache();

        for (let i = 0; i < missionSetupBin.activeStageAreas.length; i++) {
            cache.fetchFileData(getStageAreaFilePath(stageTextures[levelParams.stageAreaIndex + i]));
            cache.fetchFileData(getStageAreaFilePath(stageModels[levelParams.stageAreaIndex + i]));
        }
        await cache.waitForLoad();

        const motionData = cache.getFileData(`${pathBase}/movementBlock.bin`);
        const pathData = cache.getFileData(`${pathBase}/pathBlock.bin`);
        const objectData = cache.getFileData(`${pathBase}/objectBlock.bin`);
        const parentData = cache.getFileData(`${pathBase}/parentBlock.bin`);

        const gsMemoryMap = gsMemoryMapNew();

        // Parse our different stages.
        for (let i = 0; i < missionSetupBin.activeStageAreas.length; i++) {
            const stageAreaIndex = missionSetupBin.activeStageAreas[i];

            const stageTexBinData = cache.getFileData(getStageAreaFilePath(stageTextures[levelParams.stageAreaIndex + i]));
            const stageModelBinData = cache.getFileData(getStageAreaFilePath(stageModels[levelParams.stageAreaIndex + i]));
            BIN.parseStageTextureBIN(stageTexBinData, gsMemoryMap);
            const stageModelBin = BIN.parseLevelModelBIN(stageModelBinData, gsMemoryMap, this.id);
            renderer.areaCollision.push(stageModelBin.collision);

            const stageAreaRenderer = new StageAreaRenderer(stageAreaIndex);

            for (let j = 0; j < stageModelBin.sectors.length; j++) {
                const sector = stageModelBin.sectors[j];

                const stageAreaSector = new StageAreaSector();

                const binModelSectorData = new BINModelSectorData(device, gfxCache, sector);
                renderer.modelSectorData.push(binModelSectorData);
                renderer.addTextureData(binModelSectorData);

                for (let k = 0; k < sector.models.length; k++) {
                    const binModelInstance = new BINModelInstance(device, gfxCache, binModelSectorData.modelData[k]);
                    stageAreaRenderer.modelInstance.push(binModelInstance);
                    stageAreaSector.modelInstance.push(binModelInstance);
                }

                stageAreaRenderer.stageAreaSector.push(stageAreaSector);
            }

            renderer.stageAreaRenderers.push(stageAreaRenderer);
        }

        const objectDatas: BINModelSectorData[] = [];
        for (let i = 0; i < missionSetupBin.objectModels.length; i++) {
            const objectModel = missionSetupBin.objectModels[i];

            const binModelSectorData = new BINModelSectorData(device, gfxCache, objectModel.sector);
            renderer.addTextureData(binModelSectorData);
            objectDatas.push(binModelSectorData);
            renderer.modelSectorData.push(binModelSectorData);
        }

        const motionCache = new Map<number, BIN.MotionParameters | null>();
        renderer.motionCache = motionCache;
        const objectCache = new Map<number, BIN.ObjectDefinition | null>();
        for (let area = 0; area < missionSetupBin.objectSpawns.length; area++) {
            const areaStartIndex = renderer.objectRenderers.length;
            if (missionSetupBin.objectSpawns[area].length === 0)
                continue;
            for (let i = 0; i < missionSetupBin.objectSpawns[area].length; i++) {
                const objectSpawn = missionSetupBin.objectSpawns[area][i];
                let motion: BIN.MotionParameters | null = null;
                if (objectSpawn.moveType >= 0) { // level 27 has a bunch of negative indices that aren't -1
                    if (!motionCache.has(objectSpawn.moveType))
                        motionCache.set(objectSpawn.moveType, BIN.parseMotion(pathData, motionData, this.index, objectSpawn.moveType));
                    motion = motionCache.get(objectSpawn.moveType)!;
                }

                if (!objectCache.has(objectSpawn.objectId))
                    objectCache.set(objectSpawn.objectId, BIN.parseObjectDefinition(objectData, objectSpawn.objectId));
                const objectDef = objectCache.get(objectSpawn.objectId)!;

                const modelInstances: BINModelInstance[] = [];
                const binModelSectorData = objectDatas[objectSpawn.modelIndex];
                const objectModel = missionSetupBin.objectModels[objectSpawn.modelIndex];
                for (let j = 0; j < binModelSectorData.modelData.length; j++) {
                    const binModelInstance = new BINModelInstance(device, gfxCache, binModelSectorData.modelData[j]);
                    mat4.copy(binModelInstance.modelMatrix, objectSpawn.modelMatrix);
                    if (objectModel.transforms.length > 0) {
                        mat4.mul(binModelInstance.modelMatrix, binModelInstance.modelMatrix, objectModel.transforms[j].matrix);
                        vec3.copy(binModelInstance.euler, objectModel.transforms[j].rotation);
                        vec3.copy(binModelInstance.translation, objectModel.transforms[j].translation);
                    }
                    modelInstances.push(binModelInstance);
                }

                const objectRenderer = new ObjectRenderer(objectSpawn, missionSetupBin.objectModels[objectSpawn.modelIndex].bbox, objectDef, modelInstances, motion);
                renderer.objectRenderers.push(objectRenderer);
            }
            const parentList = BIN.getParentList(parentData, this.index, area);
            if (parentList !== null) {
                for (let j = 0; parentList[j] >= 0; j += 2) {
                    if (parentList[j+1] < 0) // just set parent flag on object
                        continue;
                    const childIdx = missionSetupBin.objectSpawns[area].findIndex((spawn) => spawn.tableIndex === parentList[j]);
                    const parentIdx = missionSetupBin.objectSpawns[area].findIndex((spawn) => spawn.tableIndex === parentList[j+1]);
                    if (childIdx < 0 || parentIdx < 0)
                        continue; // these seem to be the unnamed objects we are skipping
                    assert(childIdx > parentIdx); // ensure proper processing order
                    renderer.objectRenderers[areaStartIndex + childIdx].setParent(renderer.objectRenderers[areaStartIndex + parentIdx]);
                }
            }
        }
        return renderer;
    }
}

const id = 'katamari_damacy';
const name = 'Katamari Damacy';

// commented out files have been replaced by identical files to reduce loading

// table at 1879b0 in elf
const stageTextures: string[] = [
    '135042',
    '135049', '135049', '135049', '135049', //'1350c3', '13513d', '1351b7',
    '135231', '135231', '135231', '135231', // '135299', '135301', '135369',
    '1353d1', '1353d1', '1353d1', /*'13548c', '135547',*/ '135602', '135745',
    '135753', '135778', '1357a5',
    '1357de', '135834', '135840', '135840', //'1358c5',
    '13594a', '13594d', '135972', '1353d1', //'135a20',
];

// table at 187b40 in elf
const stageModels: string[] = [
    '135adb',
    '135b75', '135c43', '135d18', '135ded',
    '135ebf', '135fe0', '13612f', '136282',
    '1363c5', '1364a3', '136599', '1366d7', '136797',
    '1367a0', '1367af', '1367be',
    '1367cd', '13681e', '13685f', '13685f', // '1368f2', 
    '136985', '13698a', '13699b', '1369ae',
    '136a83',
];

const sceneDescs = [
    "Planets",
    new KatamariLevelSceneDesc('lvl1', 1, "Make a Star 1 (House)"),
    new KatamariLevelSceneDesc('lvl2', 2, "Make a Star 2 (House)"),
    new KatamariLevelSceneDesc('lvl3', 4, "Make a Star 3 (Town)"),
    new KatamariLevelSceneDesc('lvl4', 3, "Make a Star 4 (House)"),
    new KatamariLevelSceneDesc('lvl5', 5, "Make a Star 5 (Town)"),
    new KatamariLevelSceneDesc('lvl6', 6, "Make a Star 6 (World)"),
    new KatamariLevelSceneDesc('lvl7', 7, "Make a Star 7 (World)"),
    new KatamariLevelSceneDesc('lvl8', 8, "Make a Star 8 (Town)"),
    new KatamariLevelSceneDesc('lvl9', 9, "Make a Star 9 (World)"),
    new KatamariLevelSceneDesc('lvl10', 10, "Make the Moon (World)", 100),

    "Constellations",
    new KatamariLevelSceneDesc('clvl1', 11, "Make Cancer"),
    new KatamariLevelSceneDesc('clvl2', 12, "Make Cygnus"),
    new KatamariLevelSceneDesc('clvl3', 14, "Make Corona Borealis"),
    new KatamariLevelSceneDesc('clvl4', 18, "Make Gemini"),
    new KatamariLevelSceneDesc('clvl5', 17, "Make Ursa Major"),
    new KatamariLevelSceneDesc('clvl6', 19, "Make Taurus"),
    new KatamariLevelSceneDesc('clvl7', 15, "Make Pisces"),
    new KatamariLevelSceneDesc('clvl8', 16, "Make Virgo"),

    new KatamariLevelSceneDesc('clvl9', 21, "Make the North Star"),

    "Special Levels",
    new KatamariLevelSceneDesc('slvl28', 28, "Tutorial"),
    new KatamariLevelSceneDesc('slvl29', 29, "Credits"),
    // new KatamariLevelSceneDesc('slvl30', 30, "Load"), same as snow?

    "Multiplayer",
    new KatamariLevelSceneDesc('mplvl1', 31, "Multiplayer Level 1"),
    new KatamariLevelSceneDesc('mplvl2', 32, "Multiplayer Level 2"),
    new KatamariLevelSceneDesc('mplvl3', 33, "Multiplayer Level 3"),
    new KatamariLevelSceneDesc('mplvl4', 34, "Multiplayer Level 4"),
    new KatamariLevelSceneDesc('mplvl5', 35, "Multiplayer Level 5"),
    new KatamariLevelSceneDesc('mplvl6', 36, "Multiplayer Level 6"),
    new KatamariLevelSceneDesc('mplvl7', 37, "Multiplayer Level 7"),
    new KatamariLevelSceneDesc('mplvl8', 38, "Multiplayer Level 8"),

    "Unused Levels",
    new KatamariLevelSceneDesc('snow', 0, "Snow"),
    new KatamariLevelSceneDesc('ulvl13', 13, "13"),
    new KatamariLevelSceneDesc('ulvl20', 20, "20"),
    new KatamariLevelSceneDesc('ulvl25', 25, "Seagull Park Demo"), // store demo
    new KatamariLevelSceneDesc('ulvl26', 26, "26"),
    new KatamariLevelSceneDesc('ulvl27', 27, "27"),
    new KatamariLevelSceneDesc('ulvl39', 39, "Demo Island Demo"),
    new KatamariLevelSceneDesc('ulvl40', 40, "Test 0"),
    new KatamariLevelSceneDesc('ulvl41', 41, "Test 1"),
    new KatamariLevelSceneDesc('ulvl42', 42, "Test 2"),
    new KatamariLevelSceneDesc('ulvl43', 43, "Test 3"),
];
const sceneIdMap = new Map<string, string>();
// When I first was testing Katamari, I was testing the Tutorial Level. At some point
// I changed to Make a Star 1, but didn't change the ID before pushing live. So that's
// why the level file for the Tutorial maps to Make a Star 1.
sceneIdMap.set('13698a', 'lvl1');
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, sceneIdMap };
