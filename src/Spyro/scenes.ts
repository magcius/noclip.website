import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { buildTileAtlas, buildLevel, buildSkybox, parseTileGroups, VRAM, Skybox, Level } from "./bin.js"
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
            All levels are currently only showing high-poly/textured (see buildLevel in bin.ts)
        Water is mostly correct but the tinting is hardcoded in the shader
        There are a very small number of incorrect faces (unsure if all the same problem or different. Some could be invisible walls/collision related)
            Below the Ocean Speedway portal in Summer Forest there's stray faces
            The outdoor waterfall in Idol Springs has two black triangles
            Colossus has a z-fighting face in the hockey rink's ice
            Hurricos has black polygons in the gates that need spark plugs to open
            Aquaria Towers has some of the tower numbers' faces being rendered as water
            A missing face next to the destroyable wall in Autumn Plains
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

class SpyroRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private skyboxRenderer: SkyboxRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: Level, skybox: Skybox) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, level);
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

class SpyroRenderer2 implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private skyboxRenderer: SkyboxRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: Level, skybox: Skybox) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, level);
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
class SpyroScene implements SceneDesc {
    public id: string;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const ground = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_ground.bin`);
        const vram = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase1}/sf${this.subFileID}_sky1.bin`);

        const tileGroups = parseTileGroups(textures.createDataView(), 1);
        const tileAtlas = buildTileAtlas(new VRAM(vram.copyToBuffer()), tileGroups, 1);
        const level = buildLevel(ground.createDataView(), tileAtlas, 1);
        const skybox = buildSkybox(sky.createDataView(), 1);
        const renderer = new SpyroRenderer(device, level, skybox);

        return renderer;
    }
}

const pathBase2 = "Spyro2";
class SpyroScene2 implements SceneDesc {
    public id: string;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const ground = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_ground.bin`);
        const vram = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_sky.bin`);

        const tileGroups = parseTileGroups(textures.createDataView(), 2);
        const vramObj = new VRAM(vram.copyToBuffer());
        vramObj.applyFontStripFix();

        const tileAtlas = buildTileAtlas(vramObj, tileGroups, 2);
        const level = buildLevel(ground.createDataView(), tileAtlas, 2);
        const skybox = buildSkybox(sky.createDataView(), 2);
        const renderer = new SpyroRenderer2(device, level, skybox);

        return renderer;
    }
}

const id1 = "Spyro1";
const name1 = "Spyro the Dragon";
const sceneDescs1 = [
    "Artisans",
    new SpyroScene(11, "Artisans Homeworld"),
    new SpyroScene(13, "Stone Hill"),
    new SpyroScene(15, "Dark Hollow"),
    new SpyroScene(17, "Town Square"),
    new SpyroScene(21, "Sunny Flight"),
    new SpyroScene(19, "Toasty"),
    "Peace Keepers",
    new SpyroScene(23, "Peace Keepers Homeworld"),
    new SpyroScene(25, "Dry Canyon"),
    new SpyroScene(27, "Cliff Town"),
    new SpyroScene(29, "Ice Cavern"),
    new SpyroScene(33, "Night Flight"),
    new SpyroScene(31, "Doctor Shemp"),
    "Magic Crafters",
    new SpyroScene(35, "Magic Crafters Homeworld"),
    new SpyroScene(37, "Alpine Ridge"),
    new SpyroScene(39, "High Caves"),
    new SpyroScene(41, "Wizard Peak"),
    new SpyroScene(45, "Crystal Flight"),
    new SpyroScene(43, "Blowhard"),
    "Beast Makers",
    new SpyroScene(47, "Beast Makers Homeworld"),
    new SpyroScene(49, "Terrace Village"),
    new SpyroScene(51, "Misty Bog"),
    new SpyroScene(53, "Tree Tops"),
    new SpyroScene(57, "Wild Flight"),
    new SpyroScene(55, "Metalhead"),
    "Dream Weavers",
    new SpyroScene(59, "Dream Weavers Homeworld"),
    new SpyroScene(61, "Dark Passage"),
    new SpyroScene(63, "Lofty Castle"),
    new SpyroScene(65, "Haunted Towers"),
    new SpyroScene(69, "Icy Flight"),
    new SpyroScene(67, "Jacques"),
    "Gnorc Gnexus",
    new SpyroScene(71, "Gnorc Gnexus Homeworld"),
    new SpyroScene(73, "Gnorc Cove"),
    new SpyroScene(75, "Twilight Harbor"),
    new SpyroScene(77, "Gnasty Gnorc"),
    new SpyroScene(79, "Gnasty's Loot"),
    "Cutscenes",
    new SpyroScene(4, "Title Screen"),
    new SpyroScene(5, "Introduction"),
    new SpyroScene(6, "Ending"),
    new SpyroScene(7, "Ending (Full Completion)"),
    "Credits Flyover",
    new SpyroScene(83, "Artisans Homeworld"),
    new SpyroScene(84, "Stone Hill"),
    new SpyroScene(85, "Town Square"),
    new SpyroScene(92, "Toasty"),
    new SpyroScene(86, "Peace Keepers Homeworld"),
    new SpyroScene(87, "Cliff Town"),
    new SpyroScene(88, "Doctor Shemp"),
    new SpyroScene(89, "Magic Crafters Homeworld"),
    new SpyroScene(90, "High Caves"),
    new SpyroScene(91, "Wizard Peak"),
    new SpyroScene(93, "Terrace Village"),
    new SpyroScene(97, "Wild Flight"),
    new SpyroScene(94, "Metalhead"),
    new SpyroScene(95, "Dark Passage"),
    new SpyroScene(96, "Haunted Towers"),
    new SpyroScene(99, "Icy Flight"),
    new SpyroScene(102, "Jacques"),
    new SpyroScene(98, "Gnorc Cove"),
    new SpyroScene(101, "Twilight Harbor"),
    new SpyroScene(100, "Gnasty Gnorc")
];

const id2 = "Spyro2";
const name2 = "Spyro 2: Ripto's Rage!";
const sceneDescs2 = [
    "Summer Forest",
    new SpyroScene2(16, "Summer Forest Homeworld"),
    new SpyroScene2(18, "Glimmer"),
    new SpyroScene2(20, "Idol Springs"),
    new SpyroScene2(22, "Colossus"),
    new SpyroScene2(24, "Hurricos"),
    new SpyroScene2(28, "Sunny Beach"),
    new SpyroScene2(26, "Aquaria Towers"),
    new SpyroScene2(30, "Ocean Speedway"),
    new SpyroScene2(32, "Crush's Dungeon"),
    "Autumn Plains",
    new SpyroScene2(34, "Autumn Plains Homeworld"),
    new SpyroScene2(36, "Skelos Badlands"),
    new SpyroScene2(38, "Crystal Glacier"),
    new SpyroScene2(40, "Breeze Harbor"),
    new SpyroScene2(42, "Zephyr"),
    new SpyroScene2(46, "Scorch"),
    new SpyroScene2(52, "Fracture Hills"),
    new SpyroScene2(50, "Magma Cone"),
    new SpyroScene2(48, "Shady Oasis"),
    new SpyroScene2(44, "Metro Speedway"),
    new SpyroScene2(54, "Icy Speedway"),
    new SpyroScene2(56, "Gulp's Overlook"),
    "Winter Tundra",
    new SpyroScene2(58, "Winter Tundra Homeworld"),
    new SpyroScene2(62, "Cloud Temples"),
    new SpyroScene2(60, "Mystic Marsh"),
    new SpyroScene2(66, "Robotica Farms"),
    new SpyroScene2(68, "Metropolis"),
    new SpyroScene2(64, "Canyon Speedway"),
    new SpyroScene2(72, "Ripto's Arena"),
    new SpyroScene2(70, "Dragon Shores"),
    "Cutscenes",
    new SpyroScene2(96, "Title Screen"),
    new SpyroScene2(74, "Introduction"),
    new SpyroScene2(76, "Glimmer (Intro)"),
    new SpyroScene2(78, "Summer Forest (Intro)"),
    new SpyroScene2(80, "Winter Tundra (Interlude)"),
    new SpyroScene2(82, "Crush's Dungeon (Outro)"),
    new SpyroScene2(84, "Autumn Plains (Intro)"),
    new SpyroScene2(86, "Gulp's Overlook (Intro)"),
    new SpyroScene2(88, "Gulp's Overlook (Outro)"),
    new SpyroScene2(90, "Winter Tundra (Intro)"),
    new SpyroScene2(92, "Ripto's Arena (Intro)"),
    new SpyroScene2(94, "Ripto's Arena (Outro)")
    // "Credits Flyover", // currently broken but these are the valid ids
    // new SpyroScene2(188, "Flyover"),
    // new SpyroScene2(189, "Flyover"),
    // new SpyroScene2(190, "Flyover"),
    // new SpyroScene2(191, "Flyover"),
    // new SpyroScene2(192, "Flyover"),
    // new SpyroScene2(193, "Flyover"),
    // new SpyroScene2(194, "Flyover"),
    // new SpyroScene2(195, "Flyover"),
    // new SpyroScene2(196, "Flyover"),
    // new SpyroScene2(197, "Flyover")
];

export const sceneGroup1: SceneGroup = {id: id1, name: name1, sceneDescs: sceneDescs1};
export const sceneGroup2: SceneGroup = {id: id2, name: name2, sceneDescs: sceneDescs2};
