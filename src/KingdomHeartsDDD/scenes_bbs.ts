import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder";
import { COOL_BLUE_COLOR, EYE_ICON, LAYER_ICON, LayerPanel, MultiSelect, Panel } from "../ui";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Texture as ViewerTexture } from "../viewer.js";
import { BBSModel, BBSParser, BBSPixelFormat, BBSPMP } from "./bin_bbs";
import { BBS_ARC_BOSS, BBS_ARC_ENEMY, BBS_ARC_GIMMICK, BBS_ARC_NPC, BBS_ARC_PC, BBS_ARC_WEAPON, BBS_VALID_PRESET_ARC } from "./config/data";
import { LuxObjectSet, LuxOLOInstance, LuxRoomObjects, LuxTexture } from "./lux";
import { BBSRoomRenderer } from "./render_bbs";
import { decodeBBSTIM2, TIM2Texture } from "./texture";

function getCharaSubDirectory(name: string) {
    switch (name.substring(0, 1).toLowerCase()) {
        case "b":
            return "BOSS";
        case "m":
            return "ENEMY";
        case "f":
            return "F_OBJ";
        case "g":
            return "GIMMICK";
        case "h":
            return "HIGH";
        case "n":
            return "NPC";
        case "p":
            return "PC";
        case "w":
            return "WEP";
        default:
            throw `Unknown chara prefix for \"${name}\"`;
    }
}

function getArcSubDirectory(name: string) {
    switch (name.substring(0, 1).toLowerCase()) {
        case "b":
            return "boss";
        case "m":
            return "enemy";
        case "g":
            return "gimmick";
        case "n":
            return "npc";
        case "p":
        case "x":
            return "pc";
        case "w":
            return "weapon";
        default:
            throw `Unknown arc prefix for \"${name}\"`;
    }
}

function getPrettyDataSetName(name: string) {
    const n = name.toLowerCase();
    if (n.endsWith("aq")) {
        return "Objects (Aqua)";
    } else if (n.endsWith("ex")) {
        return "Objects (EX)";
    } else if (n.endsWith("te")) {
        return "Objects (Terra)";
    } else if (n.endsWith("ve")) {
        return "Objects (Ventus)";
    } else {
        return name;
    }
}

class Renderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private textures: LuxTexture[];
    private roomRenderer: BBSRoomRenderer;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, pmp: BBSPMP, objects: LuxRoomObjects) {
        const tims = [...pmp.tims];
        for (const model of objects.models.values()) {
            tims.push(...(model as BBSModel).tims);
        }
        this.textures = Array(tims.length);
        for (let i = 0; i < tims.length; i++) {
            const { rgba, width, height, format } = decodeBBSTIM2(tims[i].data);
            const t = new TIM2Texture(device, tims[i].name, width, height, rgba, format);
            this.textures[i] = t;
        }

        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = { gfxTexture: this.textures[i].gfxTexture, extraInfo: new Map([["Format", `${BBSPixelFormat[(this.textures[i] as TIM2Texture).format]}`]]) };
        }
        viewerTextures.sort((a, b) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!));
        this.textureHolder = new FakeTextureHolder(viewerTextures);
        this.renderHelper = new GfxRenderHelper(device);
        this.roomRenderer = new BBSRoomRenderer(this.renderHelper.renderCache, pmp, this.textures, objects);
    }

    public createPanels(): Panel[] {
        const layersPanel = new LayerPanel();
        layersPanel.setLayers([...this.roomRenderer.parts, ...this.roomRenderer.objects]);
        layersPanel.setTitle(LAYER_ICON, "Model Visiblity");

        const setPanel = new Panel();
        setPanel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        setPanel.setTitle(EYE_ICON, "Object Sets");
        const setNames = this.roomRenderer.sets.map(s => getPrettyDataSetName(s.name));
        const select = new MultiSelect();
        select.setStrings(setNames);
        select.onitemchanged = (index: number, v: boolean) => {
            this.roomRenderer.onSetChanged(index, v);
        };
        if (setNames.length > 0) {
            select.setItemSelected(0, true);
        } else {
            setPanel.setVisible(false);
        }
        setPanel.contents.appendChild(select.elem);

        return [setPanel, layersPanel];
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
        const arcFile = await context.dataFetcher.fetchData(`${pathBase}/arc/map/${this.id}.arc`);
        const pmp = new BBSParser(arcFile).parsePMPFromARC()!;

        const sets: LuxObjectSet[] = [];
        for (const presetArcName of BBS_VALID_PRESET_ARC.filter(a => a.startsWith(this.id))) {
            const presetFile = await context.dataFetcher.fetchData(`${pathBase}/arc/preset/${presetArcName}.arc`);
            const olos = new BBSParser(presetFile).parseOLOFromARC();
            const instances: LuxOLOInstance[] = [];
            for (const olo of olos) {
                instances.push(...olo.objects);
            }
            if (instances.length > 0) {
                sets.push({ name: presetArcName, instances });
            }
        }

        // try to locate model files from the sets (they don't give a location, only a name...)
        const models: Map<string, BBSModel> = new Map();
        const validModels = [...BBS_ARC_BOSS, ...BBS_ARC_ENEMY, ...BBS_ARC_GIMMICK, ...BBS_ARC_NPC, ...BBS_ARC_PC, ...BBS_ARC_WEAPON];
        for (const set of sets) {
            for (const instance of set.instances) {
                if (models.has(instance.name)) {
                    continue;
                }
                let invalid = true;
                let check2 = false;
                let arcName = "";
                for (const v of validModels) {
                    let n = instance.name.toLowerCase().startsWith("p") ? 3 : 5;
                    if (instance.name.substring(0, n).toLowerCase() === v.substring(0, n).toLowerCase()) {
                        invalid = false;
                        arcName = v;
                        break;
                    }
                }
                if (invalid) {
                    check2 = true;
                } else {
                    const subdir = getArcSubDirectory(instance.name);
                    const modelArcFile = await context.dataFetcher.fetchData(`${pathBase}/arc/${subdir}/${arcName}.arc`);
                    const pmo = new BBSParser(modelArcFile).parsePMOFromARC(instance.name);
                    if (!pmo) {
                        check2 = true;
                    } else {
                        models.set(instance.name, pmo);
                    }
                }
                if (check2) {
                    const subdir = getCharaSubDirectory(instance.name);
                    const u = instance.name.toUpperCase();
                    const modelFile = await context.dataFetcher.fetchData(`${pathBase}/CHARA/${subdir}/${u.substring(0, 5)}/${u.substring(5).substring(0, 2)}/${u}.pmo`, { allow404: true });
                    if (modelFile.byteLength === 0) {
                        continue;
                    }
                    const pmo = new BBSParser(modelFile).parseModel(instance.name);
                    models.set(instance.name, pmo);
                }
            }
        }

        return new Renderer(device, pmp, { sets, models, animations: new Map() });
    }
}

/*
TODO

Fix occasional 404 errors when fetching models from OLOs (already two checks for location, need a third?)
Most models' eye textures have wrong UVs for some reason. They're either almost right or nightmare fuel
    This issue, or another with the same symptoms, can happen with other parts, but is most common in the eye texture
Level object models have vertex colors, but it doesn't look right so color is hardcoded to white
Make weight/joint allocation more efficient instead of padding to 8 per vertex
Clean up TIM2 decoding and structures (possibly integrate with existing PS2 decoding? Couldn't get it to work)
Check for billboard textures, move DDD's code for it to Lux if there's any
Investigate webgl texture error in JB10 (probably a mismatched texture header?)
Add default OLOs
Add save states

May your heart be your guiding key
*/

// Adapted room names from https://openkh.dev/bbs/dictionary/worlds.html
const id = "KHBBS";
const name = "Kingdom Hearts Birth by Sleep";
const sceneDescs = [
    "Land of Departure",
    new Room("DP01", "Forecourt"),
    new Room("DP07", "Forecourt (Night)"),
    new Room("DP14", "Forecourt (No Lights)"),
    new Room("DP08", "Forecourt (Ruined)"),
    new Room("DP02", "Great Hall"),
    new Room("DP09", "Great Hall (Ruined)"),
    new Room("DP03", "Ventus's Room"),
    new Room("DP04", "Ventus's Room (Night)"),
    new Room("DP05", "Mountain Path"),
    new Room("DP16", "Mountain Path (Boss)"),
    new Room("DP06", "Summit"),
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
    new Room("CD03", "Wardrobe Room (Messy)"),
    new Room("CD13", "Wardrobe Room (Organized)"),
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
    new Room("SB39", "Gates"),
    new Room("SB03", "Maleficent's Throne"),
    new Room("SB04", "Dungeon"),
    new Room("SB05", "Hall"),
    new Room("SB17", "Hall"),
    new Room("SB19", "Hall"),
    new Room("SB38", "Hall"),
    new Room("SB06", "Forbidden Mountain"),
    new Room("SB07", "Waterside"),
    new Room("SB08", "Forest Clearing"),
    new Room("SB09", "Bridge"),
    new Room("SB10", "Bridge"),
    new Room("SB11", "Audience Chamber"),
    new Room("SB12", "Audience Chamber"),
    new Room("SB14", "Hallway"),
    new Room("SB16", "Tower Room"),
    new Room("SB15", "Aurora's Chamber"),
    new Room("SB18", "Aurora's Chamber"),
    "Myseterious Tower", // yt = yensid tower
    new Room("YT01", "Sorcerer's Chamber"),
    new Room("YT02", "Mysterious Tower"),
    new Room("YT03", "Entrance"),
    new Room("YT04", "Sorcerer's Chamber"),
    "Radiant Garden",
    new Room("RG01", "Outer Garden"),
    new Room("RG02", "Entryway"),
    new Room("RG03", "Central Square"),
    new Room("RG13", "Central Square (Night)"),
    new Room("RG14", "Central Square (Boss)"),
    new Room("RG04", "Aqueduct"),
    new Room("RG05", "Castle Town"),
    new Room("RG06", "Reactor"),
    new Room("RG07", "Fountain Court"),
    new Room("RG08", "Merlin's House"),
    new Room("RG09", "Gardens"),
    new Room("RG10", "Front Doors"),
    new Room("RG11", "Purification Facility"),
    new Room("RG12", "Outer Gardens"),
    "Olympus Coliseum", // he = hercules
    new Room("HE01", "Coliseum Gates"),
    new Room("HE02", "Vestibule"),
    new Room("HE03", "West Bracket"),
    new Room("HE04", "East Bracket"),
    new Room("HE06", "East Bracket (Night)"),
    new Room("HE05", "Town Near Thebes"), // yes it's really called that...
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
    // new Room("LS14", "Bay Access"),
    "Destiny Islands",
    new Room("DI01", "Beach (Day)"),
    new Room("DI02", "Beach (Evening)"),
    new Room("DI03", "Beach (Night)"),
    new Room("DI04", "Main Island"),
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
    "Disney Town", // dc = disney castle
    new Room("DC01", "Library"),
    new Room("DC02", "Main Plaza"),
    new Room("DC03", "Fruitball Court"),
    new Room("DC14", "Fruitball (Minigame)"),
    new Room("DC13", "Ice Cream (Minigame)"),
    new Room("DC05", "Raceway"),
    new Room("DC04", "Racecourse A"),
    new Room("DC08", "Racecourse B"),
    new Room("DC09", "Racecourse C"),
    new Room("DC10", "Racecourse D"),
    new Room("DC06", "Gizmo Gallery"),
    new Room("DC07", "Pete's Rec Room"),
    new Room("DC11", "Lanes Between"),
    // new Room("DC12", "Raceway Registration"),
    "Keyblade Graveyard",
    new Room("KG01", "Badlands"),
    new Room("KG56", "Badlands (Boss)"),
    new Room("KG02", "Seat of War"),
    new Room("KG03", "Twister Trench"),
    new Room("KG04", "Eye of the Storm (Blue)"),
    new Room("KG05", "Eye of the Storm (Pink)"),
    new Room("KG06", "Eye of the Storm (Green)"),
    new Room("KG07", "Fissure"),
    new Room("KG08", "Keyblade Graveyard"),
    new Room("KG09", "Keyblade Graveyard (Kingdom Hearts)"),
    new Room("KG12", "Keyblade Graveyard (Kingdom Hearts) (Boss)"),
    new Room("KG55", "Keyblade Graveyard (Top of the Plateau)"),
    new Room("KG10", "Keyblade Graveyard (Top of the Plateau) (Boss)"),
    new Room("KG11", "Will's Cage (Boss)"),
    new Room("KG50", "Ventus's Mind"),
    new Room("KG51", "Ventus's Mind (Boss)"),
    // new Room("KG52", "Ventus's Mind"),
    new Room("KG53", "Sora's Mind"),
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
    "Events",
    new Room("JB50", "Lanes Between"),
    new Room("JB52", "Realm of Darkness"),
    new Room("JB53", "World Map Event"),
    "Jungle Book (Unfinished)",
    new Room("JB01", "Louie's Ruins"),
    new Room("JB09", "Eminence"),
    new Room("JB10", "Jungle"),
    new Room("JB11", "Man-Village River"),
    "Placeholder Rooms",
    new Room("JB02", "jb02 Court"),
    new Room("JB03", "jb03 Path Crossroads"),
    new Room("JB04", "jb04 UG Ruins Entrance"),
    new Room("JB05", "jb05 UG Ruins Passage 1"),
    new Room("JB06", "jb06 UG Ruins Passage 2"),
    new Room("JB07", "jb07 UG Courtyard"),
    new Room("JB08", "jb08 Jungle Near Ruins"),
    new Room("JB12", "jb12 Bog")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };