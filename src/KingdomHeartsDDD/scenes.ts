import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { DreamDropParser, DreamDropPMP } from "./bin";
import { decodeDreamDropCTRT, DreamDropTexture, translateDreamDropTextureFormatString } from "./texture";
import { Texture as ViewerTexture } from "../viewer.js";
import { DreamDropRoomRenderer } from "./render";

class Renderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private roomRenderer: DreamDropRoomRenderer;
    private textures: DreamDropTexture[];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, pmp: DreamDropPMP, roomId: string) {
        const ctrts = pmp.ctrts;
        this.textures = Array(ctrts.length);
        for (let i = 0; i < ctrts.length; i++) {
            const pixels = decodeDreamDropCTRT(ctrts[i]);
            const t = new DreamDropTexture(device, ctrts[i].name, ctrts[i].format, ctrts[i].width, ctrts[i].height, pixels);
            this.textures[i] = t;
        }

        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = {
                gfxTexture: this.textures[i].gfxTexture,
                extraInfo: new Map<string, string>([
                    ["Format", `${translateDreamDropTextureFormatString(this.textures[i].format)}`]
                ])
            };
        }
        this.textureHolder = new FakeTextureHolder(viewerTextures);

        const skyboxIds = SKYBOX_IDS.get(roomId);
        this.renderHelper = new GfxRenderHelper(device);
        this.roomRenderer = new DreamDropRoomRenderer(this.renderHelper.renderCache, pmp.pmos, this.textures, skyboxIds ? skyboxIds : []);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorTargetID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor), "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor), "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
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

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.pushTemplateRenderInst();

        this.roomRenderer.prepareToRender(device, this.renderHelper, viewerInput);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.roomRenderer.destroy(device);
        this.renderHelper.renderCache.destroy();
        this.renderHelper.destroy();
        for (const t of this.textures) {
            device.destroyTexture(t.gfxTexture);
        }
    }
}

// ids of PMOs by room id that are rendered as the skybox
// some skyboxes are already big enough with their srt, but most aren't
const SKYBOX_IDS: Map<string, number[]> = new Map([
    ["di_01", [48, 47]], ["di_02", [0, 1]], ["di_03", [43, 44, 45]], ["di_05", [0]],
    ["yt_02", [41, 42, 43, 44, 45, 46]], ["yt_04", [38, 39, 40, 41, 42]],
    ["yt_06", [4, 5, 6, 7, 8]], ["yt_60", [2, 3, 4]], ["tw_01", [79, 80, 81, 82]],
    ["tw_02", [21, 22, 23, 97, 98]], ["tw_03", [37, 38]], ["tw_04", [159]], ["tw_05", [204, 269, 270]],
    ["tw_06", [353]], ["tw_08", [120, 121, 122, 200, 201]], ["tw_09", [105]], ["tw_10", [286, 419, 420]],
    ["tw_11", [299]], ["tw_12", [99]], ["tw_13", [106]], ["tw_14", [95, 96]], ["tw_60", [0, 1]],
    ["tw_61", [0, 1]], ["tm_04", [177, 178]], ["tm_05", [0]], ["tm_06", [0]], ["tm_08", [30]],
    ["tm_09", [0]], ["tm_15", [47]], ["tm_60", [0]], ["tm_61", [0]], ["fa_01", [87, 88, 89]],
    ["fa_02", [0]], ["fa_03", [0]], ["fa_05", [94]], ["fa_06", [0]], ["fa_07", [0, 1, 2, 3]],
    ["fa_09", [0, 1, 2, 3, 4, 5, 6]], ["fa_10", [148, 149, 150, 151]], ["fa_11", [0]],
    ["fa_60", [0]], ["fa_61", [0]], ["fa_62", [145, 146, 147, 148]], ["pi_01", [0, 1, 2]],
    ["pi_02", [68]], ["pi_03", [58]], ["pi_05", [14, 15, 16, 17]], ["pi_11", [88, 89, 90]],
    ["pi_13", [0]], ["pi_14", [1]], ["pi_15", [149]], ["pi_17", [0, 1, 2, 3]], ["pi_19", [51]],
    ["pi_60", [4, 5]], ["pi_61", [4, 5]], ["rg_02", [413, 414]], ["rg_03", [377, 378, 379]],
    ["rg_04", [758, 759, 760, 761, 762, 763]], ["rg_05", [57]], ["rg_06", [456, 457, 458, 459, 460]],
    ["rg_08", [12, 13, 14, 15, 16]], ["nd_01", [94]], ["nd_02", [97]], ["nd_04", [167]],
    ["nd_05", [162]], ["nd_07", [80]], ["nd_10", [0]], ["nd_11", [118, 119, 120]], ["nd_12", [0]],
    ["nd_13", [77, 78, 79]], ["nd_14", [80]], ["nd_15", [119]], ["nd_16", [171]], ["nd_17", [0, 1, 2]],
    ["nd_18", [0, 1, 2]], ["nd_19", [95]], ["nd_60", [0]], ["nd_61", [0]], ["tl_01", [0, 1, 2]],
    ["tl_02", [0, 1, 2]], ["tl_06", [61]], ["tl_07", [8]], ["tl_08", [68, 69]],
    ["tl_09", [32, 33, 34, 35, 36, 37, 38]], ["tl_10", [26, 27, 28, 29, 30]], ["tl_11", [12, 13, 14, 15]],
    ["tl_15", [0, 4]], ["tl_16", [12, 13, 14, 15]], ["tl_17", [0, 1, 2]], ["tl_18", [62, 66]],
    ["tl_60", [0]], ["tl_61", [0]], ["eh_03", [0]], ["eh_12", [0]], ["eh_20", [134]],
    ["eh_06", [0, 1, 2, 3, 4]], ["eh_07", [115, 116, 117, 118, 119, 120, 121]],
    ["eh_09", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]], ["eh_10", [0]], ["eh_13", [146]],
    ["eh_14", [10, 62, 63]], ["eh_60", [0]], ["eh_61", [0]], ["wm_01", [11, 12]]
]);

const pathBase = "KingdomHeartsDDD";
class Room implements SceneDesc {
    constructor(public id: string, public name: string) {

    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        device.checkForLeaks();
        const pmpFile = await context.dataFetcher.fetchData(`${pathBase}/map/${this.id}.pmp`);
        const pmp = new DreamDropParser(pmpFile).parsePMP();
        return new Renderer(device, pmp, this.id);
    }
}

// Adapted room names from https://openkh.dev/ddd/dictionary/worlds.html
const id = "KHDDD";
const name = "Kingdom Hearts 3D: Dream Drop Distance";
const sceneDescs = [
    "Destiny Islands",
    new Room("di_01", "Beach (Day)"),
    new Room("di_02", "Beach (Evening)"),
    new Room("di_03", "Beach (Night)"),
    new Room("di_05", "Main Island"),
    new Room("di_60", "Ocean"),
    "Traverse Town", // tw = the world ends with you
    new Room("tw_01", "First District"),
    new Room("tw_02", "Second District"),
    new Room("tw_03", "Third District"),
    new Room("tw_04", "Fourth District"),
    new Room("tw_05", "Fifth District"),
    new Room("tw_06", "Garden"),
    new Room("tw_07", "Post Office"),
    new Room("tw_08", "Back Streets"),
    new Room("tw_09", "Fountain Plaza"),
    new Room("tw_10", "Fifth District"),
    new Room("tw_11", "Garden"),
    new Room("tw_12", "Fountain Plaza (Boss)"),
    new Room("tw_13", "Fountain Plaza (Unfinished)"),
    new Room("tw_14", "Third District"),
    new Room("tw_60", "Dive (Sora)"),
    new Room("tw_61", "Dive (Riku)"),
    "La Cité des Cloches", // nd = notre-dame
    new Room("nd_10", "Town"),
    new Room("nd_01", "Square"),
    new Room("nd_19", "Square (Burning)"),
    new Room("nd_02", "Square (Burning, Sora Boss)"),
    new Room("nd_14", "Square (Burning, Riku Boss)"),
    new Room("nd_03", "Nave"),
    new Room("nd_15", "Nave (Burning)"),
    new Room("nd_04", "Bell Tower"),
    new Room("nd_16", "Bell Tower (Burning)"),
    new Room("nd_09", "Court of Miracles"),
    new Room("nd_20", "Court of Miracles (Unfinished)"),
    new Room("nd_11", "Bridge"),
    new Room("nd_18", "Bridge (Burning)"),
    new Room("nd_12", "Outskirts"),
    new Room("nd_05", "Graveyard Gate"),
    new Room("nd_07", "Old Graveyard"),
    new Room("nd_06", "Tunnels"),
    new Room("nd_08", "Catacombs"),
    new Room("nd_13", "Windmill"),
    new Room("nd_17", "Windmill (Burning)"),
    new Room("nd_60", "Dive (Sora)"),
    new Room("nd_61", "Dive (Riku)"),
    "The Grid", // tl = tron legacy
    new Room("tl_01", "Portal"),
    new Room("tl_17", "Portal"),
    new Room("tl_02", "Portal Stairs"),
    new Room("tl_04", "Throneship"),
    new Room("tl_05", "Rectifier 1F"),
    new Room("tl_13", "Rectifier 2F"),
    new Room("tl_06", "Solar Sailer"),
    new Room("tl_15", "Solar Sailer"),
    new Room("tl_18", "Solar Sailer"),
    new Room("tl_07", "Docks"),
    new Room("tl_08", "City"),
    new Room("tl_09", "Throughput"),
    new Room("tl_10", "Bridge"),
    new Room("tl_11", "Arena"),
    new Room("tl_16", "Arena"),
    new Room("tl_12", "Stadium"),
    new Room("tl_14", "Flynn's Hideout"),
    new Room("tl_03", "Debug Room"),
    new Room("tl_60", "Dive (Sora)"),
    new Room("tl_61", "Dive (Riku)"),
    "Prankster's Paradise", // pi = pinocchio
    new Room("pi_01", "Amusement Park"),
    new Room("pi_15", "Amusement Park (Unfinished)"),
    new Room("pi_11", "Windup Way"),
    new Room("pi_12", "Circus"),
    new Room("pi_04", "Promontory"),
    new Room("pi_16", "Promontory"),
    new Room("pi_02", "Ocean Floor"),
    new Room("pi_03", "Ocean Depths"),
    new Room("pi_14", "Ocean Depths"),
    new Room("pi_19", "Ocean Depths"),
    new Room("pi_05", "Ocean Surface"),
    new Room("pi_13", "Ocean Surface"),
    new Room("pi_17", "Ocean Surface"),
    new Room("pi_06", "Monstro: Mouth"),
    new Room("pi_07", "Monstro: Belly"),
    new Room("pi_18", "Monstro: Belly"),
    new Room("pi_08", "Monstro: Gullet"),
    new Room("pi_09", "Monstro: Cavity"),
    new Room("pi_10", "Monstro: Bowels"),
    new Room("pi_60", "Dive (Sora)"),
    new Room("pi_61", "Dive (Riku)"),
    "Country of the Musketeers", // tm = the three musketeers
    new Room("tm_01", "The Opéra"),
    new Room("tm_17", "The Opéra"),
    new Room("tm_02", "Grand Lobby"),
    new Room("tm_03", "Theatre"),
    new Room("tm_16", "Theatre"),
    new Room("tm_04", "Mont Saint-Michel"),
    new Room("tm_05", "Tower Road"),
    new Room("tm_06", "Tower"),
    new Room("tm_07", "Dungeon"),
    new Room("tm_08", "Training Yard (Day)"),
    new Room("tm_15", "Training Yard (Night)"),
    new Room("tm_09", "Shore"),
    new Room("tm_10", "Green Room"),
    new Room("tm_11", "Machine Room"),
    new Room("tm_12", "Backstage"),
    new Room("tm_13", "Cell"),
    new Room("tm_14", "Mountain Road"),
    new Room("tm_60", "Dive (Sora)"),
    new Room("tm_61", "Dive (Riku)"),
    "Symphony of Sorcery", // fa = fantasia
    new Room("fa_01", "Precipice"),
    new Room("fa_02", "Cloudwalk"),
    new Room("fa_03", "Glen"),
    new Room("fa_05", "Fields"),
    new Room("fa_06", "Moonlight Wood"),
    new Room("fa_07", "Golden Wood"),
    new Room("fa_09", "Snowgleam Wood"),
    new Room("fa_10", "Evil Grounds"),
    new Room("fa_11", "Precipice"),
    new Room("fa_15", "Chamber"),
    new Room("fa_16", "Chamber"),
    new Room("fa_17", "Tower"),
    new Room("fa_18", "Tower Entrance"),
    new Room("fa_19", "Tower Entrance"),
    new Room("fa_04", "Debug Room 1"),
    new Room("fa_08", "Debug Room 2"),
    new Room("fa_12", "Debug Room 3"),
    new Room("fa_60", "Dive (Sora)"),
    new Room("fa_61", "Dive (Riku)"),
    new Room("fa_62", "Chernabog (Boss Dive)"),
    "The World That Never Was", // eh = ???
    new Room("eh_01", "Avenue to Dreams"),
    new Room("eh_02", "Contorted City"),
    new Room("eh_03", "Nightmarish Abyss"),
    new Room("eh_12", "Nightmarish Abyss"),
    new Room("eh_20", "Nightmarish Abyss"),
    new Room("eh_04", "Delusive Beginning"),
    new Room("eh_05", "Walk of Delusions"),
    new Room("eh_06", "Fact within Fiction"),
    new Room("eh_07", "Verge of Chaos"),
    new Room("eh_08", "Sanctum of Time"),
    new Room("eh_09", "Darkness's Call"),
    new Room("eh_10", "Darkest End"),
    new Room("eh_11", "Where Nothing Gathers"),
    new Room("eh_13", "Memory's Skyscraper"),
    new Room("eh_14", "Brink of Despair"),
    new Room("eh_60", "Dive (Sora)"),
    new Room("eh_61", "Dive (Riku)"),
    "Radiant Garden",
    new Room("rg_01", "Ansem's Study"),
    new Room("rg_02", "Control Room"),
    new Room("rg_03", "Station Plaza (Twilight Town)"),
    new Room("rg_04", "Castle Doors (Unused)"),
    new Room("rg_05", "Library (Disney Castle)"),
    new Room("rg_06", "Castle Oblivion"),
    new Room("rg_07", "Chamber of Waking"),
    new Room("rg_08", "Dark Margin"),
    "Mysterious Tower", // yt = yensid tower
    new Room("yt_01", "Chamber"),
    new Room("yt_02", "Tower"),
    new Room("yt_03", "Tower: Entrance"),
    new Room("yt_04", "Station of Awakening"),
    new Room("yt_06", "Beach"),
    new Room("yt_07", "Entrance Door"),
    new Room("yt_60", "Dive"),
    "Spirit Space", // de = dream eater
    new Room("de_01", "Flick Rush"),
    new Room("de_02", "Hexagonal Stage"),
    new Room("de_03", "Final Round Stage"),
    new Room("de_10", "Petting Plaza"),
    "World Map",
    new Room("wm_01", "World Map"),
    "Treasure Planet (Unfinished)", // what could have been...
    new Room("tp_01", "The Legacy's Deck"),
    new Room("tp_02", "Debug Room 1"),
    new Room("tp_03", "Debug Room 2"),
    new Room("tp_04", "Debug Room 3"),
    new Room("tp_05", "Debug Room 4"),
    new Room("tp_06", "Debug Room 5"),
    new Room("tp_07", "Debug Room 6"),
    new Room("tp_08", "Debug Room 7"),
    new Room("tp_09", "Debug Room 8"),
    new Room("tp_10", "Debug Room 9"),
    new Room("tp_11", "Debug Room 10")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
