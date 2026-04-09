import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
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

class DreamDropRenderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private room: DreamDropRoomRenderer;
    private textures: DreamDropTexture[];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, pmp: DreamDropPMP) {
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

        this.renderHelper = new GfxRenderHelper(device);
        this.room = new DreamDropRoomRenderer(this.renderHelper.renderCache, pmp.pmos);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
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

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.pushTemplateRenderInst();

        this.room.prepareToRender(device, this.renderHelper, viewerInput);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.room.destroy(device);
        this.renderHelper.renderCache.destroy();
        this.renderHelper.destroy();
        for (const t of this.textures) {
            device.destroyTexture(t.gfxTexture);
        }
    }
}

const pathBase = "KingdomHeartsDDD";
class Room implements SceneDesc {
    constructor(public id: string, public name: string) {

    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        device.checkForLeaks();
        const pmpFile = await context.dataFetcher.fetchData(`${pathBase}/map/${this.id}.pmp`);
        const pmp = new DreamDropParser(pmpFile).parsePMP();
        return new DreamDropRenderer(device, pmp);
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
    "Mysterious Tower",
    new Room("yt_01", "Chamber"),
    new Room("yt_02", "Tower"),
    new Room("yt_03", "Tower: Entrance"),
    new Room("yt_04", "Station of Awakening"),
    new Room("yt_06", "Beach"),
    new Room("yt_07", "Entrance Door"),
    new Room("yt_60", "Dive"),
    "Traverse Town",
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
    new Room("tw_12", "Fountain Plaza (Julius)"),
    new Room("tw_13", "Fountain Plaza"),
    new Room("tw_14", "Third District"),
    new Room("tw_60", "Dive (Sora)"),
    new Room("tw_61", "Dive (Riku)"),
    "Country of the Musketeers",
    new Room("tm_01", "The Opéra"),
    new Room("tm_02", "Grand Lobby"),
    new Room("tm_03", "Theatre"),
    new Room("tm_04", "Mont Saint-Michel"),
    new Room("tm_05", "Tower Road"),
    new Room("tm_06", "Tower"),
    new Room("tm_07", "Dungeon"),
    new Room("tm_08", "Training Yard"),
    new Room("tm_09", "Shore"),
    new Room("tm_10", "Green Room"),
    new Room("tm_11", "Machine Room"),
    new Room("tm_12", "Backstage"),
    new Room("tm_13", "Cell"),
    new Room("tm_14", "Mountain Road"),
    new Room("tm_15", "Training Yard"),
    new Room("tm_16", "Theatre"),
    new Room("tm_17", "The Opéra"),
    new Room("tm_18", "Tower"),
    new Room("tm_60", "Dive (Sora)"),
    new Room("tm_61", "Dive (Riku)"),
    "Symphony of Sorcery",
    new Room("fa_01", "Precipice"),
    new Room("fa_02", "Cloudwalk"),
    new Room("fa_03", "Glen"),
    new Room("fa_04", "Debug Room"),
    new Room("fa_05", "Fields"),
    new Room("fa_06", "Moonlight Wood"),
    new Room("fa_07", "Golden Wood"),
    new Room("fa_08", "Debug Room"),
    new Room("fa_09", "Snowgleam Wood"),
    new Room("fa_10", "Evil Grounds"),
    new Room("fa_11", "Precipice"),
    new Room("fa_12", "Debug Room"),
    new Room("fa_15", "Chamber"),
    new Room("fa_16", "Chamber"),
    new Room("fa_17", "Tower"),
    new Room("fa_18", "Tower Entrance"),
    new Room("fa_19", "Tower Entrance"),
    new Room("fa_60", "Dive (Sora)"),
    new Room("fa_61", "Dive (Riku)"),
    new Room("fa_62", "Chernabog (Boss Dive)"),
    "Prankster's Paradise",
    new Room("pi_01", "Amusement Park"),
    new Room("pi_02", "Ocean Floor"),
    new Room("pi_03", "Ocean Depths"),
    new Room("pi_04", "Promontory"),
    new Room("pi_05", "Ocean Surface"),
    new Room("pi_06", "Monstro: Mouth"),
    new Room("pi_07", "Monstro: Belly"),
    new Room("pi_08", "Monstro: Gullet"),
    new Room("pi_09", "Monstro: Cavity"),
    new Room("pi_10", "Monstro: Bowels"),
    new Room("pi_11", "Windup Way"),
    new Room("pi_12", "Circus"),
    new Room("pi_13", "Ocean Surface"),
    new Room("pi_14", "Ocean Depths"),
    new Room("pi_15", "Amusement Park"),
    new Room("pi_16", "Promontory"),
    new Room("pi_17", "Ocean Surface"),
    new Room("pi_18", "Monstro: Belly"),
    new Room("pi_19", "Ocean Depths"),
    new Room("pi_60", "Dive (Sora)"),
    new Room("pi_61", "Dive (Riku)"),
    "Radiant Garden",
    new Room("rg_01", "Ansem's Study"),
    new Room("rg_02", "Control Room"),
    new Room("rg_03", "Station Plaza"),
    new Room("rg_04", "Castle Doors"),
    new Room("rg_05", "Library"),
    new Room("rg_06", "Castle Oblivion"),
    new Room("rg_07", "Chamber of Waking"),
    new Room("rg_08", "Dark Margin"),
    "La Cité des Cloches",
    new Room("nd_01", "Square"),
    new Room("nd_02", "Square"),
    new Room("nd_03", "Nave"),
    new Room("nd_04", "Bell Tower"),
    new Room("nd_05", "Graveyard Gate"),
    new Room("nd_06", "Tunnels"),
    new Room("nd_07", "Old Graveyard"),
    new Room("nd_08", "Catacombs"),
    new Room("nd_09", "Court of Miracles"),
    new Room("nd_10", "Town"),
    new Room("nd_11", "Bridge"),
    new Room("nd_12", "Outskirts"),
    new Room("nd_13", "Windmill"),
    new Room("nd_14", "Square"),
    new Room("nd_15", "Nave"),
    new Room("nd_16", "Bell Tower"),
    new Room("nd_17", "Windmill"),
    new Room("nd_18", "Bridge"),
    new Room("nd_19", "Square"),
    new Room("nd_20", "Court of Miracles"),
    new Room("nd_60", "Dive (Sora)"),
    new Room("nd_61", "Dive (Riku)"),
    "The Grid",
    new Room("tl_01", "Portal"),
    new Room("tl_02", "Portal Stairs"),
    new Room("tl_03", "Debug Room"),
    new Room("tl_04", "Throneship"),
    new Room("tl_05", "Rectifier 1F"),
    new Room("tl_06", "Solar Sailer"),
    new Room("tl_07", "Docks"),
    new Room("tl_08", "City"),
    new Room("tl_09", "Throughput"),
    new Room("tl_10", "Bridge"),
    new Room("tl_11", "Arena"),
    new Room("tl_12", "Stadium"),
    new Room("tl_13", "Rectifier 2F"),
    new Room("tl_14", "Flynn's Hideout"),
    new Room("tl_15", "Solar Sailer"),
    new Room("tl_16", "Arena"),
    new Room("tl_17", "Portal"),
    new Room("tl_18", "Solar Sailer"),
    new Room("tl_60", "Dive (Sora)"),
    new Room("tl_61", "Dive (Riku)"),
    "The World That Never Was",
    new Room("eh_01", "Avenue to Dreams"),
    new Room("eh_02", "Contorted City"),
    new Room("eh_03", "Nightmarish Abyss"),
    new Room("eh_04", "Delusive Beginning"),
    new Room("eh_05", "Walk of Delusions"),
    new Room("eh_06", "Fact within Fiction"),
    new Room("eh_07", "Verge of Chaos"),
    new Room("eh_08", "Sanctum of Time"),
    new Room("eh_09", "Darkness's Call"),
    new Room("eh_10", "Darkest End"),
    new Room("eh_11", "Where Nothing Gathers"),
    new Room("eh_12", "Nightmarish Abyss"),
    new Room("eh_13", "Memory's Skyscraper"),
    new Room("eh_14", "Brink of Despair"),
    new Room("eh_20", "Nightmarish Abyss"),
    new Room("eh_60", "Dive (Sora)"),
    new Room("eh_61", "Dive (Riku)"),
    "Spirit Space",
    new Room("de_01", "Flick Rush"),
    new Room("de_02", "Hexagonal Stage"),
    new Room("de_03", "Final Round Stage"),
    new Room("de_10", "Petting Plaza"),
    "World Map",
    new Room("wm_01", "World Map"),
    "Treasure Planet (Unfinished)", // yes, it really is just a boat... what could have been...
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

export const sceneGroup: SceneGroup = { id: id, name: name, sceneDescs: sceneDescs };
