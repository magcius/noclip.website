
// Pokemon Platinum

import * as Viewer from '../viewer';
import * as NARC from './narc';

import { DataFetcher, DataFetcherFlags } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass } from './render';
import { assert, assertExists, readString } from '../util';
import { mat4 } from 'gl-matrix';
import { BasicRenderTarget, depthClearRenderPassDescriptor, transparentBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { SceneContext } from '../SceneBase';
import { BMD0, parseNSBMD, BTX0, parseNSBTX, BTP0, BTA0, parseNSBTP, parseNSBTA, fx32 } from './NNS_G3D';
import { CameraController } from '../Camera';

const pathBase = `pkmnpl`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    public fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    private mountNARC(narc: NARC.NitroFS, root: string): void {
        for (let i = 0; i < narc.files.length; i++) {
            const file = narc.files[i];
            this.fileDataCache.set(`${root}/${i}.bin`, file.buffer);
        }
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public async fetchNARC(path: string, root: string) {
        const fileData = await this.fetchFile(path);
        const narc = NARC.parse(fileData);
        this.mountNARC(narc, root);
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        if (this.fileDataCache.has(path))
            return this.fileDataCache.get(path)!;
        else
            return null;
    }
}

export class PlatinumMapRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public textureHolder: FakeTextureHolder;

    constructor(device: GfxDevice, public objectRenderers: MDL0Renderer[]) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);

        const viewerTextures: Viewer.Texture[] = [];
        for (let i = 0; i < this.objectRenderers.length; i++) {
            const element = this.objectRenderers[i];
            for (let j = 0; j < element.viewerTextures.length; j++)
                viewerTextures.push(element.viewerTextures[j]);
        }
        this.textureHolder = new FakeTextureHolder(viewerTextures);
    }

    public createCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
        return c;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
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
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, transparentBlackFullClearRenderPassDescriptor);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.SKYBOX);
        this.renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.MAIN);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);

        this.renderTarget.destroy(device);

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class PokemonPlatinumSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public mapID: string, public name: string) {}

    private fetchNARC(path: string, dataFetcher: DataFetcher): Promise<NARC.NitroFS | null> {
        return dataFetcher.fetchData(path, DataFetcherFlags.ALLOW_404).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0)
                return null;
            return NARC.parse(buffer);
        });
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const modelCache = new ModelCache(dataFetcher);
        modelCache.fetchNARC(`land_data.narc`, 'land_data');
        modelCache.fetchNARC(`map_tex_set.narc`, 'map_tex_set');
        modelCache.fetchNARC(`build_model.narc`, 'build_model');
        modelCache.fetchNARC(`map_matrix.narc`, 'map_matrix');
        await modelCache.waitForLoad();

        //Spacecats: TODO - General cleaning and organization. Fix issues with a few map chunks.

        const tilesets = new Map<number, BTX0>();
        const building_textures = parseNSBTX((await dataFetcher.fetchData(`${pathBase}/build_tex.nsbtx`)));
        const renderers: MDL0Renderer[] = [];
        const map_matrix_headers: number[][] = [];
        const map_matrix_height: number[][] = [];
        const map_matrix_files: number[][] = [];
        const tileset_indicies: number[] = [];

        const headerCount = (await dataFetcher.fetchData(`${pathBase}/mapname.bin`)).byteLength / 16;
        const arm9 = (await dataFetcher.fetchData(`${pathBase}/arm9.bin`)).createDataView();
        for (let i = 0; i < headerCount; i++) {
            tileset_indicies[i] = arm9.getUint8(0xE601C + (24 * i));
        }

        const mapMatrixData = assertExists(modelCache.getFileData(`map_matrix/0.bin`)).createDataView();
        let currentMatrixOffset = 0x08;
        for (let y = 0; y < 30; y++) {
            map_matrix_headers[y] = [];
            for (let x = 0; x < 30; x++) {
                map_matrix_headers[y][x] = mapMatrixData.getUint16(currentMatrixOffset, true);
                currentMatrixOffset += 2;
            }   
        }

        for (let y = 0; y < 30; y++) {
            map_matrix_height[y] = [];
            for (let x = 0; x < 30; x++) {
                map_matrix_height[y][x] = mapMatrixData.getUint8(currentMatrixOffset);
                currentMatrixOffset += 1;
            }   
        }

        for (let y = 0; y < 30; y++) {
            map_matrix_files[y] = [];
            for (let x = 0; x < 30; x++) {
                map_matrix_files[y][x] = mapMatrixData.getUint16(currentMatrixOffset, true);
                currentMatrixOffset += 2;
            }   
        }

        //SpaceCats: This is a hack, but it works.
        let set_index = 0;
        while(modelCache.getFileData(`map_tex_set/${set_index}.bin`) != null){
            tilesets.set(set_index, parseNSBTX(assertExists(modelCache.getFileData(`map_tex_set/${set_index}.bin`))));
            set_index++;
        }

        set_index = 0;
        while(modelCache.getFileData(`map_tex_set/${set_index}.bin`) != null){
            tilesets.set(set_index, parseNSBTX(assertExists(modelCache.getFileData(`map_tex_set/${set_index}.bin`))));
            set_index++;
        }
        
        for (let y = 0; y < 30; y++) {
            for (let x = 0; x < 30; x++) {
                try {
                    if(map_matrix_files[y][x] == 0xFFFF){
                        continue;
                    }
                    const mapDataFile = assertExists(modelCache.getFileData(`land_data/${map_matrix_files[y][x]}.bin`));
                    const mapData = assertExists(mapDataFile).createDataView();
                    
                    const objectOffset = mapData.getUint32(0x00, true) + 0x10;
                    const modelOffset = mapData.getUint32(0x04, true) + objectOffset;
                    const modelSize = mapData.getUint32(0x08, true);
                    
                    const embeddedModelBMD = parseNSBMD(mapDataFile.slice(modelOffset, modelOffset + modelSize));

                    const tilesetIndex = tileset_indicies[map_matrix_headers[y][x]];
                    
                    try{
                        const mapRenderer = new MDL0Renderer(device, embeddedModelBMD.models[0], assertExists(tilesets.get(tilesetIndex)!.tex0));
                        mat4.translate(mapRenderer.modelMatrix, mapRenderer.modelMatrix, [(x * 512), map_matrix_height[y][x]*8, (y * 512)]);
                        renderers.push(mapRenderer);
                    } catch {
                        const mapRenderer = new MDL0Renderer(device, embeddedModelBMD.models[0], assertExists(tilesets.get(6)!.tex0));
                        mat4.translate(mapRenderer.modelMatrix, mapRenderer.modelMatrix, [(x * 512), map_matrix_height[y][x]*8, (y * 512)]);
                        renderers.push(mapRenderer);
                    }
                    
                    const objectCount = (modelOffset - objectOffset) / 0x30;
                    for (let objIndex = 0; objIndex < objectCount; objIndex++) {
                        const currentObjOffset = objectOffset + (objIndex * 0x30);
                        const modelID = mapData.getUint32(currentObjOffset, true);
                        
                        const posX = fx32(mapData.getInt32(currentObjOffset + 0x04, true));
                        const posY = fx32(mapData.getInt32(currentObjOffset + 0x08, true));
                        const posZ = fx32(mapData.getInt32(currentObjOffset + 0x0C, true));
                        
                        const modelFile = assertExists(modelCache.getFileData(`build_model/${modelID}.bin`));
                        const objBmd = parseNSBMD(modelFile);

                        const renderer = new MDL0Renderer(device, objBmd.models[0], assertExists(objBmd.tex0));
                        mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [(posX + (x * 512)), posY, (posZ + (y * 512))]);
                        
                        renderers.push(renderer);
                    }
                   
                } catch (error) {
                    console.error(error);
                }
            }
        }

        return new PlatinumMapRenderer(device, renderers);
    }
    
}

const id = 'pkmnpl';
const name = 'Pokemon Platinum';
const sceneDescs = [
    new PokemonPlatinumSceneDesc("0", "Sinnoh Region")
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
