import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { DFFMesh, ObjectDefintion, Parser, Texture, TOMInstance, WorldData } from "./bin.js";
import { LevelRenderer } from "./render.js";
import { Checkbox, COOL_BLUE_COLOR, Panel, RENDER_HACKS_ICON } from "../ui.js";
import { DataFetcher } from "../DataFetcher.js";

const CLEAR_COLORS: number[][] = [ // hardcode to approx fog colors for now
    [34, 35, 45], [91, 123, 68], [34, 35, 45], [11, 16, 29],
    [90, 79, 54], [5, 5, 5],     [5, 5, 5],    [5, 5, 5],
    [5, 5, 5],    [5, 5, 5],     [5, 5, 5],    [77, 50, 52],
    [12, 12, 39], [5, 5, 5],     [7, 10, 21],  [7, 19, 34]
];

/*
Game uses the RenderWare engine. Some files have their extensions changed (such as .TXD to .DIC) and may contain custom structs

TODO

Fix transparency issue (incorrect overlap of multiple alphas)
Dynamic objects
    Correctly positioned and rotated static models at a minimum
    Idle animations would be nice, but not needed
    Even better, figure out AI pathing and have certain enemies/NPCs follow a default path
Figure out how the skybox and water works
Implement mipmapping? Textures are present for it, at least for 32-bit ones
*/

class CasperRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, levelNumber: number, world: WorldData, textures: Map<string, Texture>, tomInstances: TOMInstance[], dffs: Map<string, DFFMesh>) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, levelNumber, world, textures, tomInstances, dffs);
        this.clearColor = CLEAR_COLORS[levelNumber - 1];
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

    public createPanels(): Panel[] {
        const panel = new Panel();
        panel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        panel.setTitle(RENDER_HACKS_ICON, "Render Hacks");
        const toggleBackFaceCull = new Checkbox("Enable back-face culling", this.levelRenderer.cullMode == GfxCullMode.Back);
        toggleBackFaceCull.onchanged = () => {
            this.levelRenderer.cullMode = toggleBackFaceCull.checked ? GfxCullMode.Back : GfxCullMode.None
        };
        panel.contents.appendChild(toggleBackFaceCull.elem);
        const toggleTextures = new Checkbox("Enable textures", true);
        toggleTextures.onchanged = () => {
            this.levelRenderer.showTextures = toggleTextures.checked
        };
        panel.contents.appendChild(toggleTextures.elem);
        const toggleObjects = new Checkbox("Show objects", true);
        toggleObjects.onchanged = () => {
            this.levelRenderer.showObjects = toggleObjects.checked
        };
        panel.contents.appendChild(toggleObjects.elem);
        return [panel];
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
        const tomFile = await context.dataFetcher.fetchData(`${pathBase}/SCRIPTC/${this.id}/M${this.id}.TOM`);
        const obdFile = await context.dataFetcher.fetchData(`${pathBase}/SCRIPTC/CASPER.OBD`);
        const world = new Parser(bspFile.createDataView()).parseBSP();
        const objDefs = new Parser(obdFile.createDataView()).parseOBD();
        const tomInstances = new Parser(tomFile.createDataView()).parseTOM();
        const dffMeshes = await buildDFFMeshes(context.dataFetcher, pathBase, world, objDefs, tomInstances);
        const textures = new Parser(dicFile.createDataView()).parseDIC(device, world.materials);
        return new CasperRenderer(device, this.levelNumber, world, textures, tomInstances, dffMeshes);
    }
}

async function buildDFFMeshes(dataFetcher: DataFetcher, pathBase: string, world: WorldData, objDefs: ObjectDefintion[], tomInstances: TOMInstance[]): Promise<Map<string, DFFMesh>> {
    const meshes = new Map<string, DFFMesh>();
    for (const tom of tomInstances) {
        if (meshes.has(tom.name)) {
            continue;
        }
        let dffPath = "";
        for (const def of objDefs) {
            if (def.names.includes(tom.name)) {
                dffPath = def.dffPath;
                break;
            }
        }
        if (dffPath === "") {
            continue;
        }
        const dffFile = await dataFetcher.fetchData(`${pathBase}/${dffPath}`);
        const mesh = new Parser(dffFile.createDataView()).parseDFF();
        if (mesh.vertexCount === 0) {
            continue;
        }
        world.materials.push(...mesh.materials);
        meshes.set(tom.name, mesh);
    }
    return meshes;
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
