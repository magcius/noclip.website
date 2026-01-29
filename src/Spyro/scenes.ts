import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { buildTileAtlas, buildLevel, buildSkybox, VRAM, Skybox, Level, parseMobys, Moby } from "./bin.js"
import { LevelRenderer, SkyboxRenderer } from "./render.js"
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { Checkbox, COOL_BLUE_COLOR, Panel, RENDER_HACKS_ICON } from "../ui.js";

/*
To-do list

    Better handling of water, although it should be mostly accurate
        The detection of what is and isn't water could be better to get rid of false positives
    Better handling of LOD levels
        Right now it's just a toggle b/t high and low, but it'd be ideal to render both since low LOD usually is larger than high LOD
        This is will fix some scenes that seem way too small (particularly cutscenes w/ fixed camera) since a lot of their look is from low LOD polys
    Clean up functions in bin.ts
    Add back "starring" levels (credits flyover versions of regular levels) to S2/S3
        There's a problem with extracting their skyboxes currently so they're not included

    Spyro 1
        Per-tile transparency masking (see "water" in Gnasty's Loot or Icy Flight)
        
    Spyro 2
        There are a very small number of incorrect faces (unsure if all the same problem or different. Some are invisible walls/collision related)
            Most (but not all) portals in homeworlds have black portal-shaped faces under them
            Idol Springs has two black triangles at the top of the outdoor waterfall
            Colossus has a z-fighting face in the hockey rink's ice
            Hurricos has black polygons on the gates that need spark plugs to open (Sunny Beach has similar ones on its gates)
            Dragon Shores has a water triangle along the edge "ocean" that appears much brighter than it should (wrong texture?)
        Mystic Marsh and Shady Oasis have weird z-scaling that requires special handling in buildLevel
            This may not be an issue, just something that warrants further investigation
            LOD toggle does not work on these levels either for some reason

    Spyro 3
        There are a very small number of incorrect faces
            Molten Crater has some random ground textures in the trees (could be like that in the game)
            Mushroom Speedway's mushrooms should have transparent parts but they aren't marked as transparent in the same way as other textures are
            Icy Peak has some misaligned vertex colors under the ice sections (likely an issue with the game itself)
        Sublevels should extract their own skybox, not default to the parent level's

Nice to have

    Scrolling textures determined by levels' data, not hardcoded
    Render mobys in each level
        The format will need to be figured out. They're in other level subfiles (S2 grabs from global store instead?)
        Positions of mobys in S3 are figured out, but need the models and (maybe) animations
    Misc level effects, such as vertex color "shimmering" under water sections in S2/S3 and lava movement
    Read directly from WAD.WAD by offset instead of extracting subfiles (if better than extraction)
*/

class SpyroRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private skyboxRenderer: SkyboxRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: Level, skybox: Skybox, private mobys?: Moby[]) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;
        this.levelRenderer = new LevelRenderer(cache, level, this.mobys);
        this.skyboxRenderer = new SkyboxRenderer(cache, skybox);
        this.clearColor = skybox.backgroundColor;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        if (this.levelRenderer.showMobys) {
            this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        }
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
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public createPanels(): Panel[] {
        const panel = new Panel();
        panel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        panel.setTitle(RENDER_HACKS_ICON, "Level Options");
        const toggleLOD = new Checkbox("Toggle LOD", false);
        toggleLOD.onchanged = () => {
            this.levelRenderer.showLOD = toggleLOD.checked
        };
        panel.contents.appendChild(toggleLOD.elem);
        const toggleTextures = new Checkbox("Show textures", true);
        toggleTextures.onchanged = () => {
            this.levelRenderer.showTextures = toggleTextures.checked
        };
        panel.contents.appendChild(toggleTextures.elem);
        if (this.mobys === undefined)
            return [panel];
        const showMobysCheckbox = new Checkbox("Show moby positions", false);
        showMobysCheckbox.onchanged = () => {
            this.levelRenderer.showMobys = showMobysCheckbox.checked
        };
        panel.contents.appendChild(showMobysCheckbox.elem);
        return [panel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.skyboxRenderer.destroy(device);
        this.levelRenderer.destroy(device);
    }
}

const pathBase = "Spyro1";
class SpyroScene implements SceneDesc {
    public id: string;
    private gameNumber: number;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString();
        this.gameNumber = 1;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const ground = await context.dataFetcher.fetchData(`${pathBase}/sf${this.subFileID}_ground.bin`);
        const vram = await context.dataFetcher.fetchData(`${pathBase}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase}/sf${this.subFileID}_sky1.bin`);

        const tileAtlas = buildTileAtlas(new VRAM(vram.copyToBuffer()), textures.createDataView(), this.gameNumber);
        const level = buildLevel(ground.createDataView(), tileAtlas, this.gameNumber, this.subFileID);
        const skybox = buildSkybox(sky.createDataView(), this.gameNumber);
        const renderer = new SpyroRenderer(device, level, skybox);

        return renderer;
    }
}

const pathBase2 = "Spyro2";
class SpyroScene2 implements SceneDesc {
    public id: string;
    private gameNumber: number;

    constructor(public subFileID: number, public name: string) {
        this.id = subFileID.toString();
        this.gameNumber = 2;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const ground = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_ground.bin`);
        const vram = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}_sky.bin`);

        const vramObj = new VRAM(vram.copyToBuffer());
        vramObj.applyFontStripFix();

        const tileAtlas = buildTileAtlas(vramObj, textures.createDataView(), this.gameNumber);
        const level = buildLevel(ground.createDataView(), tileAtlas, this.gameNumber, this.subFileID);
        const skybox = buildSkybox(sky.createDataView(), this.gameNumber);
        const renderer = new SpyroRenderer(device, level, skybox);

        return renderer;
    }
}

const pathBase3 = "Spyro3";
class SpyroScene3 implements SceneDesc {
    public id: string;
    private gameNumber: number;

    constructor(public subFileID: number, public name: string, private subLevelID?: number) {
        this.id = subFileID.toString();
        if (this.subLevelID !== undefined) {
            this.id = `${subFileID}_${subLevelID}`;
        }
        this.gameNumber = 3;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        let ground = null;
        if (this.subLevelID === undefined) {
            ground = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}_ground.bin`);
        } else {
            ground = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}_ground${this.subLevelID}.bin`);
        }
        const vram = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}_vram.bin`);
        const textures = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}_list.bin`);
        const sky = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}_sky.bin`);

        const varsFile = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}_var.bin`);
        const mobys = this.subLevelID === undefined ? parseMobys(varsFile.createDataView()) : [];

        const tileAtlas = buildTileAtlas(new VRAM(vram.copyToBuffer()), textures.createDataView(), this.gameNumber);
        const level = buildLevel(ground.createDataView(), tileAtlas, this.gameNumber, this.subFileID);
        const skybox = buildSkybox(sky.createDataView(), this.gameNumber);
        const renderer = new SpyroRenderer(device, level, skybox, mobys);

        return renderer;
    }
}

const id = "Spyro1";
const name = "Spyro the Dragon";
const sceneDescs = [
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
];

const id3 = "Spyro3";
const name3 = "Spyro: Year of the Dragon";
const sceneDescs3 = [
    "Sunrise Spring",
    new SpyroScene3(98, "Sunrise Spring Home"),
    new SpyroScene3(100, "Sunny Villa"),
    new SpyroScene3(100, "Sunny Villa (Sheila)", 2),
    new SpyroScene3(100, "Sunny Villa (Skate)", 3),
    new SpyroScene3(102, "Cloud Spires"),
    new SpyroScene3(102, "Cloud Spires (Sublevel 1)", 2),
    new SpyroScene3(102, "Cloud Spires (Sublevel 2)", 3),
    new SpyroScene3(104, "Molten Crater"),
    new SpyroScene3(104, "Molten Crater (Sgt. Byrd)", 2),
    new SpyroScene3(104, "Molten Crater (Sublevel)", 3),
    new SpyroScene3(106, "Seashell Shore"),
    new SpyroScene3(106, "Seashell Shore (Sheila)", 2),
    new SpyroScene3(106, "Seashell Shore (Sublevel 1)", 3),
    new SpyroScene3(106, "Seashell Shore (Sublevel 2)", 4),
    new SpyroScene3(108, "Mushroom Speedway"),
    new SpyroScene3(110, "Sheila's Alp"),
    new SpyroScene3(112, "Buzz's Dungeon"),
    new SpyroScene3(114, "Crawdad Farm"),
    "Midday Gardens",
    new SpyroScene3(116, "Midday Gardens Home"),
    new SpyroScene3(118, "Icy Peak"),
    new SpyroScene3(118, "Icy Peak (Sublevel 1)", 2),
    new SpyroScene3(118, "Icy Peak (Sublevel 2)", 3),
    new SpyroScene3(120, "Enchanted Towers"),
    new SpyroScene3(120, "Enchanted Towers (Skate)", 2),
    new SpyroScene3(120, "Enchanted Towers (Sublevel)", 3),
    new SpyroScene3(122, "Spooky Swamp"),
    new SpyroScene3(122, "Spooky Swamp (Sheila)", 3),
    new SpyroScene3(122, "Spooky Swamp (Sublevel)", 2),
    new SpyroScene3(124, "Bamboo Terrace"),
    new SpyroScene3(124, "Bamboo Terrace (Bentley)", 3),
    new SpyroScene3(124, "Bamboo Terrace (Sublevel)", 2),
    new SpyroScene3(126, "Country Speedway"),
    new SpyroScene3(128, "Sgt. Byrd's Base"),
    new SpyroScene3(130, "Spike's Arena"),
    new SpyroScene3(132, "Spider Town"),
    "Evening Lake",
    new SpyroScene3(134, "Evening Lake Home"),
    new SpyroScene3(136, "Frozen Altars"),
    new SpyroScene3(136, "Frozen Altars (Bentley)", 2),
    new SpyroScene3(136, "Frozen Altars (Sublevel)", 3),
    new SpyroScene3(138, "Lost Fleet"),
    new SpyroScene3(138, "Lost Fleet (Sublevel)", 2),
    new SpyroScene3(138, "Lost Fleet (Skate)", 3),
    new SpyroScene3(140, "Fireworks Factory"),
    new SpyroScene3(140, "Fireworks Factory (Agent 9)", 3),
    new SpyroScene3(140, "Fireworks Factory (Sublevel 1)", 2),
    new SpyroScene3(140, "Fireworks Factory (Sublevel 2)", 4),
    new SpyroScene3(142, "Charmed Ridge"),
    new SpyroScene3(142, "Charmed Ridge (Sgt. Byrd)", 2),
    new SpyroScene3(142, "Charmed Ridge (Sublevel)", 3),
    new SpyroScene3(144, "Honey Speedway"),
    new SpyroScene3(146, "Bentley's Outpost"),
    new SpyroScene3(148, "Scorch's Pit"),
    new SpyroScene3(150, "Starfish Reef"),
    "Midnight Mountain",
    new SpyroScene3(152, "Midnight Mountain Home"),
    new SpyroScene3(154, "Crystal Islands"),
    new SpyroScene3(154, "Crystal Islands (Bentley)", 3),
    new SpyroScene3(154, "Crystal Islands (Sublevel)", 2),
    new SpyroScene3(156, "Desert Ruins"),
    new SpyroScene3(156, "Desert Ruins (Sheila)", 2),
    new SpyroScene3(156, "Desert Ruins (Sublevel)", 3),
    new SpyroScene3(158, "Haunted Tomb"),
    new SpyroScene3(158, "Haunted Tomb (Agent 9)", 3),
    new SpyroScene3(158, "Haunted Tomb (Sublevel)", 2),
    new SpyroScene3(160, "Dino Mines"),
    new SpyroScene3(160, "Dino Mines (Agent 9)", 4),
    new SpyroScene3(160, "Dino Mines (Sublevel 1)", 2),
    new SpyroScene3(160, "Dino Mines (Sublevel 2)", 3),
    new SpyroScene3(162, "Harbor Speedway"),
    new SpyroScene3(164, "Agent 9's Lab"),
    new SpyroScene3(166, "Sorceress's Lair"),
    new SpyroScene3(168, "Bugbot Factory"),
    new SpyroScene3(170, "Super Bonus Round"),
    new SpyroScene3(170, "Super Bonus Round (Sublevel 1)", 2),
    new SpyroScene3(170, "Super Bonus Round (Sublevel 2)", 3),
    new SpyroScene3(170, "Super Bonus Round (Sublevel 3)", 4),
    "Cutscenes",
    new SpyroScene3(7, "Cutscene"),
    new SpyroScene3(10, "Cutscene"),
    new SpyroScene3(13, "Cutscene"),
    new SpyroScene3(16, "Cutscene"),
    new SpyroScene3(19, "Cutscene"),
    new SpyroScene3(22, "Cutscene"),
    new SpyroScene3(25, "Cutscene"),
    new SpyroScene3(28, "Cutscene"),
    new SpyroScene3(31, "Cutscene"),
    new SpyroScene3(34, "Cutscene"),
    new SpyroScene3(37, "Cutscene"),
    new SpyroScene3(40, "Cutscene"),
    // new SpyroScene3(43, "Cutscene"), // this subfile index has a size of zero in the WAD (cut cutscene?)
    new SpyroScene3(46, "Cutscene"),
    new SpyroScene3(49, "Cutscene"),
    new SpyroScene3(52, "Cutscene"),
    new SpyroScene3(55, "Cutscene"),
    new SpyroScene3(58, "Cutscene"),
    new SpyroScene3(61, "Cutscene"),
    new SpyroScene3(64, "Cutscene"),
    new SpyroScene3(67, "Cutscene")
];

export const sceneGroup: SceneGroup = {id: id, name: name, sceneDescs: sceneDescs};
export const sceneGroup2: SceneGroup = {id: id2, name: name2, sceneDescs: sceneDescs2};
export const sceneGroup3: SceneGroup = {id: id3, name: name3, sceneDescs: sceneDescs3};
