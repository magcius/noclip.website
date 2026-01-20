import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { buildCombinedAtlas, buildLevelData, buildSkybox, parseTileGroups, VRAM, SkyboxData, LevelData } from "./bin.js"
import { LevelRenderer, SkyboxRenderer } from "./render.js"
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";

/*
To-do list

Spyro 1
    Scrolling textures (ex. waterfall in Artisans)
    Water in some flight levels doesn't render correctly
    Better level shader
    Clean up functions in bin.ts

Nice to have

Spyro 1
    Gems, level entities, NPCs, etc. rendered in each level
        The format for these will need to be figured out. They're in other "sub-subfiles" like the ground models and skybox.
    Read directly from WAD.WAD by offset instead of extracting subfiles
        Pass the offset and size for the level's subfile instead of the subfile number
        Convert Python extraction logic to TypeScript
*/

class Spyro1Renderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private skyboxRenderer: SkyboxRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, levelData: LevelData, skybox: SkyboxData) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, levelData);
        this.skyboxRenderer = new SkyboxRenderer(cache, skybox);
        this.clearColor = skybox.backgroundColor;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.skyboxRenderer.prepareToRender(device, this.renderHelper, viewerInput);
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
        this.skyboxRenderer.destroy(device);
        this.levelRenderer.destroy(device);
    }
}

class Spyro2Renderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    // private skyboxRenderer: SkyboxRenderer;
    // private clearColor: number[];

    constructor(device: GfxDevice, levelData: LevelData) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, levelData);
        // this.skyboxRenderer = new SkyboxRenderer(cache, skybox);
        // this.clearColor = skybox.backgroundColor;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        // this.skyboxRenderer.prepareToRender(device, this.renderHelper, viewerInput);
        this.levelRenderer.prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        // mainColorDesc.clearColor = {r: this.clearColor[0] / 255, g: this.clearColor[1] / 255, b: this.clearColor[2] / 255, a: 1};
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
        // this.skyboxRenderer.destroy(device);
        this.levelRenderer.destroy(device);
    }
}

const pathBase1 = "Spyro1";
class Spyro1Scene implements SceneDesc {
    public id: string;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const ground = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_ground.bin`);
        const vram = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_sky1.bin`);
        const tileGroups = parseTileGroups(textures.createDataView());
        const combinedAtlas = buildCombinedAtlas(new VRAM(vram.copyToBuffer()), tileGroups);
        const renderer = new Spyro1Renderer(device, buildLevelData(ground.createDataView(), combinedAtlas, 1), buildSkybox(sky.createDataView()));
        return renderer;
    }
}

const pathBase2 = "Spyro2";
class Spyro2Scene implements SceneDesc {
    public id: string;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const ground = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_ground.bin`);
        // const vram = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_vram.bin`);
        // const textures = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_list.bin`);
        // const sky = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_sky.bin`);
        // const tileGroups = parseTileGroups(textures.createDataView());
        // const combinedAtlas = buildCombinedAtlas(new VRAM(vram.copyToBuffer()), tileGroups);
        const renderer = new Spyro2Renderer(device, buildLevelData(ground.createDataView(), null, 2));
        return renderer;
    }
}

const id1 = "Spyro1";
const name1 = "Spyro the Dragon";
const sceneDescs1 = [
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
    new Spyro1Scene(31, "Doctor Shemp"),
    "Magic Crafters",
    new Spyro1Scene(35, "Magic Crafters Homeworld"),
    new Spyro1Scene(37, "Alpine Ridge"),
    new Spyro1Scene(39, "High Caves"),
    new Spyro1Scene(41, "Wizard Peak"),
    new Spyro1Scene(45, "Crystal Flight"),
    new Spyro1Scene(43, "Blowhard"),
    "Beast Makers",
    new Spyro1Scene(47, "Beast Makers Homeworld"),
    new Spyro1Scene(49, "Terrace Village"),
    new Spyro1Scene(51, "Misty Bog"),
    new Spyro1Scene(53, "Tree Tops"),
    new Spyro1Scene(57, "Wild Flight"),
    new Spyro1Scene(55, "Metalhead"),
    "Dream Weavers",
    new Spyro1Scene(59, "Dream Weavers Homeworld"),
    new Spyro1Scene(61, "Dark Passage"),
    new Spyro1Scene(63, "Lofty Castle"),
    new Spyro1Scene(65, "Haunted Towers"),
    new Spyro1Scene(69, "Icy Flight"),
    new Spyro1Scene(67, "Jacques"),
    "Gnorc Gnexus",
    new Spyro1Scene(71, "Gnorc Gnexus Homeworld"),
    new Spyro1Scene(73, "Gnorc Cove"),
    new Spyro1Scene(75, "Twilight Harbor"),
    new Spyro1Scene(77, "Gnasty Gnorc"),
    new Spyro1Scene(79, "Gnasty's Loot"),
    "Cutscenes",
    new Spyro1Scene(4, "Title Screen"),
    new Spyro1Scene(5, "Introduction"),
    new Spyro1Scene(6, "Ending"),
    new Spyro1Scene(7, "Ending (Full Completion)"),
    "Credits Flyover",
    new Spyro1Scene(83, "Artisans Homeworld"),
    new Spyro1Scene(84, "Stone Hill"),
    new Spyro1Scene(85, "Town Square"),
    new Spyro1Scene(92, "Toasty"),
    new Spyro1Scene(86, "Peace Keepers Homeworld"),
    new Spyro1Scene(87, "Cliff Town"),
    new Spyro1Scene(88, "Doctor Shemp"),
    new Spyro1Scene(89, "Magic Crafters Homeworld"),
    new Spyro1Scene(90, "High Caves"),
    new Spyro1Scene(91, "Wizard Peak"),
    new Spyro1Scene(93, "Terrace Village"),
    new Spyro1Scene(97, "Wild Flight"),
    new Spyro1Scene(94, "Metalhead"),
    new Spyro1Scene(95, "Dark Passage"),
    new Spyro1Scene(96, "Haunted Towers"),
    new Spyro1Scene(99, "Icy Flight"),
    new Spyro1Scene(102, "Jacques"),
    new Spyro1Scene(98, "Gnorc Cove"),
    new Spyro1Scene(101, "Twilight Harbor"),
    new Spyro1Scene(100, "Gnasty Gnorc")
];

const id2 = "Spyro2";
const name2 = "Spyro 2: Ripto's Rage!";
const sceneDescs2 = [
    "Summer Forest",
    new Spyro2Scene(16, "Summer Forest Homeworld"),
    new Spyro2Scene(18, "Glimmer"),
    new Spyro2Scene(999, "Idol Springs"),
    new Spyro2Scene(999, "Colossus"),
    new Spyro2Scene(999, "Hurricos"),
    new Spyro2Scene(999, "Sunny Beach"),
    new Spyro2Scene(999, "Aquaria Towers"),
    new Spyro2Scene(999, "Ocean Speedway"),
    new Spyro2Scene(999, "Crush's Dungeon"),
    "Autumn Plains",
    new Spyro2Scene(999, "Autumn Plains Homeworld"),
    new Spyro2Scene(999, "Skelos Badlands"),
    new Spyro2Scene(999, "Crystal Glacier"),
    new Spyro2Scene(999, "Breeze Harbor"),
    new Spyro2Scene(999, "Zephyr"),
    new Spyro2Scene(999, "Scorch"),
    new Spyro2Scene(999, "Fracture Hills"),
    new Spyro2Scene(999, "Magma Cone"),
    new Spyro2Scene(999, "Shady Oasis"),
    new Spyro2Scene(999, "Metro Speedway"),
    new Spyro2Scene(999, "Icy Speedway"),
    new Spyro2Scene(999, "Gulp's Overlook"),
    "Winter Tundra",
    new Spyro2Scene(999, "Winter Tundra Homeworld"),
    new Spyro2Scene(999, "Cloud Temples"),
    new Spyro2Scene(999, "Robotica Farms"),
    new Spyro2Scene(999, "Metropolis"),
    new Spyro2Scene(999, "Canyon Speedway"),
    new Spyro2Scene(999, "Ripto's Arena"),
    new Spyro2Scene(999, "Dragon Shores")
];

export const sceneGroup1: SceneGroup = {id: id1, name: name1, sceneDescs: sceneDescs1};
export const sceneGroup2: SceneGroup = {id: id2, name: name2, sceneDescs: sceneDescs2};
