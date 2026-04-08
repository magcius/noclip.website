import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { DreamDropCTRT, DreamDropParser } from "./bin";
import { decodeDreamDropCTRT, DreamDropTexture, translateDreamDropTextureFormatString } from "./texture";
import { Texture as ViewerTexture } from "../viewer.js";

class DreamDropRenderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private textures: DreamDropTexture[];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, ctrts: DreamDropCTRT[]) {
        this.textures = Array(ctrts.length);
        for (let i = 0; i < ctrts.length; i++) {
            const pixels = decodeDreamDropCTRT(ctrts[i]);
            const t = new DreamDropTexture(device, ctrts[i].name, ctrts[i].format, ctrts[i].width, ctrts[i].height, pixels);
            this.textures[i] = t;
        }
        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = {
                gfxTexture: this.textures[i].gfxTexture,
                extraInfo: new Map<string, string>([
                    ["Format", `${translateDreamDropTextureFormatString(this.textures[i].format)}`]
                ])
            };
        }

        this.textureHolder = new FakeTextureHolder(viewerTextures);
        this.renderHelper = new GfxRenderHelper(device);
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
        builder.execute();
        this.renderInstListMain.reset();
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (const t of this.textures) {
            device.destroyTexture(t.gfxTexture);
        }
    }
}

const pathBase = "KingdomHeartsDDD";
class KHDDDScene implements SceneDesc {
    public id: string;

    constructor(public name: string) {
        this.id = this.name;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const pmpFile = await context.dataFetcher.fetchData(`${pathBase}/map/${this.name}.pmp`);
        const pmp = new DreamDropParser(pmpFile).parsePMP();
        console.log(pmp.pmos);
        return new DreamDropRenderer(device, pmp.ctrts);
    }
}

const id = "KHDDD";
const name = "Kingdom Hearts 3D: Dream Drop Distance";
const sceneDescs = [
    "Destiny Islands",
    new KHDDDScene("di_01"),
    new KHDDDScene("di_02"),
    new KHDDDScene("di_03"),
    new KHDDDScene("di_05"),
    "Mysterious Tower",
    new KHDDDScene("yt_01"),
    new KHDDDScene("yt_02"),
    new KHDDDScene("yt_03"),
    new KHDDDScene("yt_04"),
    new KHDDDScene("yt_06"),
    new KHDDDScene("yt_07"),
    "Traverse Town",
    new KHDDDScene("tw_01"),
    new KHDDDScene("tw_02"),
    new KHDDDScene("tw_03"),
    new KHDDDScene("tw_04"),
    new KHDDDScene("tw_05"),
    new KHDDDScene("tw_06"),
    new KHDDDScene("tw_07"),
    new KHDDDScene("tw_08"),
    new KHDDDScene("tw_09"),
    new KHDDDScene("tw_10"),
    new KHDDDScene("tw_11"),
    new KHDDDScene("tw_12"),
    new KHDDDScene("tw_13"),
    new KHDDDScene("tw_14"),
    "Spirit Space",
    new KHDDDScene("de_01"),
    new KHDDDScene("de_02"),
    new KHDDDScene("de_03"),
];

export const sceneGroup: SceneGroup = { id: id, name: name, sceneDescs: sceneDescs };
