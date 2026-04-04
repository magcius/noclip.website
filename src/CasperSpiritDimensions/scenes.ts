import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { CasperMesh, CasperObjectDefinition, CasperRWParser, CasperTexture, CasperObjectInstance, CapserLevel } from "./bin.js";
import { CasperLevelRenderer } from "./render.js";
import { Checkbox, COOL_BLUE_COLOR, LayerPanel, Panel, RENDER_HACKS_ICON } from "../ui.js";
import { DataFetcher } from "../DataFetcher.js";
import { Texture as ViewerTexture } from "../viewer.js";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder.js";

/*
Game uses the RenderWare engine. Some files have their extensions changed (such as .TXD to .DIC) and contain custom structs

TODO

Add frustum culling for base level geometry by node bboxes (need to check if nodes actually have bboxes)
    This isn't really needed since performance is not a problem, but good to have nonetheless
knight242 texture is parsed wrong?
Figure out X and Z for rotations (inconsistent across different objects)
    Example the grate and gems in snowy town
Figure out lava in dragon's cave
Figure out why some objects with meshes in TOM don't render
    Example the cannon in the amusement park
Figure out normals/lighting
Figure out how some objects/texture without alpha names are set to be transparent
    Example casper himself or kibosh
Level objects
    Add different kinds, fix the ones currently ignored
    Idle animations, mix of plaintext and .ska files
    Pathing?
*/

const CLEAR_COLORS: number[][] = [
    [34, 35, 45], [91, 123, 68], [34, 35, 45], [11, 16, 29],
    [90, 79, 54], [5, 5, 5],     [5, 5, 5],    [5, 5, 5],
    [5, 5, 5],    [5, 5, 5],     [5, 5, 5],    [77, 50, 52],
    [12, 12, 39], [5, 5, 5],     [7, 10, 21],  [7, 19, 34]
];

class CasperRenderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: CasperLevelRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: CapserLevel, textures: Map<string, CasperTexture>, objMeshes: Map<string, CasperMesh>, objInstances: CasperObjectInstance[]) {
        const viewerTextures: ViewerTexture[] = [];
        for (const texture of textures.values()) {
            viewerTextures.push({
                gfxTexture: texture.gfxTexture,
                extraInfo: new Map<string, string>([["Has Alpha", `${texture.hasAlpha}`], ["Bit Depth", `${texture.bitDepth}`]])
            });
        }

        this.textureHolder = new FakeTextureHolder(viewerTextures);
        this.renderHelper = new GfxRenderHelper(device);
        this.levelRenderer = new CasperLevelRenderer(this.renderHelper.renderCache, level, textures, objMeshes, objInstances);

        this.clearColor = CLEAR_COLORS[level.number - 1];
        this.clearColor[0] /= 255;
        this.clearColor[1] /= 255;
        this.clearColor[2] /= 255;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.levelRenderer.prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        mainColorDesc.clearColor = { r: this.clearColor[0], g: this.clearColor[1], b: this.clearColor[2], a: 1 };
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

    public createPanels(): Panel[] {
        const layersPanel = new LayerPanel();
        layersPanel.setLayers(this.levelRenderer.meshLayers);

        const optionsPanel = new Panel();
        optionsPanel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        optionsPanel.setTitle(RENDER_HACKS_ICON, "Render Hacks");
        const toggleBackFaceCull = new Checkbox("Enable back-face culling", this.levelRenderer.cullMode == GfxCullMode.Back);
        toggleBackFaceCull.onchanged = () => {
            this.levelRenderer.cullMode = toggleBackFaceCull.checked ? GfxCullMode.Back : GfxCullMode.None
        };
        optionsPanel.contents.appendChild(toggleBackFaceCull.elem);
        const toggleTextures = new Checkbox("Enable textures", true);
        toggleTextures.onchanged = () => {
            this.levelRenderer.showTextures = toggleTextures.checked
        };
        optionsPanel.contents.appendChild(toggleTextures.elem);
        const toggleObjects = new Checkbox("Show objects", true);
        toggleObjects.onchanged = () => {
            this.levelRenderer.showObjects = toggleObjects.checked
        };
        optionsPanel.contents.appendChild(toggleObjects.elem);

        return [layersPanel, optionsPanel];
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
        // game is inconsistent with level numbers like "02" vs "2"
        this.id = bspPath.split("/")[1].split(".")[0];
        this.levelNumber = Number(this.id.split("LEVEL")[1]);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const bsp = await context.dataFetcher.fetchData(`${pathBase}/MODELS/${this.bspPath}`);
        const dic = await context.dataFetcher.fetchData(`${pathBase}/MODELS/LEVEL${this.levelNumber}.DIC`);
        const tom = await context.dataFetcher.fetchData(`${pathBase}/SCRIPTC/${this.id}/M${this.id}.TOM`);
        const obd = await context.dataFetcher.fetchData(`${pathBase}/SCRIPTC/CASPER.OBD`);

        const level = new CasperRWParser(bsp).parseBSP(this.id, this.levelNumber);

        const objDefs = new CasperRWParser(obd).parseOBD();
        const instances = new CasperRWParser(tom).parseTOM();
        const objMeshes = await buildDFFMeshes(context.dataFetcher, level, objDefs, instances);

        const textures = new CasperRWParser(dic).parseDIC(device, level.materials);

        return new CasperRenderer(device, level, textures, objMeshes, instances);
    }
}

/**
 * Call this _before_ parsing textures so meshes' materials aren't ignored
 */
async function buildDFFMeshes(dataFetcher: DataFetcher, level: CapserLevel, objDefs: CasperObjectDefinition[], objInstances: CasperObjectInstance[]): Promise<Map<string, CasperMesh>> {
    const meshes = new Map<string, CasperMesh>();
    for (const instance of objInstances) {
        // don't build the same mesh more than once
        if (meshes.has(instance.name)) {
            continue;
        }
        let path = "";
        for (const def of objDefs) {
            if (def.names.includes(instance.name)) {
                path = def.dffPath;
                break;
            }
        }
        if (path === "") {
            // console.log("Skipping OBJ by no DFF", instance.name);
            continue;
        }
        const dff = await dataFetcher.fetchData(`${pathBase}/${path}`);
        const mesh = new CasperRWParser(dff).parseDFF();
        if (mesh.vertices.length === 0) {
            // console.log("Skipping OBJ by no vertices", instance.name);
            continue;
        }
        // append to level materials so the textures don't get skipped
        level.materials.push(...mesh.materials!);
        meshes.set(instance.name, mesh);
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
