import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { Mesh, ObjectDefintion, RWParser, Texture, ObjectInstance, Level } from "./bin.js";
import { LevelRenderer } from "./render.js";
import { Checkbox, COOL_BLUE_COLOR, Panel, RENDER_HACKS_ICON } from "../ui.js";
import { DataFetcher } from "../DataFetcher.js";
import { Texture as ViewerTexture } from "../viewer.js";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder.js";

const CLEAR_COLORS: number[][] = [ // hardcode to approx fog colors for now
    [34, 35, 45], [91, 123, 68], [34, 35, 45], [11, 16, 29],
    [90, 79, 54], [5, 5, 5],     [5, 5, 5],    [5, 5, 5],
    [5, 5, 5],    [5, 5, 5],     [5, 5, 5],    [77, 50, 52],
    [12, 12, 39], [5, 5, 5],     [7, 10, 21],  [7, 19, 34]
];

/*
Game uses the RenderWare engine. Some files have their extensions changed (such as .TXD to .DIC) and may contain custom structs

TODO

Handle different kinds of transparency better
Dynamic objects
    Idle animations would be nice, but not needed
    Even better, figure out AI pathing and have certain enemies/NPCs follow a default path
Implement mipmapping? Textures are present for it, at least for 32-bit ones
*/

class CasperRenderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: Level, textures: Map<string, Texture>, objInstances: ObjectInstance[], objMeshes: Map<string, Mesh>) {
        const viewerTextures: ViewerTexture[] = [];
        for (const [name, texture] of textures.entries()) {
            viewerTextures.push(convertToViewerTexture(name, texture));
        }
        viewerTextures.sort(function(a, b) { return a.name < b.name ? -1 : 1 });
        this.textureHolder = new FakeTextureHolder(viewerTextures);
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, level, textures, objInstances, objMeshes);
        this.clearColor = CLEAR_COLORS[level.number - 1];
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
        this.textureHolder.destroy(device);
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
        const level = new RWParser(bspFile.createDataView()).parseLevel(this.levelNumber);
        const objDict = new RWParser(obdFile.createDataView()).parseObjectDictionary();
        const objInstances = new RWParser(tomFile.createDataView()).parseLevelObjects();
        const objMeshes = await buildDFFMeshes(context.dataFetcher, pathBase, level, objDict, objInstances);
        const textures = new RWParser(dicFile.createDataView()).parseDIC(device, level.materials);
        return new CasperRenderer(device, level, textures, objInstances, objMeshes);
    }
}

/**
 * Call this **before** parsing textures
 */
async function buildDFFMeshes(dataFetcher: DataFetcher, pathBase: string, level: Level, objDict: ObjectDefintion[], objInstances: ObjectInstance[]): Promise<Map<string, Mesh>> {
    const meshes = new Map<string, Mesh>();
    for (const instance of objInstances) {
        // don't build the same mesh more than once
        if (meshes.has(instance.name)) {
            continue;
        }
        let dffPath = "";
        for (const def of objDict) {
            if (def.names.includes(instance.name)) {
                dffPath = def.dffPath;
                break;
            }
        }
        if (dffPath === "") {
            // console.log("Skipping OBJ by no DFF", instance.name);
            continue;
        }
        const dffFile = await dataFetcher.fetchData(`${pathBase}/${dffPath}`);
        const mesh = new RWParser(dffFile.createDataView()).parseDFF();
        if (mesh.vertexCount === 0) {
            // console.log("Skipping OBJ by no vertices", instance.name);
            continue;
        }
        // append to level materials so the textures don't get skipped
        level.materials.push(...mesh.materials!);
        meshes.set(instance.name, mesh);
    }
    return meshes;
}

function convertToViewerTexture(name: string, texture: Texture): ViewerTexture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.rgba), texture.width, texture.height);
    canvas.title = name;
    const extraInfo = new Map<string, string>();
    extraInfo.set("Has Alpha", `${texture.hasAlpha}`);
    extraInfo.set("Bit Depth", texture.bitDepth.toString());
    return { name, surfaces: [canvas], extraInfo };
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
