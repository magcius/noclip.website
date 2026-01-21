import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { buildCombinedAtlas, buildCombinedAtlas2, buildLevelData, buildSkybox, parseTileGroups, parseTileGroups2, VRAM, SkyboxData, LevelData } from "./bin.js"
import { LevelRenderer, SkyboxRenderer } from "./render.js"
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";

/*
To-do list

    Scrolling textures
    Better level shader (remove color banding and make brighter)
    Clean up functions in bin.ts

    Spyro 1
        Water in some flight levels doesn't render correctly (different than ground like the second game?)
        
    Spyro 2
        The title screen needs its low-poly parts rendered to look correct (and possibly some others)
            All levels are currently only showing high-poly/textured (see buildLevelData in bin.ts)
        Water is mostly correct but the tinting is hardcoded in the shader
        There are a very small number of incorrect faces (unsure if all the same problem or different. Some could be invisible walls/collision related)
            Below the Ocean Speedway portal in Summer Forest there's stray faces
            The outdoor waterfall in Idol Springs has two black triangles
            Colossus has a z-fighting face in the hockey rink's ice
            Hurricos has black polygons in the gates that need spark plugs to open
            Aquaria Towers has some of the tower numbers' faces being rendered as water
            Zephyr has a stray face that's treated as water in the plant/seed section (the exploded building is expected!)
            Metropolis has some faces at the starting area that are incorrectly rendered as water
            Dragon Shores has a water triangle along the edge "ocean" that appears much brighter and has z-fighting
            Dragon Shores also has one of the dragon statues at the entrance with parts of its wings being treated as water
        Shady Oasis and Mystic Marsh both appear to be squished. Probably an issue with z-scaling

Nice to have

    Gems, level entities, NPCs, etc. rendered in each level
        The format for these will need to be figured out. They're in other "sub-subfiles" like the ground models and skybox
    Read directly from WAD.WAD by offset instead of extracting subfiles (if better than extraction)
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
        const renderer = new Spyro1Renderer(device, buildLevelData(ground.createDataView(), combinedAtlas, 1), buildSkybox(sky.createDataView(), 1));
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
        const vram = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_sky.bin`);
        const tileGroups = parseTileGroups2(textures.createDataView());
        const vramObj = new VRAM(vram.copyToBuffer());
        vramObj.applySpyro2FontStripFix();
        const combinedAtlas = buildCombinedAtlas2(vramObj, tileGroups);
        const renderer = new Spyro2Renderer(device, buildLevelData(ground.createDataView(), combinedAtlas, 2), buildSkybox(sky.createDataView(), 2));
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
    new Spyro2Scene(20, "Idol Springs"),
    new Spyro2Scene(22, "Colossus"),
    new Spyro2Scene(24, "Hurricos"),
    new Spyro2Scene(28, "Sunny Beach"),
    new Spyro2Scene(26, "Aquaria Towers"),
    new Spyro2Scene(30, "Ocean Speedway"),
    new Spyro2Scene(32, "Crush's Dungeon"),
    "Autumn Plains",
    new Spyro2Scene(34, "Autumn Plains Homeworld"),
    new Spyro2Scene(36, "Skelos Badlands"),
    new Spyro2Scene(38, "Crystal Glacier"),
    new Spyro2Scene(40, "Breeze Harbor"),
    new Spyro2Scene(42, "Zephyr"),
    new Spyro2Scene(46, "Scorch"),
    new Spyro2Scene(52, "Fracture Hills"),
    new Spyro2Scene(50, "Magma Cone"),
    new Spyro2Scene(48, "Shady Oasis"),
    new Spyro2Scene(44, "Metro Speedway"),
    new Spyro2Scene(54, "Icy Speedway"),
    new Spyro2Scene(56, "Gulp's Overlook"),
    "Winter Tundra",
    new Spyro2Scene(58, "Winter Tundra Homeworld"),
    new Spyro2Scene(62, "Cloud Temples"),
    new Spyro2Scene(60, "Mystic Marsh"),
    new Spyro2Scene(66, "Robotica Farms"),
    new Spyro2Scene(68, "Metropolis"),
    new Spyro2Scene(64, "Canyon Speedway"),
    new Spyro2Scene(72, "Ripto's Arena"),
    new Spyro2Scene(70, "Dragon Shores"),
    "Cutscenes",
    new Spyro2Scene(96, "Title Screen"),
    new Spyro2Scene(74, "Introduction"),
    new Spyro2Scene(76, "Glimmer (Intro)"),
    new Spyro2Scene(78, "Summer Forest (Intro)"),
    new Spyro2Scene(80, "Winter Tundra (Interlude)"),
    new Spyro2Scene(82, "Crush's Dungeon (Outro)"),
    new Spyro2Scene(84, "Autumn Plains (Intro)"),
    new Spyro2Scene(86, "Gulp's Overlook (Intro)"),
    new Spyro2Scene(88, "Gulp's Overlook (Outro)"),
    new Spyro2Scene(90, "Winter Tundra (Intro)"),
    new Spyro2Scene(92, "Ripto's Arena (Intro)"),
    new Spyro2Scene(94, "Ripto's Arena (Outro)")
    // "Credits Flyover", // currently broken but these are the valid ids
    // new Spyro2Scene(188, "Flyover"),
    // new Spyro2Scene(189, "Flyover"),
    // new Spyro2Scene(190, "Flyover"),
    // new Spyro2Scene(191, "Flyover"),
    // new Spyro2Scene(192, "Flyover"),
    // new Spyro2Scene(193, "Flyover"),
    // new Spyro2Scene(194, "Flyover"),
    // new Spyro2Scene(195, "Flyover"),
    // new Spyro2Scene(196, "Flyover"),
    // new Spyro2Scene(197, "Flyover")
];

export const sceneGroup1: SceneGroup = {id: id1, name: name1, sceneDescs: sceneDescs1};
export const sceneGroup2: SceneGroup = {id: id2, name: name2, sceneDescs: sceneDescs2};
