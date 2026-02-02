import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { Parser, Texture, WorldData } from "./bin.js";
import { LevelRenderer } from "./render.js";

const clearColors: number[][] = [
    [34, 35, 45], [128, 128, 128], [128, 128, 128], [128, 128, 128],
    [128, 128, 128], [128, 128, 128], [128, 128, 128], [128, 128, 128],
    [128, 128, 128], [128, 128, 128], [128, 128, 128], [128, 128, 128],
    [128, 128, 128], [128, 128, 128], [128, 128, 128], [7, 19, 34]
];

class CasperRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, levelNumber: number, world: WorldData, textures: Map<string, Texture>) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, world, textures);
        this.clearColor = clearColors[levelNumber - 1];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.levelRenderer.prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        mainColorDesc.clearColor = {r: this.clearColor[0] / 255, g: this.clearColor[1] / 255, b: this.clearColor[2] / 255, a: 1};
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
    private levelNumber: number;

    constructor(private bspPath: string, public name: string) {
        this.id = bspPath.split("/")[1].split(".")[0];
        this.levelNumber = Number(this.id.split("LEVEL")[1]);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const bspFile = await context.dataFetcher.fetchData(`${pathBase}/MODELS/${this.bspPath}`);
        const dicFile = await context.dataFetcher.fetchData(`${pathBase}/MODELS/LEVEL${this.levelNumber}.DIC`);
        const world = new Parser(bspFile.createDataView()).parseBSP();
        const textures = new Parser(dicFile.createDataView()).parseDIC(device, world.materials);
        return new CasperRenderer(device, this.levelNumber, world, textures);
    }
}

const id = "CasperSD";
const name = "Casper: Spirit Dimensions";
const sceneDescs = [
    "Hub",
    new CasperScene("HOUSE/LEVEL16.BSP", "Casper's House"),
    "Medieval World",
    new CasperScene("MEDIEVAL/LEVEL01.BSP", "Knight's Home"),
    new CasperScene("MEDIEVAL/LEVEL02.BSP", "Thieves' Woods"),
    new CasperScene("MEDIEVAL/LEVEL03.BSP", "Wizard's Tower"),
    new CasperScene("MEDIEVAL/LEVEL04.BSP", "Snowy Town"),
    new CasperScene("MEDIEVAL/LEVEL05.BSP", "Dragon's Cave"),
    "Spirit Amusement Park",
    new CasperScene("CARNIVAL/LEVEL06.BSP", "Vlad's Amusement Park"),
    new CasperScene("CARNIVAL/LEVEL08.BSP", "Fun House"),
    new CasperScene("CARNIVAL/LEVEL11.BSP", "Big Top"),
    "Kibosh's Factory",
    new CasperScene("FACTORY/LEVEL12.BSP", "Monster Maker"),
    new CasperScene("FACTORY/LEVEL13.BSP", "Refinery"),
    new CasperScene("FACTORY/LEVEL14.BSP", "Doctor Deranged"),
    "The Spirit World",
    new CasperScene("SPIRIT/LEVEL07.BSP", "Ghost Ship"),
    new CasperScene("SPIRIT/LEVEL10.BSP", "Kibosh's Castle"),
    new CasperScene("SPIRIT/LEVEL09.BSP", "Kibosh's Castle Interior"),
    new CasperScene("SPIRIT/LEVEL15.BSP", "Kibosh's Lair")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
