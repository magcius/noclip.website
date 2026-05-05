import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder";
import { LAYER_ICON, LayerPanel, Panel } from "../ui";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Texture as ViewerTexture } from "../viewer.js";
import { BBSParser, BBSPMP } from "./bin_bbs";
import { LuxTexture } from "./lux";
import { BBSRoomRenderer } from "./render_bbs";
import { decodeBBSTIM2 } from "./texture_bbs";

class Renderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private textures: LuxTexture[];
    private roomRenderer: BBSRoomRenderer;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, pmp: BBSPMP) {
        this.textures = Array(pmp.tims.length);
        for (let i = 0; i < pmp.tims.length; i++) {
            const { rgba, width, height } = decodeBBSTIM2(pmp.tims[i].data);
            const t = new LuxTexture(device, pmp.tims[i].name, 0, width, height, rgba);
            this.textures[i] = t;
        }

        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = { gfxTexture: this.textures[i].gfxTexture };
        }
        viewerTextures.sort((a, b) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!));
        this.textureHolder = new FakeTextureHolder(viewerTextures);
        this.renderHelper = new GfxRenderHelper(device);
        this.roomRenderer = new BBSRoomRenderer(this.renderHelper.renderCache, pmp, this.textures);
    }

    public createPanels(): Panel[] {
        const layersPanel = new LayerPanel();
        layersPanel.setLayers([...this.roomRenderer.parts]);
        layersPanel.setTitle(LAYER_ICON, "Model Visiblity");
        return [layersPanel];
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorTargetID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor), "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor), "Main Depth");
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

const pathBase = "KingdomHeartsBBS";
class Room implements SceneDesc {
    constructor(public id: string, public name: string) {

    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        device.checkForLeaks();
        const arcFile = await context.dataFetcher.fetchData(`${pathBase}/arc/map/${this.id}.arc`);
        const pmp = new BBSParser(arcFile).parsePMPFromARC();
        return new Renderer(device, pmp!);
    }
}

// Adapted room names from https://openkh.dev/bbs/dictionary/worlds.html
const id = "KHBBS";
const name = "Kingdom Hearts Birth by Sleep";
const sceneDescs = [
    "Land of Departure",
    new Room("DP01", "Forecourt"),
    new Room("DP14", "Forecourt"),
    new Room("DP08", "Forecourt (Day)"),
    new Room("DP07", "Forecourt (Night)"),
    new Room("DP02", "Great Hall"),
    new Room("DP09", "Great Hall"),
    new Room("DP03", "Ventus's Room"),
    new Room("DP04", "Ventus's Room"),
    new Room("DP05", "Mountain Path"),
    new Room("DP16", "Mountain Path (Night)"),
    new Room("DP06", "Summit"),
    new Room("DP10", "Ruins"),
    new Room("DP15", "Ruins (Night)"),
    new Room("DP11", "Chamber of Waking"),
    new Room("DP12", "Castle Oblivion"),
    new Room("DP13", "Character Selection"),
    "Dwarf Woodlands", // sw = snow white
    new Room("SW01", "Mine Entrance"),
    new Room("SW02", "The Mine"),
    new Room("SW03", "Vault"),
    new Room("SW04", "Magic Mirror Chamber"),
    new Room("SW05", "Underground Waterway"),
    new Room("SW06", "Courtyard"),
    new Room("SW07", "Flower Glade"),
    new Room("SW08", "Deep Woods"),
    new Room("SW09", "Inside the Mirror"),
    new Room("SW10", "Cottage Clearing"),
    new Room("SW11", "The Cottage"),
    new Room("SW12", "Mountain Trail"),
    "Castle of Dreams",
    new Room("CD01", "Cinderella's Room"),
    new Room("CD02", "Mousehole"),
    new Room("CD03", "Wardrobe Room"),
    new Room("CD13", "Wardrobe Room"),
    new Room("CD04", "Entrance"),
    new Room("CD05", "The Chateau"),
    new Room("CD06", "Forest"),
    new Room("CD07", "Palace Courtyard"),
    new Room("CD08", "Corridor"),
    new Room("CD09", "Ballroom"),
    new Room("CD10", "Foyer"),
    new Room("CD11", "Passage"),
    new Room("CD12", "Antechamber"),
    "Enchanted Dominion", // sb = sleeping beauty
    new Room("SB01", "Dungeon Cell"),
    new Room("SB02", "Gates"),
    new Room("SB03", "Maleficent's Throne"),
    new Room("SB04", "Dungeon"),
    new Room("SB05", "Hall"),
    new Room("SB06", "Forbidden Mountain"),
    new Room("SB07", "Waterside"),
    new Room("SB08", "Forest Clearing"),
    new Room("SB09", "Bridge"),
    new Room("SB10", "Bridge"),
    new Room("SB11", "Audience Chamber"),
    new Room("SB12", "Audience Chamber"),
    new Room("SB14", "Hallway"),
    new Room("SB15", "Aurora's Chamber"),
    new Room("SB16", "Tower Room"),
    new Room("SB17", "Hall"),
    new Room("SB18", "Aurora's Chamber"),
    new Room("SB19", "Hall"),
    new Room("SB38", "Hall"),
    new Room("SB39", "Gates"),
    "Myseterious Tower", // yt = yensid tower
    new Room("YT01", "Sorcerer's Chamber"),
    new Room("YT02", "Mysterious Tower"),
    new Room("YT03", "Entrance"),
    new Room("YT04", "Sorcerer's Chamber"),
    "Radiant Garden",
    new Room("RG01", "Outer Garden"),
    new Room("RG02", "Entryway"),
    new Room("RG03", "Central Square"),
    new Room("RG04", "Aqueduct"),
    new Room("RG05", "Castle Town"),
    new Room("RG06", "Reactor"),
    new Room("RG07", "Fountain Court"),
    new Room("RG08", "Merlin's House"),
    new Room("RG09", "Gardens"),
    new Room("RG10", "Front Doors"),
    new Room("RG11", "Purification Facility"),
    new Room("RG12", "Outer Gardens"),
    new Room("RG13", "Central Square"),
    new Room("RG14", "Central Square (Boss)"),
    "Olympus Coliseum", // he = hercules
    new Room("HE01", "Coliseum Gates"),
    new Room("HE02", "Vestibule"),
    new Room("HE03", "West Bracket"),
    new Room("HE04", "East Bracket"),
    new Room("HE05", "Town Near Thebes"), // yes it's really called that...
    new Room("HE06", "East Bracket"),
    "Deep Space", // ls = lilo & stitch
    new Room("LS01", "Prison Block"),
    new Room("LS02", "Turo Transporter"),
    new Room("LS03", "Durgon Transporter"),
    new Room("LS04", "Ship Corridor"),
    new Room("LS05", "Control Room"),
    new Room("LS06", "Containment Pod"),
    new Room("LS07", "Ship Hub"),
    new Room("LS08", "Machinery Bay"),
    new Room("LS09", "Launch Deck"),
    new Room("LS10", "Ship Exterior"),
    new Room("LS11", "Outer Space"),
    new Room("LS12", "Ship Corridor"),
    new Room("LS13", "Lanes Between"),
    new Room("LS14", "Bay Access"),
    "Destiny Islands",
    new Room("DI01", "Island Beach"),
    new Room("DI02", "Island Beach"),
    new Room("DI03", "Island Beach"),
    new Room("DI04", "Main Island Beach"),
    "Neverland", // pp = peter pan
    new Room("PP01", "Cove"),
    new Room("PP02", "Cliff"),
    new Room("PP03", "Mermaid Lagoon"),
    new Room("PP04", "Seacoast"),
    new Room("PP05", "Jungle Clearing"),
    new Room("PP06", "Peter's Hideout"),
    new Room("PP07", "Gully"),
    new Room("PP08", "Indian Camp"),
    new Room("PP09", "Rainbow Falls: Base"),
    new Room("PP10", "Rainbow Falls: Ascent"),
    new Room("PP11", "Rainbow Falls: Crest"),
    new Room("PP12", "Skull Rock: Entrance"),
    new Room("PP13", "Skull Rock: Cavern"),
    new Room("PP14", "Night Sky"),
    "Disney Town", // dc = disney characters?
    new Room("DC01", "Library"),
    new Room("DC02", "Main Plaza"),
    new Room("DC03", "Fruitball Court"),
    new Room("DC04", "Racecourse A"),
    new Room("DC05", "Raceway"),
    new Room("DC06", "Gizmo Gallery"),
    new Room("DC07", "Pete's Rec Room"),
    new Room("DC08", "Racecourse B"),
    new Room("DC09", "Racecourse C"),
    new Room("DC10", "Racecourse D"),
    new Room("DC11", "Lanes Between"),
    new Room("DC12", "Raceway Registration"),
    new Room("DC13", "Ice Cream"),
    new Room("DC14", "Fruitball"),
    "Keyblade Graveyard",
    new Room("KG01", "Badlands"),
    new Room("KG02", "Seat of War"),
    new Room("KG03", "Twister Trench"),
    new Room("KG04", "Eye of the Storm"),
    new Room("KG05", "Eye of the Storm"),
    new Room("KG06", "Eye of the Storm"),
    new Room("KG07", "Fissure"),
    new Room("KG08", "Keyblade Graveyard"),
    new Room("KG09", "Keyblade Graveyard"),
    new Room("KG10", "Keyblade Graveyard"),
    new Room("KG11", "Will's Cage"),
    new Room("KG12", "Keyblade Graveyard"),
    new Room("KG50", "Ventus's Mind"),
    new Room("KG51", "Ventus's Mind"),
    new Room("KG52", "Ventus's Mind"),
    new Room("KG53", "Sora's Mind"),
    new Room("KG55", "Keyblade Graveyard"),
    new Room("KG56", "Badlands"),
    "Mirage Arena", // vs = versus?
    new Room("VS01", "Hub"),
    new Room("VS02", "Coliseum"),
    new Room("VS03", "Arena"),
    new Room("VS04", "Badlands"),
    new Room("VS05", "Pinball"),
    new Room("VS06", "Ship Hub"),
    new Room("VS07", "Mousehole"),
    new Room("VS08", "Forest"),
    new Room("VS09", "Skull Rock"),
    new Room("VS10", "Audience Chamber"),
    new Room("VS11", "Forecourt"),
    new Room("VS12", "Summit"),
    new Room("VS13", "Launch Deck"),
    new Room("VS14", "Ship Exterior"),
    "Command Board", // bd = board
    new Room("BD01", "Land of Departure BG"),
    new Room("BD03", "Cinderella BG"),
    new Room("BD09", "Lilo & Stitch BG"),
    new Room("BD11", "Peter Pan BG"),
    new Room("BD12", "Disney Castle BG"),
    new Room("BD18", "Winnie the Pooh BG"),
    new Room("BD19", "Peter Pan BG"),
    "World Map",
    new Room("WM01", "World Map"),
    "Events", // jb = re-used jungle book id?
    new Room("JB50", "Lanes Between"),
    new Room("JB52", "Realm of Darkness"),
    new Room("JB53", "World Map Event"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };