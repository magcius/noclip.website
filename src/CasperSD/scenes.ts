import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { BSPParser, WorldData } from "./bin.js";
import { LevelRenderer } from "./render.js";

class CasperRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;

    constructor(device: GfxDevice, world: WorldData) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, world);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.levelRenderer.prepareToRender(device, this.renderHelper, viewerInput);
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

const pathBase = "CasperSD";
class CasperScene implements SceneDesc {
    public id: string;

    constructor(private bspPath: string, public name: string) {
        this.id = Number(bspPath.split("LEVEL")[1].split(".")[0]).toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const file = await context.dataFetcher.fetchData(`${pathBase}/MODELS/${this.bspPath}`);
        const p = new BSPParser(file.createDataView());
        const world = p.parse();
        const renderer = new CasperRenderer(device, world);
        return renderer;
    }
}

const id = "CasperSD";
const name = "Casper: Spirit Dimensions";
const sceneDescs = [
    new CasperScene("MEDIEVAL/LEVEL01.BSP", "Level 1"),
    new CasperScene("MEDIEVAL/LEVEL02.BSP", "Level 2"),
    new CasperScene("MEDIEVAL/LEVEL03.BSP", "Level 3"),
    new CasperScene("MEDIEVAL/LEVEL04.BSP", "Level 4"),
    new CasperScene("MEDIEVAL/LEVEL05.BSP", "Level 5"),
    new CasperScene("CARNIVAL/LEVEL06.BSP", "Level 6"),
    new CasperScene("SPIRIT/LEVEL07.BSP", "Level 7"),
    new CasperScene("CARNIVAL/LEVEL08.BSP", "Level 8"),
    new CasperScene("SPIRIT/LEVEL09.BSP", "Level 9"),
    new CasperScene("SPIRIT/LEVEL10.BSP", "Level 10"),
    new CasperScene("CARNIVAL/LEVEL11.BSP", "Level 11"),
    new CasperScene("FACTORY/LEVEL12.BSP", "Level 12"),
    new CasperScene("FACTORY/LEVEL13.BSP", "Level 13"),
    new CasperScene("FACTORY/LEVEL14.BSP", "Level 14"),
    new CasperScene("SPIRIT/LEVEL15.BSP", "Level 15"),
    new CasperScene("HOUSE/LEVEL16.BSP", "Level 16")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
