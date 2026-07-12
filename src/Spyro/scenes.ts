import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { parseSpyroTextures, buildSpyroLevel, buildSpyroSkybox, SpyroSkybox, SpyroLevel, parseSpyroMobyInstances, SpyroMobyInstance, parseSpyroLevelData, parseSpyroLevelData2 } from "./bin.js"
import { SpyroLevelRenderer, SpyroSkyboxRenderer } from "./render.js"
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { Checkbox, COOL_BLUE_COLOR, Panel, RENDER_HACKS_ICON } from "../ui.js";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder.js";
import { CameraController } from "../Camera.js";

/*
TODO

Re-write rendering setup and binary parsing
    Parsing will be re-done (it's a mess right now) after I make a comprehensive doc of the subfile sections
Some moby instances aren't detected for regular levels when they should be
More thoroughly check texture rotation permutations, SWV has some of them wrong. Annoying to check since they're so rare
Fix or redo water detection. There's some false positives, see the ice in S3 Icy Peak for an example
    Also a few other small issues with water rendering, but it's close enough for now

Spyro 1
    Figure out edges of "water" in Gnasty's Loot, Icy Flight or Twilight Harbor

Spyro 3
    Mushroom Speedway's mushrooms should have transparent parts but they aren't marked as transparent
    Figure out how some sublevels' textures have their COR versions loaded into VRAM
        Apparently COR textures that only appear in sublevels (as opposed to both itself and the parent level)
        won't have their data loaded into VRAM until you actually go into the sublevel itself. The tile headers
        are correctly parsed, so it's not an issue with parsing or other texture logic. For now, the workaround
        is to just use only their lower-resolution versions. I can only assume that somewhere in either of the
        sublevel's sub-subfiles, there's additional VRAM data. It's loaded in the lower left section of the right half
        when viewing the VRAM in an emulator (enter/leave the manta ray sublevel in desert ruins for an obvious example with
        the water surface texture). The level files aren't big enough to have multiple copies of the entire image VRAM,
        so it's not a complete overwrite

Nice to have

Mobys (gems, NPCs, enemies, etc.)
    Only their per-level instances are implemented (position and type)
Remove hardcoded tile scrolling and read from level data (tile indices and speed)
Look into removing the hardcoded water animation and read from level data (if it's even there, it might not be)
Misc level effects, such as vertex color "shimmering" under water sections in S2/S3 and lava movement
Optional weather effects, such as the snow falling in S3 Super Bonus Round
Back-face culling. Winding order is not consistent so this may not be feasilble
Figure out a way to correctly render LOD and MDL polys at the same time without overlap
    This is not easy since parts will contain both types of polys. Parts with only LOD polys don't connect to the rest of the geometry
Have an option to visualize the collision data, since that's (supposedly) separate from the visible geometry
*/

class Renderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private levelRenderer: SpyroLevelRenderer;
    private skyboxRenderer: SpyroSkyboxRenderer;
    private clearColor: number[];

    constructor(device: GfxDevice, level: SpyroLevel, skybox: SpyroSkybox, private mobyInstances: SpyroMobyInstance[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.levelRenderer = new SpyroLevelRenderer(this.renderHelper.renderCache, level, this.mobyInstances);
        this.skyboxRenderer = new SpyroSkyboxRenderer(this.renderHelper.renderCache, skybox);
        this.clearColor = skybox.backgroundColor.map(c => c / 255);
        const viewerTextures = [];
        for (const t of this.levelRenderer.gfxTextures) {
            viewerTextures.push({ gfxTexture: t });
        }
        this.textureHolder = new FakeTextureHolder(viewerTextures);
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
        if (this.levelRenderer.showMobys) {
            this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        }
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public createPanels(): Panel[] {
        const panel = new Panel();
        panel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        panel.setTitle(RENDER_HACKS_ICON, "Render Hacks");
        const toggleLOD = new Checkbox("Use LOD polygons", false);
        toggleLOD.onchanged = () => {
            this.levelRenderer.useLOD = toggleLOD.checked
        };
        panel.contents.appendChild(toggleLOD.elem);
        const toggleTextures = new Checkbox("Enable textures", true);
        toggleTextures.onchanged = () => {
            this.levelRenderer.showTextures = toggleTextures.checked
        };
        panel.contents.appendChild(toggleTextures.elem);
        if (this.mobyInstances.length === 0) {
            return [panel];
        }
        const showMobysCheckbox = new Checkbox("Show moby positions (debug)", false);
        showMobysCheckbox.onchanged = () => {
            this.levelRenderer.showMobys = showMobysCheckbox.checked
        };
        panel.contents.appendChild(showMobysCheckbox.elem);
        return [panel];
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8 / 60);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
        this.skyboxRenderer.destroy(device);
        this.levelRenderer.destroy(device);
    }
}

const pathBase = "Spyro1";
class S1Level implements SceneDesc {
    public id: string;
    private gameNumber: number;

    constructor(public subfileID: number, public name: string) {
        this.id = subfileID.toString();
        this.gameNumber = 1;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const levelFile = await context.dataFetcher.fetchData(`${pathBase}/sf${this.subfileID}.bin`);
        const { vram, textureList, ground, sky, subfile4 } = parseSpyroLevelData(levelFile);
        const mobys = subfile4 ? parseSpyroMobyInstances(subfile4.createDataView(), this.gameNumber) : [];
        const textures = parseSpyroTextures(vram, textureList.createDataView(), this.gameNumber);
        const level = buildSpyroLevel(ground.createDataView(), textures, this.gameNumber, this.subfileID);
        const skybox = buildSpyroSkybox(sky.createDataView(), this.gameNumber);
        return new Renderer(device, level, skybox, mobys);
    }
}

const pathBase2 = "Spyro2";
class S2Level implements SceneDesc {
    public id: string;
    private gameNumber: number;

    constructor(public subfileID: number, public name: string) {
        this.id = subfileID.toString();
        this.gameNumber = 2;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const levelFile = await context.dataFetcher.fetchData(`${pathBase2}/sf${this.subfileID}.bin`);
        const { vram, textureList, ground, sky, subfile4 } = parseSpyroLevelData2(levelFile, this.gameNumber, this.subfileID >= 188);
        vram.applyFontStripFix();
        const mobys = subfile4 ? parseSpyroMobyInstances(subfile4.createDataView(), this.gameNumber) : [];
        const textures = parseSpyroTextures(vram, textureList.createDataView(), this.gameNumber);
        const level = buildSpyroLevel(ground.createDataView(), textures, this.gameNumber, this.subfileID);
        const skybox = buildSpyroSkybox(sky.createDataView(), this.gameNumber);
        return new Renderer(device, level, skybox, mobys);
    }
}

const pathBase3 = "Spyro3";
class S3Level implements SceneDesc {
    public id: string;
    private gameNumber: number;

    constructor(public subfileID: number, public name: string, private sublevelID?: number) {
        this.id = subfileID.toString();
        if (this.sublevelID !== undefined) {
            this.id = `${subfileID}_${sublevelID}`;
        }
        this.gameNumber = 3;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const levelFile = await context.dataFetcher.fetchData(`${pathBase3}/sf${this.subfileID}.bin`);
        const { vram, textureList, ground: g, grounds, sky: s, skys, subfile4 } = parseSpyroLevelData2(levelFile, this.gameNumber, this.subfileID >= 184);
        const mobys = (this.sublevelID === undefined && subfile4) ? parseSpyroMobyInstances(subfile4.createDataView(), this.gameNumber) : [];
        let ground = g;
        if (this.sublevelID && grounds && grounds.length > 0) {
            ground = grounds[this.sublevelID - 1];
        }
        let sky = s;
        if (this.sublevelID && skys && skys.length > 0) {
            sky = skys[this.sublevelID - 1];
        }
        const textures = parseSpyroTextures(vram, textureList.createDataView(), this.gameNumber, this.subfileID);
        const level = buildSpyroLevel(ground.createDataView(), textures, this.gameNumber, this.subfileID);
        const skybox = buildSpyroSkybox(sky.createDataView(), this.gameNumber);
        return new Renderer(device, level, skybox, mobys);
    }
}

// all subfile/level ids are 1-based from the NSTC versions and v1.1 of Spyro 3
const id = "Spyro1";
const id2 = "Spyro2";
const id3 = "Spyro3";
const name = "Spyro the Dragon";
const name2 = "Spyro 2: Ripto's Rage!";
const name3 = "Spyro: Year of the Dragon";
const sceneDescs = [
    "Artisans",
    new S1Level(11, "Artisans"),
    new S1Level(13, "Stone Hill"),
    new S1Level(15, "Dark Hollow"),
    new S1Level(17, "Town Square"),
    new S1Level(21, "Sunny Flight"),
    new S1Level(19, "Toasty"),
    "Peace Keepers",
    new S1Level(23, "Peace Keepers"),
    new S1Level(25, "Dry Canyon"),
    new S1Level(27, "Cliff Town"),
    new S1Level(29, "Ice Cavern"),
    new S1Level(33, "Night Flight"),
    new S1Level(31, "Doctor Shemp"),
    "Magic Crafters",
    new S1Level(35, "Magic Crafters"),
    new S1Level(37, "Alpine Ridge"),
    new S1Level(39, "High Caves"),
    new S1Level(41, "Wizard Peak"),
    new S1Level(45, "Crystal Flight"),
    new S1Level(43, "Blowhard"),
    "Beast Makers",
    new S1Level(47, "Beast Makers"),
    new S1Level(49, "Terrace Village"),
    new S1Level(51, "Misty Bog"),
    new S1Level(53, "Tree Tops"),
    new S1Level(57, "Wild Flight"),
    new S1Level(55, "Metalhead"),
    "Dream Weavers",
    new S1Level(59, "Dream Weavers"),
    new S1Level(61, "Dark Passage"),
    new S1Level(63, "Lofty Castle"),
    new S1Level(65, "Haunted Towers"),
    new S1Level(69, "Icy Flight"),
    new S1Level(67, "Jacques"),
    "Gnorc Gnexus",
    new S1Level(71, "Gnorc Gnexus"),
    new S1Level(73, "Gnorc Cove"),
    new S1Level(75, "Twilight Harbor"),
    new S1Level(77, "Gnasty Gnorc"),
    new S1Level(79, "Gnasty's Loot"),
    "Cutscenes",
    new S1Level(4, "Title Screen"),
    new S1Level(5, "Introduction"),
    new S1Level(6, "Ending"),
    new S1Level(7, "Ending (Full Completion)"),
    "Credits Flyover",
    new S1Level(83, "Artisans"),
    new S1Level(84, "Stone Hill"),
    new S1Level(85, "Town Square"),
    new S1Level(92, "Toasty"),
    new S1Level(86, "Peace Keepers"),
    new S1Level(87, "Cliff Town"),
    new S1Level(88, "Doctor Shemp"),
    new S1Level(89, "Magic Crafters"),
    new S1Level(90, "High Caves"),
    new S1Level(91, "Wizard Peak"),
    new S1Level(93, "Terrace Village"),
    new S1Level(97, "Wild Flight"),
    new S1Level(94, "Metalhead"),
    new S1Level(95, "Dark Passage"),
    new S1Level(96, "Haunted Towers"),
    new S1Level(99, "Icy Flight"),
    new S1Level(102, "Jacques"),
    new S1Level(98, "Gnorc Cove"),
    new S1Level(101, "Twilight Harbor"),
    new S1Level(100, "Gnasty Gnorc")
];
const sceneDescs2 = [
    "Summer Forest",
    new S2Level(16, "Summer Forest"),
    new S2Level(18, "Glimmer"),
    new S2Level(20, "Idol Springs"),
    new S2Level(22, "Colossus"),
    new S2Level(24, "Hurricos"),
    new S2Level(28, "Sunny Beach"),
    new S2Level(26, "Aquaria Towers"),
    new S2Level(30, "Ocean Speedway"),
    new S2Level(32, "Crush's Dungeon"),
    "Autumn Plains",
    new S2Level(34, "Autumn Plains"),
    new S2Level(36, "Skelos Badlands"),
    new S2Level(38, "Crystal Glacier"),
    new S2Level(40, "Breeze Harbor"),
    new S2Level(42, "Zephyr"),
    new S2Level(46, "Scorch"),
    new S2Level(52, "Fracture Hills"),
    new S2Level(50, "Magma Cone"),
    new S2Level(48, "Shady Oasis"),
    new S2Level(44, "Metro Speedway"),
    new S2Level(54, "Icy Speedway"),
    new S2Level(56, "Gulp's Overlook"),
    "Winter Tundra",
    new S2Level(58, "Winter Tundra"),
    new S2Level(62, "Cloud Temples"),
    new S2Level(60, "Mystic Marsh"),
    new S2Level(66, "Robotica Farms"),
    new S2Level(68, "Metropolis"),
    new S2Level(64, "Canyon Speedway"),
    new S2Level(72, "Ripto's Arena"),
    new S2Level(70, "Dragon Shores"),
    "Cutscenes",
    new S2Level(96, "Title Screen"),
    new S2Level(74, "We Need a Vacation"),
    new S2Level(76, "I've got a Dragon"),
    new S2Level(78, "I'm a Faun you Dork!"),
    new S2Level(80, "No Dragons? Wonderful!"),
    new S2Level(82, "Bring it on Shorty!"),
    new S2Level(84, "Boo!"),
    new S2Level(86, "Gulp, Lunchtime!"),
    new S2Level(88, "Spyro you did it!"),
    new S2Level(90, "You Little Fools!"),
    new S2Level(92, "What?! YOU AGAIN!"),
    new S2Level(94, "Come on Sparx!"),
    "Credits Flyover",
    new S2Level(188, "Summer Forest"),
    new S2Level(189, "Glimmer"),
    new S2Level(190, "Idol Springs"),
    new S2Level(191, "Colossus"),
    new S2Level(192, "Aquaria Towers"),
    new S2Level(193, "Sunny Beach"),
    new S2Level(194, "Skelos Badlands"),
    new S2Level(195, "Scorch"),
    new S2Level(196, "Shady Oasis"),
    new S2Level(197, "Cloud Temples")
];
const sceneDescs3 = [
    "Sunrise Spring",
    new S3Level(98, "Sunrise Spring"),
    new S3Level(100, "Sunny Villa"),
    new S3Level(100, "Sunny Villa (Sheila)", 1),
    new S3Level(100, "Sunny Villa (Skateboarding)", 2),
    new S3Level(102, "Cloud Spires"),
    new S3Level(102, "Cloud Spires (Sublevel 1)", 1),
    new S3Level(102, "Cloud Spires (Sublevel 2)", 2),
    new S3Level(104, "Molten Crater"),
    new S3Level(104, "Molten Crater (Sgt. Byrd)", 1),
    new S3Level(104, "Molten Crater (Thieves)", 2),
    new S3Level(106, "Seashell Shore"),
    new S3Level(106, "Seashell Shore (Sheila)", 1),
    new S3Level(106, "Seashell Shore (Boss)", 2),
    new S3Level(106, "Seashell Shore (Flooded Tunnel)", 3),
    new S3Level(108, "Mushroom Speedway"),
    new S3Level(110, "Sheila's Alp"),
    new S3Level(112, "Buzz's Dungeon"),
    new S3Level(114, "Crawdad Farm"),
    "Midday Gardens",
    new S3Level(116, "Midday Gardens"),
    new S3Level(118, "Icy Peak"),
    new S3Level(118, "Icy Peak (Thieves)", 1),
    new S3Level(118, "Icy Peak (Ice Skating)", 2),
    new S3Level(120, "Enchanted Towers"),
    new S3Level(120, "Enchanted Towers (Skateboarding)", 1),
    new S3Level(120, "Enchanted Towers (Sublevel)", 2),
    new S3Level(122, "Spooky Swamp"),
    new S3Level(122, "Spooky Swamp (Sheila)", 2),
    new S3Level(122, "Spooky Swamp (Boss)", 1),
    new S3Level(124, "Bamboo Terrace"),
    new S3Level(124, "Bamboo Terrace (Bentley)", 2),
    new S3Level(124, "Bamboo Terrace (Sublevel)", 1),
    new S3Level(126, "Country Speedway"),
    new S3Level(128, "Sgt. Byrd's Base"),
    new S3Level(130, "Spike's Arena"),
    new S3Level(132, "Spider Town"),
    "Evening Lake",
    new S3Level(134, "Evening Lake"),
    new S3Level(136, "Frozen Altars"),
    new S3Level(136, "Frozen Altars (Bentley)", 1),
    new S3Level(136, "Frozen Altars (Sublevel)", 2),
    new S3Level(138, "Lost Fleet"),
    new S3Level(138, "Lost Fleet (Submarine)", 1),
    new S3Level(138, "Lost Fleet (Skateboarding)", 2),
    new S3Level(140, "Fireworks Factory"),
    new S3Level(140, "Fireworks Factory (Agent 9)", 2),
    new S3Level(140, "Fireworks Factory (Dragons)", 1),
    new S3Level(140, "Fireworks Factory (Sublevel)", 3),
    new S3Level(142, "Charmed Ridge"),
    new S3Level(142, "Charmed Ridge (Sgt. Byrd)", 1),
    new S3Level(142, "Charmed Ridge (Beanstalk)", 2),
    new S3Level(144, "Honey Speedway"),
    new S3Level(146, "Bentley's Outpost"),
    new S3Level(148, "Scorch's Pit"),
    new S3Level(150, "Starfish Reef"),
    "Midnight Mountain",
    new S3Level(152, "Midnight Mountain"),
    new S3Level(154, "Crystal Islands"),
    new S3Level(154, "Crystal Islands (Bentley)", 2),
    new S3Level(154, "Crystal Islands (Slide)", 1),
    new S3Level(156, "Desert Ruins"),
    new S3Level(156, "Desert Ruins (Sheila)", 1),
    new S3Level(156, "Desert Ruins (Manta Ray)", 2),
    new S3Level(158, "Haunted Tomb"),
    new S3Level(158, "Haunted Tomb (Agent 9)", 2),
    new S3Level(158, "Haunted Tomb (Sublevel)", 1),
    new S3Level(160, "Dino Mines"),
    new S3Level(160, "Dino Mines (Agent 9)", 3),
    new S3Level(160, "Dino Mines (Flooded Tunnel)", 2),
    new S3Level(160, "Dino Mines (Unused Sublevel)", 1),
    new S3Level(162, "Harbor Speedway"),
    new S3Level(164, "Agent 9's Lab"),
    new S3Level(166, "Sorceress's Lair"),
    new S3Level(168, "Bugbot Factory"),
    new S3Level(170, "Super Bonus Round"),
    new S3Level(170, "Super Bonus Round (Submarine)", 1),
    new S3Level(170, "Super Bonus Round (Rocketboarding)", 2),
    new S3Level(170, "Super Bonus Round (Sorceress)", 3),
    "Cutscenes",
    new S3Level(7, "Title Screen"),
    new S3Level(10, "An Evil Plot Unfolds..."),
    new S3Level(52, "A Powerful Villain Emerges..."),
    new S3Level(55, "A Desperate Rescue Begins..."),
    new S3Level(58, "No Hard Feelings"),
    new S3Level(13, "The Second Warning"),
    new S3Level(22, "Bianca Strikes Back"),
    new S3Level(61, "Byrd, James Byrd"),
    new S3Level(19, "Hunter's Tussle"),
    new S3Level(28, "Spike Is Born"),
    new S3Level(64, "A Duplicitous, Larcenous Ursine"),
    new S3Level(25, "An Apology, And Lunch"),
    new S3Level(16, "A Monster To End All Monsters"),
    new S3Level(31, "The Escape!"),
    new S3Level(67, "The Dancing Bear"),
    new S3Level(34, "Deja Vu?"),
    new S3Level(37, "A Familiar Face"),
    new S3Level(40, "Billy In The Wall"),
    new S3Level(46, "One Less Noble Warrior"),
    new S3Level(49, "THE END"),
    "Credits Flyover",
    new S3Level(184, "Sheila's Alp"),
    new S3Level(185, "Seashell Shore"),
    new S3Level(186, "Icy Peak"),
    new S3Level(187, "Spooky Swamp (Sheila)"),
    new S3Level(188, "Lost Fleet (Submarine)"),
    new S3Level(189, "Fireworks Factory (Dragons)"),
    new S3Level(190, "Desert Ruins"),
    new S3Level(191, "Dino Mines (Agent 9)"),
    new S3Level(192, "Charmed Ridge (Beanstalk)"),
    new S3Level(193, "Haunted Tomb"),
    new S3Level(194, "Cloud Spires"),
    new S3Level(195, "Bamboo Terrace (Sublevel)")
];

export const sceneGroup: SceneGroup = { id: id, name: name, sceneDescs: sceneDescs };
export const sceneGroup2: SceneGroup = { id: id2, name: name2, sceneDescs: sceneDescs2 };
export const sceneGroup3: SceneGroup = { id: id3, name: name3, sceneDescs: sceneDescs3 };
