
import ArrayBufferSlice from "../ArrayBufferSlice";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import { GfxBindingLayoutDescriptor, GfxDevice, GfxFormat, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { LoadedTexture, TextureHolder } from "../TextureHolder";
import { assert, hexzero0x, readString } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as AFS from './AFS';
import * as PVRT from "./PVRT";
import * as Ninja from "./Ninja";
import { NjsActionData, NjsActionInstance, NjsModelData, NjsModelInstance } from "./Render";
import { CameraController } from "../Camera";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4 } from "gl-matrix";

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
        device.uploadTextureData(gfxTexture, 0, textureEntry.levels.reverse().map((level) => level.data));
        const viewerTexture = textureToCanvas(textureEntry);
        return { gfxTexture, viewerTexture };
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

class JetSetRadioRenderer implements SceneGfx {
    public textureHolder = new PVRTextureHolder();
    public renderHelper: GfxRenderHelper;
    public clearPass = standardFullClearRenderPassDescriptor;

    public actionData: NjsActionData[] = [];
    public actions: NjsActionInstance[] = [];

    private lightDirection = mat4.create();

    constructor(context: SceneContext) {
        this.renderHelper = new GfxRenderHelper(context.device, context);
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
            this.actions[i].update(mat4.create(), 0);
            this.actions[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, mat4.create());
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        for (let i = 0; i < this.actionData.length; i++)
            this.actionData[i].destroy(device);
    }
}

function parseTXP(buffer: ArrayBufferSlice): PVRT.PVR_Texture[] {
    const textures: PVRT.PVR_Texture[] = [];
    const view = buffer.createDataView();
    let dataOffs = 0x00;

    while (dataOffs < buffer.byteLength) {
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
        texture.id = gbixIndex;
        texture.name = hexzero0x(texture.id, 4);
        textures.push(texture);

        dataOffs += size;

        // Search for next GBIX chunk...
        dataOffs = (dataOffs + 0x0F) & ~0x0F;
        while (true) {
            if (dataOffs >= buffer.byteLength)
                break;
            if (view.getUint32(dataOffs + 0x00, false) === 0x47424958)
                break;
            dataOffs += 0x10;
        }
    }

    return textures;
}

class JetSetRadioSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const renderer = new JetSetRadioRenderer(context);
        const cache = renderer.renderHelper.renderCache;

        const afs1 = AFS.parse(await context.dataFetcher.fetchData(`${pathBase}/JETRADIO/STAGE1.AFS`));
        const afs2 = AFS.parse(await context.dataFetcher.fetchData(`${pathBase}/JETRADIO/STAGE1TXP_AREA3.AFS`));

        const pvrt = parseTXP(afs2.files[0]);
        renderer.textureHolder.addTextures(device, pvrt);

        const bin = afs1.files[0];
        const objects = Ninja.parseNjsObjects(bin, 0x8CB00000, 0x00044C24);
        const action: Ninja.NJS_ACTION = { frames: 0, objects, motions: [] };
        const actionData = new NjsActionData(device, cache, action, 0);
        renderer.actionData.push(actionData);
        const actionInstance = new NjsActionInstance(device, cache, actionData, renderer.textureHolder);
        renderer.actions.push(actionInstance);
        return renderer;
    }
}

export const id = 'JetSetRadio';
export const name = "Jet Set Radio";
export const sceneDescs = [
    new JetSetRadioSceneDesc('STAGE1'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
