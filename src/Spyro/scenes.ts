import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, Texture, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { parseTextures, buildLevel, buildSkybox, Skybox, Level, parseMobyInstances, MobyInstance, parseLevelData, parseLevelData2 } from "./bin.js"
import { LevelRenderer, SkyboxRenderer, convertToViewerTexture } from "./render.js"
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { Checkbox, COOL_BLUE_COLOR, Panel, RENDER_HACKS_ICON } from "../ui.js";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder.js";

/*
TODO

    Better water rendering, although it's mostly accurate
    Clean up functions in bin.ts
        Any computer made in the last century should be fine, but there's plenty of room for better efficiency
    Add back "starring" levels (credits flyover versions of regular levels) to S2/S3
        There's a problem with extracting their skyboxes so they're not included
    Clean up the transparency handling. Transparent tiles/water can sometimes disappear behind other ones
        This is an issue with draw order. Not really a big deal until/if mobys get added to levels that have transparency

    Spyro 1
        Transparency masking (see edges by the "water" in Gnasty's Loot, Icy Flight or Twilight Harbor)
            Can't tell how these work, the tile index of the polygons doesn't match what's being rendered
        
    Spyro 2
        Mystic Marsh and Shady Oasis have annoying z-scaling that requires special handling in buildLevel
            This may not be an issue, just something worth investigating to see if the polygon parsing needs to be more robust
            These levels also don't have LOD versions for some reason (may be related)

    Spyro 3
        Mushroom Speedway's mushrooms should have transparent parts but they aren't marked as transparent (at least in the same way as water)
        Sublevels should extract their own skybox, not default to the parent level

Nice to have

    Mobys (gems, NPCs, enemies, etc.)
        Only their per-level instances (position and type) in S3 are implemented
        Will require a lot of work to figure out how their models are encoded, different for each game
    Remove hardcoded tile scrolling and read dynamically from level data (tile indices and speed)
    Misc level effects, such as vertex color "shimmering" under water sections in S2/S3 and lava movement
    Back-face culling toggle. Winding order is (seemingly) not consistent in the game, so this would require a lot of work
    Figure out a way to correctly render LOD and MDL polys at the same time without overlap
        This is not easy since parts will contain both types of polys. Parts with only LOD polys don't connect to the rest of the geometry
*/

class SpyroRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: LevelRenderer;
    private skyboxRenderer: SkyboxRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: Level, skybox: Skybox, public textureHolder: TextureHolder, private mobys?: MobyInstance[]) {
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
        panel.setTitle(RENDER_HACKS_ICON, "Render Hacks");
        const toggleLOD = new Checkbox("Toggle LOD", false);
        toggleLOD.onchanged = () => {
            this.levelRenderer.showLOD = toggleLOD.checked
        };
        panel.contents.appendChild(toggleLOD.elem);
        const toggleTextures = new Checkbox("Enable textures", true);
        toggleTextures.onchanged = () => {
            this.levelRenderer.showTextures = toggleTextures.checked
        };
        panel.contents.appendChild(toggleTextures.elem);
        if (this.mobys === undefined)
            return [panel];
        const showMobysCheckbox = new Checkbox("Show moby positions (debug)", false);
        showMobysCheckbox.onchanged = () => {
            this.levelRenderer.showMobys = showMobysCheckbox.checked
        };
        panel.contents.appendChild(showMobysCheckbox.elem);
        return [panel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
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
        const levelFile = await context.dataFetcher.fetchData(`${pathBase}/sf${this.subFileID}.bin`);
        const { vram, textureList, ground, sky } = parseLevelData(levelFile);
        const textures = parseTextures(vram, textureList.createDataView(), this.gameNumber);
        const level = buildLevel(ground.createDataView(), textures, this.gameNumber, this.subFileID);
        const skybox = buildSkybox(sky.createDataView(), this.gameNumber);
        const viewerTextures: Texture[] = [];
        for (let i = 0; i < textures.tiles.length; i++) {
            const rgba = textures.colors[i];
            viewerTextures.push(convertToViewerTexture(i, rgba));
        }
        const textureHolder = new FakeTextureHolder(viewerTextures);
        return new SpyroRenderer(device, level, skybox, textureHolder);
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
        const levelFile = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subFileID}.bin`);
        const { vram, textureList, ground, sky } = parseLevelData2(levelFile);
        vram.applyFontStripFix();
        const textures = parseTextures(vram, textureList.createDataView(), this.gameNumber);
        const level = buildLevel(ground.createDataView(), textures, this.gameNumber, this.subFileID);
        const skybox = buildSkybox(sky.createDataView(), this.gameNumber);
        const viewerTextures: Texture[] = [];
        for (let i = 0; i < textures.tiles.length; i++) {
            const rgba = textures.colors[i];
            viewerTextures.push(convertToViewerTexture(i, rgba));
        }
        const textureHolder = new FakeTextureHolder(viewerTextures);
        return new SpyroRenderer(device, level, skybox, textureHolder);
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
        const levelFile = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subFileID}.bin`);
        const { vram, textureList, ground: g, grounds, sky, subfile4 } = parseLevelData2(levelFile, this.gameNumber);
        const mobys = (this.subLevelID === undefined && subfile4) ? parseMobyInstances(subfile4.createDataView()) : [];
        let ground = g;
        if (this.subLevelID && grounds && grounds.length > 0) {
            ground = grounds[this.subLevelID - 1];
        }
        const textures = parseTextures(vram, textureList.createDataView(), this.gameNumber);
        const level = buildLevel(ground.createDataView(), textures, this.gameNumber, this.subFileID);
        const skybox = buildSkybox(sky.createDataView(), this.gameNumber);
        const viewerTextures: Texture[] = [];
        for (let i = 0; i < textures.tiles.length; i++) {
            const rgba = textures.colors[i];
            viewerTextures.push(convertToViewerTexture(i, rgba));
        }
        const textureHolder = new FakeTextureHolder(viewerTextures);
        return new SpyroRenderer(device, level, skybox, textureHolder, mobys);
    }
}

const id = "Spyro1";
const name = "Spyro the Dragon";
const sceneDescs = [
    "Artisans",
    new SpyroScene(11, "Artisans"),
    new SpyroScene(13, "Stone Hill"),
    new SpyroScene(15, "Dark Hollow"),
    new SpyroScene(17, "Town Square"),
    new SpyroScene(21, "Sunny Flight"),
    new SpyroScene(19, "Toasty"),
    "Peace Keepers",
    new SpyroScene(23, "Peace Keepers"),
    new SpyroScene(25, "Dry Canyon"),
    new SpyroScene(27, "Cliff Town"),
    new SpyroScene(29, "Ice Cavern"),
    new SpyroScene(33, "Night Flight"),
    new SpyroScene(31, "Doctor Shemp"),
    "Magic Crafters",
    new SpyroScene(35, "Magic Crafters"),
    new SpyroScene(37, "Alpine Ridge"),
    new SpyroScene(39, "High Caves"),
    new SpyroScene(41, "Wizard Peak"),
    new SpyroScene(45, "Crystal Flight"),
    new SpyroScene(43, "Blowhard"),
    "Beast Makers",
    new SpyroScene(47, "Beast Makers"),
    new SpyroScene(49, "Terrace Village"),
    new SpyroScene(51, "Misty Bog"),
    new SpyroScene(53, "Tree Tops"),
    new SpyroScene(57, "Wild Flight"),
    new SpyroScene(55, "Metalhead"),
    "Dream Weavers",
    new SpyroScene(59, "Dream Weavers"),
    new SpyroScene(61, "Dark Passage"),
    new SpyroScene(63, "Lofty Castle"),
    new SpyroScene(65, "Haunted Towers"),
    new SpyroScene(69, "Icy Flight"),
    new SpyroScene(67, "Jacques"),
    "Gnorc Gnexus",
    new SpyroScene(71, "Gnorc Gnexus"),
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
    new SpyroScene(83, "Artisans (Flyover)"),
    new SpyroScene(84, "Stone Hill (Flyover)"),
    new SpyroScene(85, "Town Square (Flyover)"),
    new SpyroScene(92, "Toasty (Flyover)"),
    new SpyroScene(86, "Peace Keepers (Flyover)"),
    new SpyroScene(87, "Cliff Town (Flyover)"),
    new SpyroScene(88, "Doctor Shemp (Flyover)"),
    new SpyroScene(89, "Magic Crafters (Flyover)"),
    new SpyroScene(90, "High Caves (Flyover)"),
    new SpyroScene(91, "Wizard Peak (Flyover)"),
    new SpyroScene(93, "Terrace Village (Flyover)"),
    new SpyroScene(97, "Wild Flight (Flyover)"),
    new SpyroScene(94, "Metalhead (Flyover)"),
    new SpyroScene(95, "Dark Passage (Flyover)"),
    new SpyroScene(96, "Haunted Towers (Flyover)"),
    new SpyroScene(99, "Icy Flight (Flyover)"),
    new SpyroScene(102, "Jacques (Flyover)"),
    new SpyroScene(98, "Gnorc Cove (Flyover)"),
    new SpyroScene(101, "Twilight Harbor (Flyover)"),
    new SpyroScene(100, "Gnasty Gnorc (Flyover)")
];

const id2 = "Spyro2";
const name2 = "Spyro 2: Ripto's Rage!";
const sceneDescs2 = [
    "Summer Forest",
    new SpyroScene2(16, "Summer Forest"),
    new SpyroScene2(18, "Glimmer"),
    new SpyroScene2(20, "Idol Springs"),
    new SpyroScene2(22, "Colossus"),
    new SpyroScene2(24, "Hurricos"),
    new SpyroScene2(28, "Sunny Beach"),
    new SpyroScene2(26, "Aquaria Towers"),
    new SpyroScene2(30, "Ocean Speedway"),
    new SpyroScene2(32, "Crush's Dungeon"),
    "Autumn Plains",
    new SpyroScene2(34, "Autumn Plains"),
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
    new SpyroScene2(58, "Winter Tundra"),
    new SpyroScene2(62, "Cloud Temples"),
    new SpyroScene2(60, "Mystic Marsh"),
    new SpyroScene2(66, "Robotica Farms"),
    new SpyroScene2(68, "Metropolis"),
    new SpyroScene2(64, "Canyon Speedway"),
    new SpyroScene2(72, "Ripto's Arena"),
    new SpyroScene2(70, "Dragon Shores"),
    "Cutscenes",
    new SpyroScene2(96, "Title Screen"),
    new SpyroScene2(74, "We Need a Vacation"),
    new SpyroScene2(76, "I've got a Dragon"),
    new SpyroScene2(78, "I'm a Faun you Dork!"),
    new SpyroScene2(80, "No Dragons? Wonderful!"),
    new SpyroScene2(82, "Bring it on Shorty!"),
    new SpyroScene2(84, "Boo!"),
    new SpyroScene2(86, "Gulp, Lunchtime!"),
    new SpyroScene2(88, "Spyro you did it!"),
    new SpyroScene2(90, "You Little Fools!"),
    new SpyroScene2(92, "What?! YOU AGAIN!"),
    new SpyroScene2(94, "Come on Sparx!")
];

const id3 = "Spyro3";
const name3 = "Spyro: Year of the Dragon";
const sceneDescs3 = [
    "Sunrise Spring",
    new SpyroScene3(98, "Sunrise Spring"),
    new SpyroScene3(100, "Sunny Villa"),
    new SpyroScene3(100, "Sunny Villa (Sheila)", 1),
    new SpyroScene3(100, "Sunny Villa (Skate)", 2),
    new SpyroScene3(102, "Cloud Spires"),
    new SpyroScene3(102, "Cloud Spires (Sublevel 1)", 1),
    new SpyroScene3(102, "Cloud Spires (Sublevel 2)", 2),
    new SpyroScene3(104, "Molten Crater"),
    new SpyroScene3(104, "Molten Crater (Sgt. Byrd)", 1),
    new SpyroScene3(104, "Molten Crater (Sublevel)", 2),
    new SpyroScene3(106, "Seashell Shore"),
    new SpyroScene3(106, "Seashell Shore (Sheila)", 1),
    new SpyroScene3(106, "Seashell Shore (Sublevel 1)", 2),
    new SpyroScene3(106, "Seashell Shore (Sublevel 2)", 3),
    new SpyroScene3(108, "Mushroom Speedway"),
    new SpyroScene3(110, "Sheila's Alp"),
    new SpyroScene3(112, "Buzz's Dungeon"),
    new SpyroScene3(114, "Crawdad Farm"),
    "Midday Gardens",
    new SpyroScene3(116, "Midday Gardens"),
    new SpyroScene3(118, "Icy Peak"),
    new SpyroScene3(118, "Icy Peak (Sublevel 1)", 1),
    new SpyroScene3(118, "Icy Peak (Sublevel 2)", 2),
    new SpyroScene3(120, "Enchanted Towers"),
    new SpyroScene3(120, "Enchanted Towers (Skate)", 1),
    new SpyroScene3(120, "Enchanted Towers (Sublevel)", 2),
    new SpyroScene3(122, "Spooky Swamp"),
    new SpyroScene3(122, "Spooky Swamp (Sheila)", 2),
    new SpyroScene3(122, "Spooky Swamp (Sublevel)", 1),
    new SpyroScene3(124, "Bamboo Terrace"),
    new SpyroScene3(124, "Bamboo Terrace (Bentley)", 2),
    new SpyroScene3(124, "Bamboo Terrace (Sublevel)", 1),
    new SpyroScene3(126, "Country Speedway"),
    new SpyroScene3(128, "Sgt. Byrd's Base"),
    new SpyroScene3(130, "Spike's Arena"),
    new SpyroScene3(132, "Spider Town"),
    "Evening Lake",
    new SpyroScene3(134, "Evening Lake"),
    new SpyroScene3(136, "Frozen Altars"),
    new SpyroScene3(136, "Frozen Altars (Bentley)", 1),
    new SpyroScene3(136, "Frozen Altars (Sublevel)", 2),
    new SpyroScene3(138, "Lost Fleet"),
    new SpyroScene3(138, "Lost Fleet (Sublevel)", 1),
    new SpyroScene3(138, "Lost Fleet (Skate)", 2),
    new SpyroScene3(140, "Fireworks Factory"),
    new SpyroScene3(140, "Fireworks Factory (Agent 9)", 2),
    new SpyroScene3(140, "Fireworks Factory (Sublevel 1)", 1),
    new SpyroScene3(140, "Fireworks Factory (Sublevel 2)", 3),
    new SpyroScene3(142, "Charmed Ridge"),
    new SpyroScene3(142, "Charmed Ridge (Sgt. Byrd)", 1),
    new SpyroScene3(142, "Charmed Ridge (Sublevel)", 2),
    new SpyroScene3(144, "Honey Speedway"),
    new SpyroScene3(146, "Bentley's Outpost"),
    new SpyroScene3(148, "Scorch's Pit"),
    new SpyroScene3(150, "Starfish Reef"),
    "Midnight Mountain",
    new SpyroScene3(152, "Midnight Mountain"),
    new SpyroScene3(154, "Crystal Islands"),
    new SpyroScene3(154, "Crystal Islands (Bentley)", 2),
    new SpyroScene3(154, "Crystal Islands (Sublevel)", 1),
    new SpyroScene3(156, "Desert Ruins"),
    new SpyroScene3(156, "Desert Ruins (Sheila)", 1),
    new SpyroScene3(156, "Desert Ruins (Sublevel)", 2),
    new SpyroScene3(158, "Haunted Tomb"),
    new SpyroScene3(158, "Haunted Tomb (Agent 9)", 2),
    new SpyroScene3(158, "Haunted Tomb (Sublevel)", 1),
    new SpyroScene3(160, "Dino Mines"),
    new SpyroScene3(160, "Dino Mines (Agent 9)", 3),
    new SpyroScene3(160, "Dino Mines (Sublevel)", 2),
    new SpyroScene3(160, "Dino Mines (Unused Sublevel)", 1),
    new SpyroScene3(162, "Harbor Speedway"),
    new SpyroScene3(164, "Agent 9's Lab"),
    new SpyroScene3(166, "Sorceress's Lair"),
    new SpyroScene3(168, "Bugbot Factory"),
    new SpyroScene3(170, "Super Bonus Round"),
    new SpyroScene3(170, "Super Bonus Round (Sublevel 1)", 1),
    new SpyroScene3(170, "Super Bonus Round (Sublevel 2)", 2),
    new SpyroScene3(170, "Super Bonus Round (Sublevel 3)", 3),
    "Cutscenes",
    new SpyroScene3(7, "Title Screen"),
    new SpyroScene3(10, "An Evil Plot Unfolds..."),
    new SpyroScene3(52, "A Powerful Villain Emerges..."),
    new SpyroScene3(55, "A Desperate Rescue Begins..."),
    new SpyroScene3(58, "No Hard Feelings"),
    new SpyroScene3(13, "The Second Warning"),
    new SpyroScene3(22, "Bianca Strikes Back"),
    new SpyroScene3(61, "Byrd, James Byrd"),
    new SpyroScene3(19, "Hunter's Tussle"),
    new SpyroScene3(28, "Spike Is Born"),
    new SpyroScene3(64, "A Duplicitous, Larcenous Ursine"),
    new SpyroScene3(25, "An Apology, And Lunch"),
    new SpyroScene3(16, "A Monster To End All Monsters"),
    new SpyroScene3(31, "The Escape!"),
    new SpyroScene3(67, "The Dancing Bear"),
    new SpyroScene3(34, "Deja Vu?"),
    new SpyroScene3(37, "A Familiar Face"),
    new SpyroScene3(40, "Billy In The Wall"),
    new SpyroScene3(46, "One Less Noble Warrior"),
    new SpyroScene3(49, "THE END")
];

export const sceneGroup: SceneGroup = { id: id, name: name, sceneDescs: sceneDescs };
export const sceneGroup2: SceneGroup = { id: id2, name: name2, sceneDescs: sceneDescs2 };
export const sceneGroup3: SceneGroup = { id: id3, name: name3, sceneDescs: sceneDescs3 };
