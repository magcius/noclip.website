
import * as Viewer from '../viewer';
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import * as BIN from "./bin";
import { BINModelInstance, BINModelSectorData, KatamariDamacyTextureHolder, KatamariDamacyProgram } from './render';
import { mat4 } from 'gl-matrix';
import * as UI from '../ui';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists } from '../util';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { GfxRenderInst, GfxRenderInstBuilder, GfxRenderInstViewRenderer, GfxRenderInstBuilderDynamic } from '../gfx/render/GfxRenderer';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { Camera } from '../Camera';
import { ColorTexture, BasicRenderTarget, standardFullClearRenderPassDescriptor, noClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { TextureOverride } from '../TextureHolder';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';

const pathBase = `katamari_damacy`;

interface StageAreaFileGroup {
    texFile: string;
    modelFile: string;
}

class LevelCache {
    private fileProgressableCache = new Map<string, Progressable<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();

    public waitForLoad(): Progressable<any> {
        const v: Progressable<any>[] = [... this.fileProgressableCache.values()];
        return Progressable.all(v);
    }

    private fetchFile(path: string, abortSignal: AbortSignal): Progressable<ArrayBufferSlice> {
        assert(!this.fileProgressableCache.has(path));
        const p = fetchData(path, abortSignal);
        this.fileProgressableCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string, abortSignal: AbortSignal): void {
        const p = this.fileProgressableCache.get(path);
        if (p === undefined) {
            this.fetchFile(path, abortSignal).then((data) => {
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

class ObjectRenderer {
    public modelInstance: BINModelInstance[] = [];

    constructor(public objectSpawn: BIN.MissionSetupObjectSpawn) {
    }

    public prepareToRender(textureHolder: KatamariDamacyTextureHolder, viewRenderer: Viewer.ViewerRenderInput) {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].prepareToRender(textureHolder, viewRenderer);
    }

    public setVisible(visible: boolean): void {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].setVisible(visible);
    }

    public setActiveAreaNo(areaNo: number): void {
        const visible = areaNo >= this.objectSpawn.dispOnAreaNo && ((areaNo < this.objectSpawn.dispOffAreaNo) || this.objectSpawn.dispOffAreaNo === -1);
        this.setVisible(visible);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].destroy(device);
    }
}

class StageAreaSector {
    public modelInstance: BINModelInstance[] = [];
}

class StageAreaRenderer {
    public stageAreaSector: StageAreaSector[] = [];
    public modelInstance: BINModelInstance[] = [];

    public prepareToRender(textureHolder: KatamariDamacyTextureHolder, viewRenderer: Viewer.ViewerRenderInput) {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].prepareToRender(textureHolder, viewRenderer);
    }

    public setVisible(visible: boolean): void {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].setVisible(visible);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].destroy(device);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

class KatamariDamacyRenderer implements Viewer.SceneGfx {
    private uniformBuffer: GfxRenderDynamicUniformBuffer;
    private templateRenderInst: GfxRenderInst;
    private currentAreaNo: number;
    private sceneTexture = new ColorTexture();
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    public renderInstBuilder: GfxRenderInstBuilderDynamic;
    public modelSectorData: BINModelSectorData[] = [];
    public textureHolder = new KatamariDamacyTextureHolder();
    public isWorld = false;

    public stageAreaRenderers: StageAreaRenderer[] = [];
    public objectRenderers: ObjectRenderer[] = [];

    constructor(device: GfxDevice) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 1 }, // Shape
        ];

        this.renderInstBuilder = new GfxRenderInstBuilderDynamic(KatamariDamacyProgram.programReflection, bindingLayouts, this.uniformBuffer);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.sceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const tvTextureOverride: TextureOverride = { gfxTexture: this.sceneTexture.gfxTexture!, width: viewerInput.viewportWidth, height: viewerInput.viewportHeight, flipY: true };
        if (this.textureHolder.hasTexture('0290/0000/0000'))
            this.textureHolder.setTextureOverride('0290/0000/0000', tvTextureOverride);
        if (this.textureHolder.hasTexture('01c6/0000/0000'))
            this.textureHolder.setTextureOverride('01c6/0000/0000', tvTextureOverride);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, passRenderer);

        // Copy to the scene texture for next time.
        passRenderer.endPass(this.sceneTexture.gfxTexture);
        device.submitPass(passRenderer);

        const passRenderer2 = this.renderTarget.createRenderPass(device, noClearRenderPassDescriptor);
        return passRenderer2;
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentAreaNo);
        return offs;
    }

    public deserializeSaveState(dst: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(dst);
        if (offs < byteLength)
            this.setCurrentAreaNo(view.getUint8(offs++));
        return offs;
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.constructRenderInsts(viewRenderer);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        // If the stage is the world, use a large near plane so we can see everything.
        // Otherwise, use a small near plane so we can get super up close.
        if (this.isWorld)
            viewerInput.camera.setClipPlanes(20, 12000000);
        else
            viewerInput.camera.setClipPlanes(2,  1200000);

        const offs = this.templateRenderInst.allocateNewUniformBufferChunk(KatamariDamacyProgram.ub_SceneParams);
        const sceneParamsMapped = this.templateRenderInst.mapUniformBufferF32(KatamariDamacyProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.stageAreaRenderers.length; i++)
            this.stageAreaRenderers[i].prepareToRender(this.textureHolder, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.textureHolder, viewerInput);

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    private setCurrentAreaNo(areaNo: number): void {
        this.currentAreaNo = areaNo;
        for (let i = 0; i < this.stageAreaRenderers.length; i++)
            this.stageAreaRenderers[i].setVisible(i === areaNo);
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
            this.setCurrentAreaNo(index);
        };
        areaSelect.selectItem(0);
        areasPanel.contents.appendChild(areaSelect.elem);

        return [areasPanel];
    }

    public destroy(device: GfxDevice): void {
        this.sceneTexture.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.textureHolder.destroy(device);
        this.uniformBuffer.destroy(device);

        for (let i = 0; i < this.modelSectorData.length; i++)
            this.modelSectorData[i].destroy(device);
        for (let i = 0; i < this.stageAreaRenderers.length; i++)
            this.stageAreaRenderers[i].destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class KatamariLevelSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public stageAreaFileGroup: StageAreaFileGroup[], public missionSetupFile: string[]) {
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const cache = new LevelCache();

        for (let i = 0; i < this.stageAreaFileGroup.length; i++) {
            cache.fetchFileData(getStageAreaFilePath(this.stageAreaFileGroup[i].texFile), abortSignal);
            cache.fetchFileData(getStageAreaFilePath(this.stageAreaFileGroup[i].modelFile), abortSignal);
        }

        for (let i = 0; i < this.missionSetupFile.length; i++) {
            cache.fetchFileData(getMissionSetupFilePath(this.missionSetupFile[i]), abortSignal);
        }

        return cache.waitForLoad().then(() => {
            const gsMemoryMap = BIN.gsMemoryMapNew();

            const renderer = new KatamariDamacyRenderer(device);
            renderer.isWorld = this.stageAreaFileGroup === worldStageAreaGroup;

            // Parse through the mission setup data to get our stage spawns.
            const buffers: ArrayBufferSlice[] = [];
            for (let i = 0; i < this.missionSetupFile.length; i++)
                buffers.push(cache.getFileData(getMissionSetupFilePath(this.missionSetupFile[i])));
            const missionSetupBin = BIN.parseMissionSetupBIN(buffers, gsMemoryMap);

            // Parse our different stages.
            const maxStageArea = Math.min(missionSetupBin.maxStageArea, this.stageAreaFileGroup.length);
            for (let i = 0; i <= maxStageArea; i++) {
                const stageTexBinData = cache.getFileData(getStageAreaFilePath(this.stageAreaFileGroup[i].texFile));
                const stageModelBinData = cache.getFileData(getStageAreaFilePath(this.stageAreaFileGroup[i].modelFile));
                BIN.parseStageTextureBIN(stageTexBinData, gsMemoryMap);
                const stageModelBin = BIN.parseLevelModelBIN(stageModelBinData, gsMemoryMap, this.id);

                const stageAreaRenderer = new StageAreaRenderer();

                for (let i = 0; i < stageModelBin.sectors.length; i++) {
                    const sector = stageModelBin.sectors[i];
                    renderer.textureHolder.addBINTexture(device, sector);

                    const stageAreaSector = new StageAreaSector();

                    const binModelSectorData = new BINModelSectorData(device, sector);
                    renderer.modelSectorData.push(binModelSectorData);

                    for (let j = 0; j < sector.models.length; j++) {
                        const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelSectorData.modelData[j]);
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
                renderer.textureHolder.addBINTexture(device, objectModel);

                const binModelSectorData = new BINModelSectorData(device, objectModel);
                objectDatas.push(binModelSectorData);
                renderer.modelSectorData.push(binModelSectorData);
            }

            for (let i = 0; i < missionSetupBin.objectSpawns.length; i++) {
                const objectSpawn = missionSetupBin.objectSpawns[i];
                const objectRenderer = new ObjectRenderer(objectSpawn);

                const binModelSectorData = objectDatas[objectSpawn.modelIndex];
                for (let j = 0; j < binModelSectorData.modelData.length; j++) {
                    const binModelInstance = new BINModelInstance(device, renderer.renderInstBuilder, renderer.textureHolder, binModelSectorData.modelData[j]);
                    mat4.mul(binModelInstance.modelMatrix, binModelInstance.modelMatrix, objectSpawn.modelMatrix);
                    objectRenderer.modelInstance.push(binModelInstance);
                }

                renderer.objectRenderers.push(objectRenderer);
            }

            renderer.finish(device, renderer.viewRenderer);
            return renderer;
        });
    }
}

const id = 'katamari_damacy';
const name = 'Katamari Damacy';

const houseStageAreaGroup: StageAreaFileGroup[] = [
    { texFile: '135049', modelFile: '135b75', },
    // The game loads 1350c3, 13513d, 1351b7 as the texture files, but these files are byte-for-byte
    // identical to 135049, so we cut down on loading time here.
    { texFile: '135049', modelFile: '135c43', },
    { texFile: '135049', modelFile: '135d18', },
    { texFile: '135049', modelFile: '135ded', },
];

const cityStageAreaGroup: StageAreaFileGroup[] = [
    // The game loads 135299, 135301, 135369 as the texture files, but these files are byte-for-byte
    // identical to 135231, so we cut down on loading time here.
    { texFile: '135231', modelFile: '135ebf', },
    { texFile: '135231', modelFile: '135fe0', },
    { texFile: '135231', modelFile: '13612f', },
    { texFile: '135231', modelFile: '136282', },
];

const worldStageAreaGroup: StageAreaFileGroup[] = [
    // The game loads 135299, 135301, 135369 as the texture files, but these files are byte-for-byte
    // identical to 135231, so we cut down on loading time here.
    { texFile: '1353d1', modelFile: '1363c5', },
    { texFile: '1353d1', modelFile: '1364a3', },
    { texFile: '1353d1', modelFile: '136599', },
    // The next two texture files are not identical.
    { texFile: '135602', modelFile: '1366d7', },
    { texFile: '135745', modelFile: '136797', },
];

const sceneDescs = [
    new KatamariLevelSceneDesc('lvl1',  "Make a Star 1 (House)", houseStageAreaGroup, ['13d9bd', '13da02', '13da55', '13daa6']),
    new KatamariLevelSceneDesc('lvl2',  "Make a Star 2 (House)", houseStageAreaGroup, ['13daff', '13db9c', '13dc59', '13dd08']),
    new KatamariLevelSceneDesc('lvl3',  "Make a Star 3 (City)",  cityStageAreaGroup,  ['13e462', '13e553', '13e68e', '13e7b1']),
    new KatamariLevelSceneDesc('lvl4',  "Make a Star 4 (House)", houseStageAreaGroup, ['13ddc6', '13df3f', '13e10e', '13e2b1']),
    new KatamariLevelSceneDesc('lvl5',  "Make a Star 5 (City)",  cityStageAreaGroup,  ['13e8d2', '13ea87', '13eca3', '13eeb0']),
    new KatamariLevelSceneDesc('lvl6',  "Make a Star 6 (World)", worldStageAreaGroup, ['13f0b4', '13f244', '13f443', '13f605']),
    new KatamariLevelSceneDesc('lvl7',  "Make a Star 7 (World)", worldStageAreaGroup, ['13f7c8', '13f97f', '13fbad', '13fda5']),
    new KatamariLevelSceneDesc('lvl8',  "Make a Star 8 (City)",  cityStageAreaGroup,  ['13ff91', '14017a', '1403d3', '140616']),
    new KatamariLevelSceneDesc('lvl9',  "Make a Star 9 (World)", worldStageAreaGroup, ['140850', '140a3e', '140cc7', '140f02']),
    new KatamariLevelSceneDesc('lvl10', "Make the Moon (World)", worldStageAreaGroup, ['141133', '141339', '1415d4', '141829']),
];
const sceneIdMap = new Map<string, string>();
// When I first was testing Katamari, I was testing the Tutorial Level. At some point
// I changed to Make a Star 1, but didn't change the ID before pushing live. So that's
// why the level file for the Tutorial maps to Make a Star 1.
sceneIdMap.set('13698a', 'lvl1');
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, sceneIdMap };
