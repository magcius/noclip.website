
// Pokemon Platinum

import * as Viewer from '../viewer.js';
import * as NARC from './narc.js';

import { ReadonlyVec3, mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { CameraController } from '../Camera.js';
import { DataFetcher } from '../DataFetcher.js';
import { AABB } from '../Geometry.js';
import { SceneContext } from '../SceneBase.js';
import { NITRO_Program } from '../SuperMario64DS/render.js';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { fillColor, fillMatrix4x4, fillVec3v } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { assert, assertExists, nArray } from '../util.js';
import { BTX0, MDL0Model, TEX0, fx32, parseNSBMD, parseNSBTX } from './NNS_G3D.js';
import { MDL0Renderer, nnsG3dBindingLayouts } from './render.js';
import { Color, White, colorCopy, colorFromRGBA, colorLerp, colorNewCopy, colorNewFromRGBA } from '../Color.js';
import { invlerp, transformVec3Mat4w0 } from '../MathHelpers.js';

const pathBase = `PokemonPlatinum`;
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

export class LightSetting {
    public time: number = 0;
    public lightColor: Color[] = nArray(4, () => colorNewCopy(White));
    public direction: vec3[] = nArray(4, () => vec3.create());
    public diffuseColor: Color = colorNewCopy(White);
    public ambientColor: Color = colorNewCopy(White);
    public specularColor: Color = colorNewCopy(White);
    public emissionColor: Color = colorNewCopy(White);
};

function parseLightSettings(S: string): LightSetting[] {
    const settings = S.split('\n\n');
    return settings.map((v) => {
        const lightSetting = new LightSetting();

        const lines = v.split('\n');
        lightSetting.time = parseInt(lines[0]);
        for (let i = 0; i < 4; i++) {
            const [flag, r, g, b, x, y, z] = lines[i + 1].split(',').map((f) => parseInt(f));
            colorFromRGBA(lightSetting.lightColor[i], r/0x1F, g/0x1F, b/0x1F);
            vec3.set(lightSetting.direction[i], x/4096, y/4096, z/4096);
        }

        const parseColor = (dst: Color, S: string) => {
            const [r, g, b] = S.split(',').map((f) => parseInt(f));
            colorFromRGBA(dst, r/0x1F, g/0x1F, b/0x1F);
        };
        parseColor(lightSetting.diffuseColor, lines[5]);
        parseColor(lightSetting.ambientColor, lines[6]);
        parseColor(lightSetting.specularColor, lines[7]);
        parseColor(lightSetting.emissionColor, lines[8]);
        return lightSetting;
    });
}

// arealight00.txt
const lightSettingsArea0 = parseLightSettings(`0,
1,11,11,16,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,18,10,0,0,0,4096,
0,0,0,0,0,0,0,
14,14,16,
10,10,10,
14,14,16,
8,8,11,

7200,
1,11,11,16,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,0,0,6,0,0,4096,
0,0,0,0,0,0,0,
14,14,16,
10,10,10,
14,14,16,
8,8,11,

8100,
1,12,12,18,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,0,1,6,0,0,4096,
0,0,0,0,0,0,0,
10,10,14,
13,13,13,
8,8,14,
10,10,12,

9000,
1,12,12,22,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,0,1,6,0,0,4096,
0,0,0,0,0,0,0,
11,11,13,
10,10,10,
10,10,14,
13,13,14,

14400,
1,15,15,22,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,0,1,6,0,0,4096,
0,0,0,0,0,0,0,
12,12,12,
8,8,8,
12,12,14,
14,14,18,

20700,
1,18,18,21,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,0,4,9,0,0,4096,
0,0,0,0,0,0,0,
13,13,13,
9,9,9,
14,14,15,
14,14,16,

21600,
1,22,22,20,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,0,4,9,0,0,4096,
0,0,0,0,0,0,0,
15,15,15,
9,11,11,
16,16,16,
14,14,14,

27000,
1,24,24,20,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,0,4,9,0,0,4096,
0,0,0,0,0,0,0,
16,16,16,
10,12,12,
18,18,18,
14,14,14,

27900,
1,22,22,18,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,4,4,10,0,0,4096,
0,0,0,0,0,0,0,
15,15,15,
11,12,12,
17,17,17,
13,13,13,

30600,
1,20,18,16,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,3,4,10,0,0,4096,
0,0,0,0,0,0,0,
15,15,15,
11,12,12,
17,17,17,
12,11,11,

32400,
1,19,16,12,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,16,6,0,0,0,4096,
0,0,0,0,0,0,0,
15,15,15,
11,12,12,
17,17,17,
8,8,7,

33300,
1,17,13,10,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,14,6,0,0,0,4096,
0,0,0,0,0,0,0,
14,14,14,
12,12,12,
16,16,16,
9,7,7,

34200,
1,16,13,10,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,12,4,0,0,0,4096,
0,0,0,0,0,0,0,
14,14,14,
12,12,12,
14,14,16,
9,8,7,

36000,
1,11,12,15,-1934,-3548,-296,
0,0,0,0,0,0,0,
1,18,10,0,0,0,4096,
0,0,0,0,0,0,0,
14,14,14,
12,12,12,
14,14,16,
8,8,9,

43200,
1,11,11,16,-1914,-3548,-296,
0,0,0,0,0,0,0,
1,18,10,0,0,0,4096,
0,0,0,0,0,0,0,
14,14,16,
10,10,10,
14,14,16,
8,8,11,
`);

function blendLightSetting(dst: LightSetting, settings: LightSetting[], time: number): void {
    // Find the bounding light settings
    for (let i = 0; i < settings.length - 1; i++) {
        const a = settings[i];
        const b = settings[i + 1];
        if (time >= a.time && time < b.time) {
            const t = invlerp(a.time, b.time, time);

            for (let i = 0; i < 4; i++) {
                vec3.lerp(dst.direction[i], a.direction[i], b.direction[i], t);
                vec3.normalize(dst.direction[i], dst.direction[i]);
                colorLerp(dst.lightColor[i], a.lightColor[i], b.lightColor[i], t);
            }

            colorLerp(dst.ambientColor, a.ambientColor, b.ambientColor, t);
            colorLerp(dst.diffuseColor, a.diffuseColor, b.diffuseColor, t);
            colorLerp(dst.specularColor, a.specularColor, b.specularColor, t);
            colorLerp(dst.emissionColor, a.emissionColor, b.emissionColor, t);
        }
    }
}

export class PlatinumMapRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    public objectRenderers: MDL0Renderer[] = [];
    public lightSettings: LightSetting[] = lightSettingsArea0;
    public lightSetting: LightSetting = new LightSetting();
    public currentTime: number = 0;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);

        const today = new Date();
        this.currentTime = today.getHours() * 60*30;
    }

    public getCache() {
        return this.renderHelper.renderCache;
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(10);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.currentTime += (viewerInput.deltaTime / 1000) * 300;
        if (this.currentTime > 24*60*30)
            this.currentTime = 0;

        blendLightSetting(this.lightSetting, this.lightSettings, this.currentTime);

        for (let i = 0; i < this.objectRenderers.length; i++) {
            const obj = this.objectRenderers[i];
            for (let j = 0; j < obj.materialInstances.length; j++) {
                const materialInstance = obj.materialInstances[j];
                materialInstance.lightMask = 0x0F;
                colorCopy(materialInstance.diffuseColor, this.lightSetting.diffuseColor);
                colorCopy(materialInstance.ambientColor, this.lightSetting.ambientColor);
                colorCopy(materialInstance.specularColor, this.lightSetting.specularColor);
                colorCopy(materialInstance.emissionColor, this.lightSetting.emissionColor);
            }
        }

        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16+32);
        const d = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < 4; i++) {
            const lightDirView = vec3.create();
            transformVec3Mat4w0(lightDirView, viewerInput.camera.viewMatrix, this.lightSetting.direction[i]);
            offs += fillVec3v(d, offs, lightDirView);
        }
        for (let i = 0; i < 4; i++)
            offs += fillColor(d, offs, this.lightSetting.lightColor[i]);

        renderInstManager.setCurrentList(this.renderInstListMain);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
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
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

export function checkTEX0Compatible(mdl0: MDL0Model, tex0: TEX0): boolean {
    for (let i = 0; i < mdl0.materials.length; i++)
        if (mdl0.materials[i].textureName !== null && tex0.textures.find((tex) => tex.name === mdl0.materials[i].textureName) === undefined)
            return false;
    return true;
}

export function tryMDL0(device: GfxDevice, cache: GfxRenderCache, mdl0: MDL0Model, tex0: TEX0): MDL0Renderer | null {
    if (checkTEX0Compatible(mdl0, tex0))
        return new MDL0Renderer(cache, mdl0, tex0);
    else
        return null;
}

class PokemonPlatinumSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const modelCache = new ModelCache(dataFetcher);
        modelCache.fetchNARC(`land_data.narc`, 'land_data');
        modelCache.fetchNARC(`map_tex_set.narc`, 'map_tex_set');
        modelCache.fetchNARC(`build_model.narc`, 'build_model');
        modelCache.fetchNARC(`map_matrix.narc`, 'map_matrix');
        await modelCache.waitForLoad();

        //Spacecats: TODO - General cleaning and organization. Fix issues with a few map chunks.

        const renderer = new PlatinumMapRenderer(device);
        const cache = renderer.getCache();

        const tilesets = new Map<number, BTX0>();
        const map_matrix_headers: number[][] = [];
        const map_matrix_height: number[][] = [];
        const map_matrix_files: number[][] = [];
        const tileset_indices: number[] = [];

        const mapHeaders = (await dataFetcher.fetchData(`${pathBase}/maps.bin`)).createDataView();
        
        const mapHeaderIndex = parseInt(this.id);
        const mapFallbackTileset = mapHeaders.getUint8(mapHeaderIndex*24);
        const matrixIndex = mapHeaders.getUint8(mapHeaderIndex*24 + 0x02);
        console.log(`Reading Map Header at 0x${(mapHeaderIndex*24).toString(16)} : 0x${mapHeaders.getUint8(mapHeaderIndex*24).toString(16)}`)
        console.log(matrixIndex);

        for (let i = 0; i < 700; i++) {
            tileset_indices[i] = mapHeaders.getUint8((24 * i));
        }

        const mapMatrixData = assertExists(modelCache.getFileData(`map_matrix/${matrixIndex}.bin`)).createDataView();
        const width = mapMatrixData.getUint8(0x00);
        const height = mapMatrixData.getUint8(0x01);
        const hasHeightLayer = mapMatrixData.getUint8(0x02) === 1;
        const hasHeaderLayer = mapMatrixData.getUint8(0x03) === 1;
        
        //Read header or file layer and set default height, if the header layer is included this is header, if its not its file
        let currentMatrixOffset = 0x05 + mapMatrixData.getUint8(0x04);
        for (let y = 0; y < height; y++) {
            map_matrix_files[y] = [];
            map_matrix_height[y] = [];
            map_matrix_headers[y] = [];
            for (let x = 0; x < width; x++) {
                const idx = mapMatrixData.getUint16(currentMatrixOffset, true);
                
                map_matrix_height[y][x] = 0;
                map_matrix_files[y][x] = idx;
                map_matrix_headers[y][x] = idx;
                currentMatrixOffset += 2;
            }   
        }
        
        if(hasHeightLayer){
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    map_matrix_height[y][x] = mapMatrixData.getUint8(currentMatrixOffset);
                    currentMatrixOffset += 1;
                }   
            }
        }

        //If the header data is included, the file indices will be after the height layer
        if(hasHeaderLayer){
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    map_matrix_files[y][x] = mapMatrixData.getUint16(currentMatrixOffset, true);
                    currentMatrixOffset += 2;
                }   
            }
        }

        //SpaceCats: This is a hack, but it works.
        let set_index = 0;
        while (modelCache.getFileData(`map_tex_set/${set_index}.bin`) !== null){
            tilesets.set(set_index, parseNSBTX(assertExists(modelCache.getFileData(`map_tex_set/${set_index}.bin`))));
            set_index++;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (map_matrix_files[y][x] === 0xFFFF)
                    continue;

                const mapDataFile = assertExists(modelCache.getFileData(`land_data/${map_matrix_files[y][x]}.bin`));
                const mapData = assertExists(mapDataFile).createDataView();

                const objectOffset = mapData.getUint32(0x00, true) + 0x10;
                const modelOffset = mapData.getUint32(0x04, true) + objectOffset;
                const modelSize = mapData.getUint32(0x08, true);

                const embeddedModelBMD = parseNSBMD(mapDataFile.slice(modelOffset, modelOffset + modelSize));
                const tilesetIndex = tileset_indices[map_matrix_headers[y][x]];

                let mapRenderer: MDL0Renderer | null = null;

                if (mapRenderer === null)
                    mapRenderer = tryMDL0(device, cache, embeddedModelBMD.models[0], assertExists(tilesets.get(tilesetIndex)!.tex0));
                if (mapRenderer === null)
                    mapRenderer = tryMDL0(device, cache, embeddedModelBMD.models[0], assertExists(tilesets.get(mapFallbackTileset)!.tex0));
                if (mapRenderer === null)
                    continue;

                mat4.translate(mapRenderer.modelMatrix, mapRenderer.modelMatrix, [(x * 512), map_matrix_height[y][x]*8, (y * 512)]);

                const bbox = new AABB(-256, -256, -256, 256, 256, 256);
                bbox.transform(bbox, mapRenderer.modelMatrix);
                mapRenderer.bbox = bbox;

                renderer.objectRenderers.push(mapRenderer);

                const objectCount = (modelOffset - objectOffset) / 0x30;
                for (let objIndex = 0; objIndex < objectCount; objIndex++) {
                    const currentObjOffset = objectOffset + (objIndex * 0x30);
                    const modelID = mapData.getUint32(currentObjOffset, true);

                    const posX = fx32(mapData.getInt32(currentObjOffset + 0x04, true));
                    const posY = fx32(mapData.getInt32(currentObjOffset + 0x08, true));
                    const posZ = fx32(mapData.getInt32(currentObjOffset + 0x0C, true));

                    const modelFile = assertExists(modelCache.getFileData(`build_model/${modelID}.bin`));
                    const objBmd = parseNSBMD(modelFile);

                    const obj = new MDL0Renderer(cache, objBmd.models[0], assertExists(objBmd.tex0));
                    obj.bbox = bbox;
                    mat4.translate(obj.modelMatrix, obj.modelMatrix, [(posX + (x * 512)), posY, (posZ + (y * 512))]);
                    renderer.objectRenderers.push(obj);
                }
            }
        }

        return renderer;
    }
   
}

const id = 'pkmnpl';
const name = 'Pokémon Platinum';
const sceneDescs = [
    new PokemonPlatinumSceneDesc("0", "Sinnoh Region"),
    new PokemonPlatinumSceneDesc("2", "Underground"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "Pokemon Platinum" };
