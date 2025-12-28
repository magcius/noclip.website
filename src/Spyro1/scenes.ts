import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { Spyro1LevelData, Spyro1LevelRenderer } from "./render.js"
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";

function decodeVRAMToRGBA(vram: Uint16Array): Uint8Array {
    const TABLE32 = [0, 8, 16, 24, 33, 41, 49, 57, 66, 74, 82, 90, 99, 107, 115, 123,
                     132, 140, 148, 156, 165, 173, 181, 189, 198, 206, 214, 222, 231, 239, 247, 255];

    const out = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < 512 * 512; i++) {
        const word = vram[i];
        const r = TABLE32[(word >> 0) & 0x1F];
        const g = TABLE32[(word >> 5) & 0x1F];
        const b = TABLE32[(word >> 10) & 0x1F];
        out[i * 4 + 0] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = 255;
    }
    return out;
}

export class Spyro1Renderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: Spyro1LevelRenderer;

    constructor(device: GfxDevice, levelData: Spyro1LevelData, vram: GfxTexture) {
        this.renderHelper = new GfxRenderHelper(device);
        this.levelRenderer = new Spyro1LevelRenderer(device, levelData);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);
        this.levelRenderer.prepareToRender(device, this.renderHelper, viewerInput);
        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
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
        this.levelRenderer.destroy(device);
    }
}

class Spyro1Scene implements SceneDesc {
    public id: string;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString(16);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const levelJSON = await context.dataFetcher.fetchData(`Spyro1/extract/sf${this.subFileID}_export.json`);
        const vram = await context.dataFetcher.fetchData(`Spyro1/extract/sf${this.subFileID}_vram.bin`);
        const texture = device.createTexture({
            dimension: GfxTextureDimension.n2D,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: 512,
            height: 512,
            numLevels: 1,
            usage: GfxTextureUsage.Sampled,
            depthOrArrayLayers: 1,
        });
        const rgba = decodeVRAMToRGBA(new Uint16Array(vram.copyToBuffer()));
        device.uploadTextureData(texture, 0, [rgba]);
        const renderer = new Spyro1Renderer(device, JSON.parse(new TextDecoder().decode(levelJSON.createDataView())), texture);
        return renderer;
    }
}

const id = "Spyro1";
const name = "Spyro the Dragon";
const sceneDescs = [
    "Artisans",
    new Spyro1Scene(11, "Artisans Homeworld"),
    new Spyro1Scene(13, "Stone Hill"),
    new Spyro1Scene(15, "Dark Hollow"),
    new Spyro1Scene(17, "Town Square"),
    new Spyro1Scene(21, "Sunny Flight"),
    new Spyro1Scene(19, "Toasty"),
    "Peace Keepers",
    new Spyro1Scene(23, "Peace Keepers Homeworld"),
    new Spyro1Scene(25, "Dry Canyon"),
    new Spyro1Scene(27, "Cliff Town"),
    new Spyro1Scene(29, "Ice Cavern"),
    new Spyro1Scene(33, "Night Flight"),
    new Spyro1Scene(31, "Doctor Shemp")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
