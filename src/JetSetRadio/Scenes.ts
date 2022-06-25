
import ArrayBufferSlice from "../ArrayBufferSlice";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import { GfxBindingLayoutDescriptor, GfxDevice, GfxFormat, makeTextureDescriptor2D, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { LoadedTexture, TextureHolder } from "../TextureHolder";
import { assert, assertExists, hexzero0x, readString } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as AFS from './AFS';
import * as BYML from '../byml';
import * as PVRT from "./PVRT";
import * as Ninja from "./Ninja";
import { NjsActionData, NjsActionInstance } from "./Render";
import { CameraController } from "../Camera";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4 } from "gl-matrix";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DataFetcher } from "../DataFetcher";
import { makeSolidColorTexture2D } from "../gfx/helpers/TextureHelpers";
import { Cyan, Magenta, Yellow , White} from "../Color";

const pathBase = `JetSetRadio`;

function surfaceToCanvas(textureLevel: PVRT.PVR_TextureLevel): HTMLCanvasElement {
    return convertToCanvas(ArrayBufferSlice.fromView(textureLevel.data), textureLevel.width, textureLevel.height);
}

function textureToCanvas(texture: PVRT.PVR_Texture) {
    const surfaces = texture.levels.map((textureLevel) => surfaceToCanvas(textureLevel));
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', PVRT.getFormatName(texture.format));
    return { name: texture.name, surfaces, extraInfo };
}

export class PVRTextureHolder extends TextureHolder<PVRT.PVR_Texture> {
    public getTextureName(id: number): string {
        return hexzero0x(id, 4);
    }

    protected loadTexture(device: GfxDevice, textureEntry: PVRT.PVR_Texture): LoadedTexture | null {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_SRGB, textureEntry.width, textureEntry.height, textureEntry.levels.length));
        device.setResourceName(gfxTexture, textureEntry.name);
        device.uploadTextureData(gfxTexture, 0, textureEntry.levels.reverse().map((level) => level.data));
        const viewerTexture = textureToCanvas(textureEntry);
        return { gfxTexture, viewerTexture };
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

class JetSetRadioRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;
    public clearPass = standardFullClearRenderPassDescriptor;
    public modelCache: ModelCache;

    public actions: NjsActionInstance[] = [];

    private lightDirection = mat4.create();

    constructor(context: SceneContext, stageData: StageData) {
        this.renderHelper = new GfxRenderHelper(context.device, context);
        this.modelCache = new ModelCache(context.device, this.renderHelper.renderCache, context.dataFetcher, stageData);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(.03);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearPass);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearPass);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(.1);
        // this.animationController.setTimeFromViewerInput(viewerInput);
        // const frameDelta = this.animationController.fps * viewerInput.deltaTime / 1000;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(0, 16 + 12);
        const sceneParamsMapped = template.mapUniformBufferF32(0);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(sceneParamsMapped, offs, this.lightDirection);

        for (let i = 0; i < this.actions.length; i++) {
            // this.actions[i].update(mat4.create(), 0);
            this.actions[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput);
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.modelCache.destroy(device);
    }
}

function parseTXPTex(buffer: ArrayBufferSlice, dataOffs: number, id: number): PVRT.PVR_Texture {
    const view = buffer.createDataView();
    const gbixMagic = readString(buffer, dataOffs + 0x00, 0x04);
    assert(gbixMagic === 'GBIX');

    const gbixLength = view.getUint32(dataOffs + 0x04, true);
    const gbixIndex = view.getUint32(dataOffs + 0x08, true);
    dataOffs += 0x08 + gbixLength;

    const pvrtMagic = readString(buffer, dataOffs + 0x00, 0x04);
    assert(pvrtMagic === 'PVRT');
    // const pvrtLength = view.getUint32(dataOffs + 0x04, true);
    // PVRT chunk length seems to be inaccurate?

    const [texture, size] = PVRT.readPVRTChunk(buffer, dataOffs);
    texture.id = id;
    texture.name = hexzero0x(texture.id, 4);
    return texture;
}

interface AFSRefData {
    AFSFileName: string;
    AFSFileIndex: number;
}

interface TexData extends AFSRefData {
    Offset: number;
}

interface TexlistData {
    Textures: TexData[];
    Texlists: number[][];
}

interface ModelData extends AFSRefData {
    Offset: number;
    TexlistIndex: number;
}

interface ObjectData {
    ModelID: number;
    Translation: [number, number, number];
    Rotation: [number, number, number];
    Scale: [number, number, number];
}

interface SkyboxData {
    Meshes : ModelData[];    
}

interface StageData {
    BaseAddress: number;
    TexlistData: TexlistData;
    Models: ModelData[];
    Objects: ObjectData[];
    Skybox: SkyboxData;
}

class ModelCache {
    public modelData = new Map<number, NjsActionData>();
    public textureHolder = new PVRTextureHolder();
    private archiveCache = new Map<string, AFS.AFS>();
    private archivePromiseCache = new Map<string, Promise<AFS.AFS>>();
    private texOpaqueMagenta: GfxTexture;
    private texOpaqueYellow: GfxTexture;
    private texOpaqueWhite: GfxTexture;

    constructor(public device: GfxDevice, public cache: GfxRenderCache, private dataFetcher: DataFetcher, private stageData: StageData) {
        this.cache = new GfxRenderCache(device);

        this.texOpaqueMagenta = makeSolidColorTexture2D(device, Magenta);
        this.texOpaqueYellow = makeSolidColorTexture2D(device, Yellow);
        this.texOpaqueWhite = makeSolidColorTexture2D(device, White);
        this.textureHolder.setTextureOverride('_magenta', { gfxTexture: this.texOpaqueMagenta, width: 1, height: 1, flipY: false });
        this.textureHolder.setTextureOverride('_yellow', { gfxTexture: this.texOpaqueYellow, width: 1, height: 1, flipY: false });
        this.textureHolder.setTextureOverride('_white', { gfxTexture: this.texOpaqueWhite, width: 1, height: 1, flipY: false });
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    private async requestAFSRef(ref: AFSRefData) {
        this.requestArchiveData(ref.AFSFileName);
    }

    public requestStageData(): void {
        for (let i = 0; i < this.stageData.TexlistData.Textures.length; i++)
            this.requestAFSRef(this.stageData.TexlistData.Textures[i]);
        for (let i = 0; i < this.stageData.Models.length; i++)
            this.requestAFSRef(this.stageData.Models[i]);
    }

    private async requestArchiveDataInternal(archivePath: string): Promise<AFS.AFS> {
        const buffer = await this.dataFetcher.fetchData(`${pathBase}/JETRADIO/${archivePath}`);
        const afs = AFS.parse(buffer);
        this.archiveCache.set(archivePath, afs);
        return afs;
    }

    private requestArchiveData(archivePath: string): Promise<AFS.AFS> {
        if (this.archivePromiseCache.has(archivePath))
            return this.archivePromiseCache.get(archivePath)!;

        const p = this.requestArchiveDataInternal(archivePath);
        this.archivePromiseCache.set(archivePath, p);
        return p;
    }

    private getAFSRef(ref: AFSRefData): ArrayBufferSlice {
        const afs = assertExists(this.archiveCache.get(ref.AFSFileName));
        return afs.files[ref.AFSFileIndex];
    }

    private loadTexlist(texlist: number[]): void {
        for (let i = 0; i < texlist.length; i++) {
            const textureIndex = texlist[i];
            if (textureIndex === null)
                continue;

            const texData = this.stageData.TexlistData.Textures[textureIndex];
            const txpData = this.getAFSRef(texData);
            const tex = parseTXPTex(txpData, texData.Offset, textureIndex);
            this.textureHolder.addTextures(this.device, [tex]);
        }
    }

    private loadTexlistIndex(index: number): number[] | null {
        if (index < 0)
            return null;
        const texlist = this.stageData.TexlistData.Texlists[index];
        this.loadTexlist(texlist);
        return texlist;
    }

    public loadModelData(id: number): NjsActionData {
        if (this.modelData.has(id))
            return this.modelData.get(id)!;

        const model = this.stageData.Models[id];
        //console.warn(`${hexzero0x(id)}`)
        const binData = this.getAFSRef(model);
        const stageLoadAddr = this.stageData.BaseAddress;
        const objects = Ninja.parseNjsObjects(binData, stageLoadAddr, model.Offset);
        const action: Ninja.NJS_ACTION = { frames: 0, objects, motions: [] };
        const actionData = new NjsActionData(this.device, this.cache, action, 0);
        actionData.texlist = this.loadTexlistIndex(model.TexlistIndex);
        this.modelData.set(id, actionData);
        return actionData;
    }

    public loadFromModelData(dat: ModelData) {
        const model = dat;
        const binData = this.getAFSRef(model);
        const stageLoadAddr = this.stageData.BaseAddress;
        const objects = Ninja.parseNjsObjects(binData, stageLoadAddr, model.Offset);
        const action: Ninja.NJS_ACTION = { frames: 0, objects, motions: [] };
        const actionData = new NjsActionData(this.device, this.cache, action, 0);
        actionData.texlist = this.loadTexlistIndex(model.TexlistIndex);
        return actionData;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy();
        this.textureHolder.destroy(device);
        device.destroyTexture(this.texOpaqueMagenta);
        device.destroyTexture(this.texOpaqueYellow);
        device.destroyTexture(this.texOpaqueWhite);
        for (const v of this.modelData.values())
            v.destroy(device);
    }
}

class JetSetRadioSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const stageData = BYML.parse<StageData>(await context.dataFetcher.fetchData(`${pathBase}/${this.id}.crg1`), BYML.FileType.CRG1);

        const renderer = new JetSetRadioRenderer(context, stageData);

        const modelCache = renderer.modelCache;
        modelCache.requestStageData();
        await modelCache.waitForLoad();

        for (let i = 0; i < stageData.Objects.length; i++) {
            const object = stageData.Objects[i];
            const modelData = modelCache.loadModelData(object.ModelID);
            const actionInstance = new NjsActionInstance(modelCache.cache, modelData, modelData.texlist, modelCache.textureHolder);
            actionInstance.modelID = object.ModelID;
            const modelMatrix = mat4.create();
            mat4.fromTranslation(modelMatrix, object.Translation);
            mat4.rotateZ(modelMatrix, modelMatrix, object.Rotation[2]);
            mat4.rotateY(modelMatrix, modelMatrix, object.Rotation[1]);
            mat4.rotateX(modelMatrix, modelMatrix, object.Rotation[0]);
            mat4.scale(modelMatrix, modelMatrix, object.Scale);
            actionInstance.update(modelMatrix, 0);
            renderer.actions.push(actionInstance);
        }
        
        if (stageData.Skybox!==null) 
            for (const mesh of stageData.Skybox.Meshes) {
                const modelDataOuter = modelCache.loadFromModelData(mesh);
                const actionInstanceOuter = new NjsActionInstance(modelCache.cache, modelDataOuter, modelDataOuter.texlist, modelCache.textureHolder);
                renderer.actions.push(actionInstanceOuter);
            }
        return renderer;
    }
}

export const id = 'JetSetRadio';
export const name = "Jet Set Radio";
export const sceneDescs = [
    new JetSetRadioSceneDesc('Stage1', 'Shibuya-cho'),
    new JetSetRadioSceneDesc('Stage2', 'Kogane-cho'),
    new JetSetRadioSceneDesc('Stage3', 'Benten-cho'),
    new JetSetRadioSceneDesc('Stage5', 'Bantam Street'),
    new JetSetRadioSceneDesc('Stage6', 'Grind Square'),
	new JetSetRadioSceneDesc('StageLast', 'Final Boss'),
    new JetSetRadioSceneDesc('Garage', 'GG Hideout'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
