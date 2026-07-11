import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder } from "../TextureHolder";
import { COOL_BLUE_COLOR, EYE_ICON, MultiSelect, Panel } from "../ui";
import { SceneGfx } from "../viewer";
import { Texture as ViewerTexture } from "../viewer.js";
import { BBSModel, BBSParser, BBSTIM2Format, BBSPMP } from "./bin_bbs";
import { BBS_ARC_BOSS, BBS_ARC_ENEMY, BBS_ARC_GIMMICK, BBS_ARC_NPC, BBS_ARC_PC, BBS_ARC_PMO_OVERRIDE, BBS_ARC_WEAPON, BBS_MODEL_REMAP, BBS_PAM, BBS_PMO_ARC_OVERRIDE, BBS_VALID_PRESET_ARC } from "./config/data";
import { BBS_DEFAULT_SETS } from "./config/room";
import { LuxObjectSet, LuxOLOInstance, LuxPVD, LuxRenderer, LuxRoomObjects, LuxSkeletalAnimation } from "./lux";
import { BBSRoomRenderer } from "./render_bbs";
import { decodeBBSTIM2, BBSTIM2Texture } from "./texture";

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

async function getRoomObjects(roomId: string, context: SceneContext): Promise<LuxRoomObjects> {
    // this function is a mess right now. Will be rewritten at some point...

    const sets: LuxObjectSet[] = [];
    for (const presetArcName of BBS_VALID_PRESET_ARC.filter(a => a.startsWith(roomId.toUpperCase()))) {
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

    const models: Map<string, BBSModel> = new Map();
    const animations: Map<string, LuxSkeletalAnimation> = new Map();
    const validArcs = [...BBS_ARC_BOSS, ...BBS_ARC_ENEMY, ...BBS_ARC_GIMMICK, ...BBS_ARC_NPC, ...BBS_ARC_PC, ...BBS_ARC_WEAPON];
    for (const set of sets) {
        for (const instance of set.instances) {
            if (models.has(instance.name)) {
                continue;
            }
            let invalid = true;
            let check2 = false;
            let arcName = "";
            for (const v of validArcs) {
                if (instance.name.toLowerCase() === v.toLowerCase()) {
                    invalid = false;
                    arcName = v;
                    break;
                }
            }
            if (invalid) {
                // strict search failed, use first n characters of model name
                for (const v of validArcs) {
                    let n = instance.name.toLowerCase().startsWith("p") ? 3 : 5;
                    if (instance.name.substring(0, n).toLowerCase() === v.substring(0, n).toLowerCase()) {
                        invalid = false;
                        arcName = v;
                        break;
                    }
                }
            }
            if (invalid) {
                for (const [k, v] of BBS_PMO_ARC_OVERRIDE) {
                    if (v.includes(instance.name)) {
                        arcName = k;
                        // console.log("Overrode", instance.name, "to arc", arcName);
                        invalid = false;
                        break;
                    }
                }
            }
            if (invalid) {
                check2 = true;
            } else {
                const subdir = getArcSubDirectory(instance.name);
                let modelArcFile = await context.dataFetcher.fetchData(`${pathBase}/arc/${subdir}/${arcName}.arc`);
                let p = new BBSParser(modelArcFile);
                let pmoName = instance.name;
                let remapped = false;
                if (BBS_MODEL_REMAP.includes(instance.name)) {
                    // check if model variant (different .epd, .esd files, etc but same geometry & animations)
                    // since there is more of a heuristic and doesn't work all the time, it's on a whitelist of BBS_MODEL_REMAP
                    const arcEntries = p.parseARC();
                    // if dir pointer is "BOSS" or "ENEM" or "GIMM". It can be other values like "EFFE" which can be ignored
                    // sometimes there's more than one with the same pointer, don't know how to handle that case... for now just the first
                    // this should also change subdir, but it's assumed to be in the same directory (hence the whitelist)
                    const remapEntry = arcEntries.find(e => e.dirPointer === 1397968706 || e.dirPointer === 1296387653 || e.dirPointer === 1296910663);
                    if (remapEntry !== undefined) {
                        // not exactly sure how this works, but the name of this entry corresponds to a "base" ARC file (as if the instance name was it)
                        pmoName = remapEntry.name;
                        // need to loop through arc names again to get the correct file name since the list doesn't contain variants
                        for (const v of validArcs) {
                            if (pmoName.toLowerCase().substring(0, 5) === v.toLowerCase().substring(0, 5)) {
                                arcName = v;
                                break;
                            }
                        }
                        if (pmoName.endsWith("d")) {
                            pmoName = pmoName.substring(0, pmoName.length - 1);
                        }
                        // console.log("Remapped", instance.name, "to", pmoName, "in arc", arcName);
                        remapped = true;
                        modelArcFile = await context.dataFetcher.fetchData(`${pathBase}/arc/${subdir}/${arcName}.arc`);
                        p = new BBSParser(modelArcFile);
                    }
                }
                if (BBS_ARC_PMO_OVERRIDE.has(pmoName)) {
                    pmoName = BBS_ARC_PMO_OVERRIDE.get(pmoName)!;
                }
                const pmo = p.parsePMOFromARC(pmoName);
                if (!pmo) {
                    // console.log("Could not find PMO of name", pmoName, "in", p.parseARC(), arcName);
                    check2 = true;
                } else {
                    // console.log("Loaded", instance.name, "from arc", arcName);
                    models.set(instance.name, pmo);
                    const ac = remapped ? pmoName : instance.name;
                    if (BBS_PAM.has(ac) && !animations.has(instance.name)) {
                        const mapping = BBS_PAM.get(ac)!;
                        const pam = p.parsePAMFromARC(mapping.name)!;
                        animations.set(instance.name, pam.animations[mapping.index]);
                    }
                }
            }
            // ideally, nothing is loaded from chara, but use as fallback until this logic is rewritten
            if (check2) {
                const subdir = getCharaSubDirectory(instance.name);
                const u = instance.name.toUpperCase();
                const modelFile = await context.dataFetcher.fetchData(`${pathBase}/CHARA/${subdir}/${u.substring(0, 5)}/${u.substring(5).substring(0, 2)}/${u}.pmo`, { allow404: true });
                if (modelFile.byteLength === 0) {
                    continue;
                }
                const pmo = new BBSParser(modelFile).parseModel(instance.name);
                // console.log("Loaded", instance.name, "from CHARA", u);
                models.set(instance.name, pmo);
            }
        }
    }

    return { sets, models, animations };
}

class Renderer extends LuxRenderer {
    constructor(device: GfxDevice, pmp: BBSPMP, pvd: LuxPVD, objects: LuxRoomObjects, private defaultSets: number[]) {
        super(device, pvd.clearColor);

        const tims = [...pmp.tims];
        for (const model of objects.models.values()) {
            tims.push(...(model as BBSModel).tims);
        }
        this.textures = Array(tims.length);
        for (let i = 0; i < tims.length; i++) {
            const { rgba, width, height, format } = decodeBBSTIM2(tims[i].data);
            const t = new BBSTIM2Texture(device, tims[i].name, width, height, rgba, format);
            this.textures[i] = t;
        }

        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = {
                gfxTexture: this.textures[i].gfxTexture,
                extraInfo: new Map([
                    ["Pixel Format", `${BBSTIM2Format[(this.textures[i] as BBSTIM2Texture).format]}`]
                ])
            };
        }
        viewerTextures.sort((a, b) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!));
        this.textureHolder = new FakeTextureHolder(viewerTextures);
        this.renderHelper = new GfxRenderHelper(device);
        this.roomRenderer = new BBSRoomRenderer(this.renderHelper.renderCache, pmp, this.textures, objects, [], pvd);
    }

    protected override getSetPanel(): Panel {
        const setPanel = new Panel();
        setPanel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        setPanel.setTitle(EYE_ICON, "Object Sets");
        const setNames = this.roomRenderer!.sets.map(s => getPrettyDataSetName(s.name));
        const select = new MultiSelect();
        select.setStrings(setNames);
        select.onitemchanged = (index: number, v: boolean) => {
            this.roomRenderer!.onSetChanged(index, v);
        };
        if (setNames.length > 0) {
            if (this.defaultSets.length === 0) {
                select.setItemSelected(0, false);
            } else {
                for (let i = 0; i < setNames.length; i++) {
                    const v = this.defaultSets.includes(i);
                    select.setItemSelected(i, v);
                    this.roomRenderer!.onSetChanged(i, v);
                }
            }
        } else {
            setPanel.setVisible(false);
        }
        setPanel.contents.appendChild(select.elem);
        return setPanel;
    }

    protected override isPlayerCharacterModel(name: string) {
        return name.toLowerCase().startsWith("p") && name.substring(3, 5).toLowerCase() === "ex";
    }
}

// some levels re-use another's pmp with an arc entry, with the only differences being
// that one texture is replaced (which is ignored for now) and whatever the .nmd file does
const PMP_REMAP = new Map<string, string>([
    ["dc12", "dc05"],
    ["ls14", "ls09"]
]);

const pathBase = "KingdomHeartsBBS";
class Room implements SceneDesc {
    constructor(public id: string, public name: string) {
        this.id = id.toLowerCase();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const arcName = PMP_REMAP.has(this.id) ? PMP_REMAP.get(this.id)! : this.id;
        const arcFile = await context.dataFetcher.fetchData(`${pathBase}/arc/map/${arcName.toUpperCase()}.arc`);
        const p = new BBSParser(arcFile);
        const pmp = p.parsePMPFromARC(this.id)!;
        let pvd = p.parsePVDFromARC();
        if (!pvd) {
            console.warn("Could not find PVD for", this.id);
            pvd = { clearColor: [0, 0, 0, 1], fogColor: [1, 1, 1, 0], fogNear: 400, fogFar: 480 };
        } else {
            pvd.clearColor = pvd.clearColor.map(c => c / 255);
            pvd.fogColor = pvd.fogColor.map(c => c / 255);
        }

        const objects = await getRoomObjects(this.id, context);

        return new Renderer(device, pmp, pvd, objects, BBS_DEFAULT_SETS.has(this.id) ? BBS_DEFAULT_SETS.get(this.id)! : []);
    }
}

/*
TODO

Most models' eye textures have wrong UVs for some reason. They're either almost right or nightmare fuel
    This issue, or another with the same symptoms, can happen with other parts, but is most common in the eye texture
    It seems to have something to do with needing to scale by the texture width/height and only affects UVs that are single bytes.
    I haven't been able to figure out a consistent way to scale by texture dimensions, since one way will work for some
    models but not others and vice versa. Texture formats and other flags don't seem to have an effect. It could also
    have to do with aspect ratio, rather than width and height, since the very few eye textures that do look right happen to be squares
Investigate webgl texture error in jb10 (probably a mismatched texture header?)
Confirm if rg01 and rg12 have slightly different names or not ("Outer Garden" vs "Outer Gardens")
Redo the pipeline of OLO object model names to actual model files (since their location is not provided). It's a mess right now but (mostly) works
    Ideally, remove all the hardcoded stuff in config/data.ts, but some of it is needed to avoid 404s with the current setup (although some still happen)
    m32ex04 has too complex of a model -> animation pipeline for current logic
    After looking some more, it seems like the OLO name can refer to multiple models, it's not always 1:1 (but usually is anyway), see b50vs00 for an example
    Probably best to make a map of all the chara arc files, then use that to pull models from olo names.
    Also need to filter some olo objects that don't have PMOs at all, and only collision data
    Handle models that have PMOs and PAMs in seperate arcs (for whatever reason...) like m24ex00
Figure out why the shop moogle has its balloon upside down and aurora's crown is sideways (???)
    b01ls00 is also very messed up, has extra geometry not attached to skeleton
    g27dc00 has stray geometry as well
Filter out objects that are meant for collision but still have visible geometry, usually in boss rooms
Check for texture scorlling within PMOs themselves like DDD. Right now they are only from PMP material definitjons
Have better functions for parsing arc files instead of "parseXFromARC" convention
Do another pass at animations for gimmicks (most were skipped during the first pass since the parsing still had an issue)

Nice to have

Clean up TIM2 decoding and data structures
    Possibly integrate with existing PS2 decoding? Couldn't get it to work but the data structures are very similar if not the same
Add TXAs
    PMP-level TXAs have data offsets that are out of range, I can't figure out how to handle those. PMO-level TXAs are almost
    the same as DDD, except their data is just the pixel/image portion of a TIM2, rather than the entire texture. This will
    require a lot of tweaking to how textures are loaded and re-parsed, since the pixels need to be overridden from the base
    texture. Might be best to re-write the entire TIM2 code with TXAs in mind, instead of trying to jerry-rig the existing stuff.
    Honestly, this is a lot of effort with little pay off, since TXAs are less common in BBS than in DDD (other than eye blinking/mouth moving while talking).
    The parsing is already present in bin_bbs.ts, just not used right now.
Particle effects (if used widely outside of weapons/attacks)
Save points and other interactables that aren't proper objects but still visible in game

May your heart be your guiding key
*/

// Adapted room names from https://openkh.dev/bbs/dictionary/worlds.html and KH Wiki
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
    new Room("SW12", "Mountain Trail"),
    new Room("SW01", "Mine Entrance"),
    new Room("SW02", "The Mine"),
    new Room("SW07", "Flower Glade"),
    new Room("SW08", "Deep Woods"),
    new Room("SW10", "Cottage Clearing"),
    new Room("SW11", "The Cottage"),
    new Room("SW06", "Courtyard"),
    new Room("SW03", "Vault"),
    new Room("SW05", "Underground Waterway"),
    new Room("SW04", "Magic Mirror Chamber"),
    new Room("SW09", "Inside the Mirror"),
    "Castle of Dreams",
    new Room("CD01", "Cinderella's Room"),
    new Room("CD02", "Mousehole"),
    new Room("CD03", "Wardrobe Room"),
    new Room("CD13", "Wardrobe Room (Boss)"),
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
    new Room("SB02", "Gates"), // default?
    new Room("SB39", "Gates"), // story event?
    new Room("SB03", "Maleficent's Throne"),
    new Room("SB04", "Dungeon"),
    new Room("SB05", "Hall"), // default?
    new Room("SB17", "Hall"), // story event?
    new Room("SB19", "Hall (Ventus)"),
    new Room("SB38", "Hall (Cutscene)"),
    new Room("SB06", "Forbidden Mountain"),
    new Room("SB07", "Waterside"),
    new Room("SB08", "Forest Clearing"),
    new Room("SB09", "Bridge"),
    new Room("SB10", "Bridge (Boss)"),
    new Room("SB11", "Audience Chamber"),
    new Room("SB12", "Audience Chamber (Boss)"),
    new Room("SB14", "Hallway"),
    new Room("SB16", "Tower Room"),
    new Room("SB15", "Aurora's Chamber (Bed)"), // cutscene maybe? don't remember...
    new Room("SB18", "Aurora's Chamber (No Bed)"), // has map chest and shop moogle, default?
    "Myseterious Tower", // yt = yensid tower
    new Room("YT02", "Mysterious Tower"),
    new Room("YT03", "Entrance"),
    new Room("YT04", "Sorcerer's Chamber"),
    new Room("YT01", "Sorcerer's Chamber"), // cutscene? only has olos for ventus and generic
    "Radiant Garden",
    new Room("RG03", "Central Square"),
    new Room("RG13", "Central Square (Night)"),
    new Room("RG14", "Central Square (Boss)"),
    new Room("RG05", "Castle Town"),
    new Room("RG08", "Merlin's House"),
    new Room("RG07", "Fountain Court"),
    new Room("RG04", "Aqueduct"),
    new Room("RG06", "Reactor"),
    new Room("RG09", "Gardens"),
    new Room("RG10", "Front Doors"),
    new Room("RG02", "Entryway"),
    new Room("RG01", "Outer Garden"),
    new Room("RG12", "Outer Gardens"),
    new Room("RG11", "Purification Facility"),
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
    new Room("LS12", "Ship Corridor"),
    new Room("LS05", "Control Room"),
    new Room("LS06", "Containment Pod"),
    new Room("LS07", "Ship Hub"),
    new Room("LS08", "Machinery Bay"),
    new Room("LS09", "Launch Deck"),
    new Room("LS14", "Bay Access"),
    new Room("LS10", "Ship Exterior"),
    new Room("LS11", "Outer Space"),
    new Room("LS13", "Lanes Between"),
    "Destiny Islands",
    new Room("DI01", "Beach"),
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
    "Disney Town",
    new Room("DC02", "Main Plaza"),
    new Room("DC03", "Fruitball Court"),
    new Room("DC14", "Fruitball (Minigame)"),
    new Room("DC13", "Ice Cream Beat"),
    new Room("DC06", "Gizmo Gallery"),
    new Room("DC07", "Pete's Rec Room"),
    new Room("DC05", "Raceway"),
    new Room("DC12", "Raceway Registration"),
    new Room("DC04", "Racecourse (Country Chase)"),
    new Room("DC09", "Racecourse (Disney Drive)"),
    new Room("DC08", "Racecourse (Grand Spree)"),
    new Room("DC10", "Racecourse (Castle Circuit)"),
    new Room("DC01", "Library"),
    new Room("DC11", "Lanes Between"),
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
    new Room("KG09", "Keyblade Graveyard (Under the Cliff)"),
    new Room("KG12", "Keyblade Graveyard (Under the Cliff) (Boss)"),
    new Room("KG55", "Keyblade Graveyard (Cliff Top)"),
    new Room("KG10", "Keyblade Graveyard (Cliff Top) (Boss)"),
    new Room("KG11", "Will's Cage"),
    new Room("KG50", "Ventus's Mind"),
    new Room("KG51", "Ventus's Mind (Boss)"),
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
    new Room("BD19", "Peter Pan BG"),
    new Room("BD12", "Disney Castle BG"),
    new Room("BD18", "Winnie the Pooh BG"),
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