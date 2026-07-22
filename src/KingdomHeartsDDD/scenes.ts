import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder } from "../TextureHolder";
import { SceneGfx } from "../viewer";
import { DreamDropParser, DreamDropPMO, DreamDropPMP } from "./bin";
import { DreamDropCTRTexture, DreamDropCTRTFormat, decodeDreamDropCTRT } from "./texture";
import { Texture as ViewerTexture } from "../viewer.js";
import { DreamDropRoomRenderer } from "./render";
import { getDreamDropRoomConfig, DreamDropRoomConfig, DREAMDROP_INVALID_SETDATA, DREAMDROP_VALID_DROP_OLO, DREAMDROP_VALID_OLO, DREAMDROP_NO_CULL_ROOMS } from "./config/room";
import { COOL_BLUE_COLOR, EYE_ICON, MultiSelect, Panel } from "../ui";
import { DREAMDROP_PAM, DREAMDROP_TXA, DREAMDROP_VALID_BOSS, DREAMDROP_VALID_D_OBJ, DREAMDROP_VALID_E_OBJ, DREAMDROP_VALID_ENEMY, DREAMDROP_VALID_F_OBJ, DREAMDROP_VALID_GIM, DREAMDROP_VALID_HIGH, DREAMDROP_VALID_NPC, DREAMDROP_VALID_PC, DREAMDROP_VALID_WEP } from "./config/data";
import { LuxObjectSet, LuxOLOInstance, LuxPVD, LuxRenderer, LuxRoomObjects, LuxSkeletalAnimation, LuxTXA } from "./lux";

function getCharaSubDirectory(name: string) {
    switch (name.substring(0, 1).toLowerCase()) {
        case "b":
            return "boss";
        case "d":
            return "d_obj";
        case "e":
            return "e_obj";
        case "m":
            return "enemy";
        case "f":
            return "f_obj";
        case "g":
            return "gim";
        case "h":
            return "high";
        case "n":
            return "npc";
        case "p":
            return "pc";
        case "w":
            return "wep";
        default:
            throw `Unknown chara prefix for \"${name}\"`;
    }
}

function getPrettyDataSetName(name: string) {
    const n = name.toLowerCase();
    if (n.includes("ex-map")) {
        return "Objects (EX)";
    } else if (n.includes("so-map")) {
        return "Objects (Sora)";
    } else if (n.includes("ri-map")) {
        return "Objects (Riku)";
    } else if (n.includes("ex-btl")) {
        return "Enemies (EX)";
    } else if (n.includes("so-btl")) {
        return "Enemies (Sora)";
    } else if (n.includes("ri-btl")) {
        return "Enemies (Riku)";
    } else {
        return name;
    }
}

class Renderer extends LuxRenderer {
    constructor(device: GfxDevice, pmp: DreamDropPMP, pvd: LuxPVD, objects: LuxRoomObjects, txas: LuxTXA[], cullingOverride: boolean, private config?: DreamDropRoomConfig) {
        super(device, pvd.clearColor, cullingOverride);

        const ctrts = [...pmp.ctrts];
        for (const model of objects.models.values()) {
            ctrts.push(...(model as DreamDropPMO).ctrts);
        }
        for (const txa of txas) {
            const ctrt = ctrts.find(t => t.name === txa.textureName)!;
            const animation = txa.animations[txa.defaultAnimationIndex];
            if (!animation) {
                continue;
            }
            for (let i = 0; i < animation.frames.length; i++) {
                ctrts.push({
                    name: `${ctrt.name}_${animation.name}_${i}`,
                    format: ctrt.format, width: ctrt.width, height: ctrt.height,
                    data: animation.frames[i].data
                });
            }
        }

        this.textures = Array(ctrts.length);
        for (let i = 0; i < ctrts.length; i++) {
            const pixels = decodeDreamDropCTRT(ctrts[i]);
            const t = new DreamDropCTRTexture(device, ctrts[i].name, ctrts[i].width, ctrts[i].height, pixels, ctrts[i].format);
            this.textures[i] = t;
        }

        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = {
                gfxTexture: this.textures[i].gfxTexture,
                extraInfo: new Map([["Format", `${DreamDropCTRTFormat[(this.textures[i] as DreamDropCTRTexture).format]}`]])
            };
        }
        viewerTextures.sort((a, b) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!));
        this.textureHolder = new FakeTextureHolder(viewerTextures);

        this.roomRenderer = new DreamDropRoomRenderer(this.renderHelper.renderCache, pmp, this.textures, objects, txas, pvd, this.config);
        // sync culling override with ui toggle
        this.roomRenderer.setCullingOverride(cullingOverride);
    }

    protected override getSetPanel() {
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
            if (!this.config || !this.config.defaultSets) {
                select.setItemSelected(0, true);
            } else if (this.config && this.config.defaultSets) {
                for (let i = 0; i < setNames.length; i++) {
                    select.setItemSelected(i, this.config.defaultSets.includes(i));
                }
            }
        } else {
            setPanel.setVisible(false);
        }
        setPanel.contents.appendChild(select.elem);
        return setPanel;
    }

    protected override isPlayerCharacterModel(name: string) {
        return name.toLowerCase().startsWith("p_");
    }
}

const pathBase = "KingdomHeartsDDD";
class Room implements SceneDesc {
    constructor(public id: string, public name: string) {

    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const pmpName = this.id.substring(0, 2) + "_" + this.id.substring(2, 4);
        const pmpFile = await context.dataFetcher.fetchData(`${pathBase}/map/${pmpName}.pmp`);
        const pmp = new DreamDropParser(pmpFile).parsePMP(this.id);

        const config = getDreamDropRoomConfig(this.id);
        if (config && config.externalCTT) {
            for (const ctt of config.externalCTT) {
                const cttFile = await context.dataFetcher.fetchData(`${pathBase}/map/${ctt}.ctt`);
                const ctrt = new DreamDropParser(cttFile).parseCTRT(0, ctt);
                if (ctrt) {
                    pmp.ctrts.push(ctrt);
                }
            }
        }

        const txas: LuxTXA[] = [];
        if (config && config.hasTXA) {
            const txaFile = await context.dataFetcher.fetchData(`${pathBase}/map/${pmpName}.txa`);
            txas.push(...new DreamDropParser(txaFile).parseTXA(pmp.ctrts));
        }

        const sets: LuxObjectSet[] = [];
        if (!DREAMDROP_INVALID_SETDATA.includes(this.id)) {
            const setDataFile = await context.dataFetcher.fetchData(`${pathBase}/setdata/${this.id}set.bin`);
            const setData = new DreamDropParser(setDataFile).parseSetData();
            for (const set of setData) {
                const instances: LuxOLOInstance[] = [];
                for (const oloName of set.olos) {
                    if (!DREAMDROP_VALID_OLO.has(this.id) || !DREAMDROP_VALID_OLO.get(this.id)!.includes(oloName)) {
                        continue;
                    }
                    const oloFile = await context.dataFetcher.fetchData(`${pathBase}/setdata/${this.id}-${oloName}.olo`);
                    const olo = new DreamDropParser(oloFile).parseOLO();
                    instances.push(...olo.objects);
                }
                if (instances.length > 0) {
                    sets.push({ name: set.name, instances });
                }
            }
        }

        if (DREAMDROP_VALID_DROP_OLO.includes(this.id)) {
            for (const [setName, oloName] of new Map<string, string>([["Dive Objects", this.id], ["Dive Ring Prizes", "d_ring_prize"]])) {
                const oloFile = await context.dataFetcher.fetchData(`${pathBase}/minigame/${oloName}.olo`);
                const olo = new DreamDropParser(oloFile).parseOLO();
                sets.push({ name: setName, instances: olo.objects });
            }
        }

        const models: Map<string, DreamDropPMO> = new Map();
        const animations: Map<string, LuxSkeletalAnimation> = new Map();
        const validModels = [...DREAMDROP_VALID_BOSS, ...DREAMDROP_VALID_D_OBJ, ...DREAMDROP_VALID_E_OBJ, ...DREAMDROP_VALID_ENEMY, ...DREAMDROP_VALID_F_OBJ,
            ...DREAMDROP_VALID_GIM, ...DREAMDROP_VALID_HIGH, ...DREAMDROP_VALID_NPC, ...DREAMDROP_VALID_PC, ...DREAMDROP_VALID_WEP];
        for (const set of sets) {
            for (const instance of set.instances) {
                if (models.has(instance.name) || !validModels.includes(instance.name)) {
                    continue;
                }
                const subdir = getCharaSubDirectory(instance.name);
                const pmoFile = await context.dataFetcher.fetchData(`${pathBase}/chara/${subdir}/${instance.name}.pmo`);
                const pmo = new DreamDropParser(pmoFile).parsePMO(undefined, true, instance.name);
                models.set(instance.name, pmo);
                if (DREAMDROP_PAM.has(instance.name) && !animations.has(instance.name)) {
                    const a = DREAMDROP_PAM.get(instance.name)!;
                    const pamFile = await context.dataFetcher.fetchData(`${pathBase}/chara/${subdir}/${a.name}.pam`);
                    const pam = new DreamDropParser(pamFile).parsePAM();
                    animations.set(instance.name, pam.animations[a.index]);
                }
            }
        }
        for (const model of models.values()) {
            if (DREAMDROP_TXA.includes(model.name)) {
                const txaFile = await context.dataFetcher.fetchData(`${pathBase}/chara/${getCharaSubDirectory(model.name)}/${model.name}.txa`);
                txas.push(...new DreamDropParser(txaFile).parseTXA(model.ctrts));
            }
        }

        const pvdFile = await context.dataFetcher.fetchData(`${pathBase}/map/${pmpName}.pvd`, { allow404: true });
        let pvd = pvdFile.byteLength > 0 ? new DreamDropParser(pvdFile).parsePVD() : undefined;
        if (!pvd) {
            pvd = { clearColor: [0, 0, 0, 1], fogColor: [1, 1, 1, 0], fogNear: 400, fogFar: 480 };
        } else {
            pvd.clearColor = pvd.clearColor.map(c => c / 255);
            pvd.fogColor = pvd.fogColor.map(c => c / 255);
        }

        return new Renderer(device, pmp, pvd, { sets, models, animations }, txas, DREAMDROP_NO_CULL_ROOMS.includes(this.id), config);
    }
}

/*
TODO

Find a way to do proper depth sorting. Bboxes for room parts are inconsistent, so typical approaches completely break some rooms (yt04 for example)
    I've tried different render inst lists, depth (vec distance & aabb) and material based sort keys, and different permutations of mega state
    flags/blending options. These all introduce more problems than they fix, so the current configuration is the "least bad" of them all.
    See the water in destiny islands or the rainbow colored arch signs in the fourth district for examples where the sorting is wrong. Depth write
    may also be related to this. A possible shape flag for it is 256, but testing has been inconsistent so far
TXAs need some touchup
    What determines if the textures are blended needs refinement (right now it's more of a heuristic, supposedly the shape attribute could be used?)
    There's also an edge case where the same animation will get out of sync across two separate models when one of them is culled
        This is not a problem when it's separate instances of the same model, that case is handled. It only happens when two entirely separate
        models happen to use the same txa. For an example, look at the flashing lights at the entrance of pi11 and move one of them in and out of sight
    How frames are handled that have displayFrames as 0 might need tweaking, right need it just defaults to 1.5 since that matches the game the best
    Also want to figure out how eye blinking TXAs should work since they're way too fast when used as-is (might need some rng for the timing)
    Add the ability the choose specific textures to exclude from animation (n_ex020 for example needs the shadow to not pulse when idle)
Depth bias/poly offset needs more work to fix z-fighting. Only some z-fighting is fixed with the current logic
    Mostly the buildings in twtnw are affected by this (or something very similar)
    There's also pretty bad z-fighting on the ground path in the Traverse Town garden
Figure out a better solution for back-face culling based on a shape's attribute
    Right now any room that uses mirrored geometry is manually exempt from this since it makes half the room invisible. However, the current logic
    is needed to fix several other rooms, like the frozen monstro and some tents in hunchback. The shape attributes are either just inconsistent or
    there's some other logic that needs to be applied instead (however it is definitely per-shape, not per-model, see g_fa160 for an example of mixed culling).
    The problem is that the specific room parts which are affected by this do not have different shape attributes than parts/objects that should/should not
    their culling enabled, so there's no way to tell based on the data (vertex flags are only for parsing and don't have direct influence on rendering afaik).
    Another thing is that the parts affected by this have the same pmp model id and the exact same geometry, but their pmp scale x is set to either 1 or -1,
    see nd15_206_19 and nd15_207_19 for an example. The scale obviously is for the mirroring, but there's not any other discernable differences between them. It's
    also not possible, as far as the shape attributes are concerned, that these models/shape don't have culling at all, since other shapes which use culling
    in the game also have shape attribute values of both 0 and 1
Figure out how world map objects are loaded
    The models exist in chara/gim/g_wm*. I can't find any OLO files that reference them.
    Within _grpdef/wm01.rgr, the model names and some MCV files are referenced. It's possible that
    the world map is technically handled as a cutscene, therefore the loading of models is entirely different
Investigate di60 some more to see if the text of the credits can be loaded (in English)
Shadows in the third district are the wrong color, they appear as black in game (they're correct everywhere else though???)
Add more descriptors to duplicate room names, such as "(Boss)" or "(Cutscene)", mostly in tron, pinocchio and twtnw
Model fixes
    Spellican's broomstick is stretched
    Both rhino variants have the spike ball visible (it doesn't hide when animated, as if the bone weights were to be set to 0)
    Hunchback boss has its chains missing when animated
    Tron turrets have their left arm backwards when animated
    Shop moogle's balloon is upside down (happens in BBS too, which uses almost the exact same model)
    Some of the post office pistons are rotated backwards
Figure out how to handle models with different parts in separate files
    These are defined in _grpdef/*.rgr, for example the skeleton t-rex has its head as a separate model
Clean up unused data leftover from parsing (numbers, flags, etc not used for rendering or anything else)
    Most of it gets garbage collected anyway, but might as well to make debugging a little cleaner
Rigid skinning should probably be checked for and applied at the model level, rather than the shape level
    There may also be a model flag that indicates this, rather than checking to see if the weights are all zero
Make a whitelist of PVD files to avoid 404s for the few rooms that don't have them (similar to how OLOs work)
Try to combine meshes of room parts with the same texture together to reduce number of draw calls
    This might make the frustum culling less impactful, but some rooms reaching over 1000 draw calls is ridiulous...
Trees on destiny island have a weird line on their leaf texure, issue with decoding or alpha check in shader?
    This was not there during initial implementation, which was all done on di01, so something must have changed somewhere
The container suspended from the ceiling (gl_tl110) should be moving up and down in tl05
    The animation is there for it and works fine, but only one of these containers actually moves in the
    game, so it would require additional code to enable per-instance animation application (as opposed to all instances of the model)
Stray geometry in rg02?
The timing of UV scrolling and TXAs may need some tweaking or further confirmation
    UV scrolling uses a multipler for 60 FPS, even though the game runs at 30 (if you're lucky). This was done using a side by side comparsion
    with an actual 3DS running the game. A frame time of 30 made the scrolling too slow. For TXAs, using a frame time of 30 resulted in a better
    match than 60, but the displayFrames value is less understood and just my best guess for how to use it

Nice to have

Save points (could just be glorified particle effects?)
More accurate "lighting," like on the neon signs and windows in Traverse Town and TWTNW
    This seems to be a simple form of bloom, likely determined by a model or shape's flags or attribute value
    Possibly remove the hardcoded increase in brightness in the shader as well (without this, it's too dark compared to the game, which is already dark)
Shimmering/pulsing effect on objects that can have flowmotion used on them
Battle/link portals
    The files are in /mission, but need to figure out which room uses which olo file since only the world ID is in the name
    These olo files are only the enemy/companion dream eaters and don't include the portal itself or its location
Look into handling some animation/movement logic that's driven by the Lua scripts in /game, for example g_tw200 moving in the post office
    These will need to be decompiled on the fly, however initial attempts have resulted in only a few lines being readable
Look into how boss models are loaded, since only a few of them are loaded with OLOs
Investigate other file types such as GPL, SEB, EAD and ABC (known types listed in bin.ts)

May your heart be your guiding key
*/

// Adapted room names from https://openkh.dev/ddd/dictionary/worlds.html and TCRF
const id = "KHDDD";
const name = "Kingdom Hearts 3D: Dream Drop Distance";
const sceneDescs = [
    "Destiny Islands",
    new Room("di01", "Beach"),
    new Room("di02", "Beach (Evening)"),
    new Room("di03", "Beach (Night)"),
    new Room("di05", "Combat Tutorial"),
    new Room("di60", "Dive (Sora)"),
    "Traverse Town", // tw = the world ends with you
    new Room("tw01", "First District"),
    new Room("tw02", "Second District"),
    new Room("tw03", "Third District"),
    new Room("tw14", "Third District (No Power)"),
    new Room("tw07", "Post Office"),
    new Room("tw08", "Back Streets"),
    new Room("tw04", "Fourth District"),
    new Room("tw05", "Fifth District"),
    new Room("tw10", "Fifth District (Boss)"),
    new Room("tw06", "Garden"),
    new Room("tw11", "Garden (Boss)"),
    new Room("tw09", "Fountain Plaza"),
    new Room("tw12", "Fountain Plaza (Boss)"),
    new Room("tw60", "Dive (Sora)"),
    new Room("tw61", "Dive (Riku)"),
    "La Cité des Cloches", // nd = the hunchback of notre-dame
    new Room("nd10", "Town"),
    new Room("nd01", "Square"),
    new Room("nd02", "Square (Burning)"),
    new Room("nd19", "Square (Sora Boss)"),
    new Room("nd14", "Square (Riku Boss)"),
    new Room("nd03", "Nave"),
    new Room("nd15", "Nave (Burning)"),
    new Room("nd04", "Bell Tower"),
    new Room("nd16", "Bell Tower"),
    new Room("nd09", "Court of Miracles"),
    new Room("nd11", "Bridge"),
    new Room("nd18", "Bridge (Burning)"),
    new Room("nd13", "Windmill"),
    new Room("nd17", "Windmill (Burning)"),
    new Room("nd12", "Outskirts"),
    new Room("nd05", "Graveyard Gate"),
    new Room("nd07", "Old Graveyard"),
    new Room("nd06", "Tunnels"),
    new Room("nd08", "Catacombs"),
    new Room("nd60", "Dive (Sora)"),
    new Room("nd61", "Dive (Riku)"),
    "The Grid", // tl = tron legacy
    new Room("tl01", "Portal"),
    new Room("tl17", "Portal"),
    new Room("tl02", "Portal Stairs"),
    new Room("tl04", "Throneship"),
    new Room("tl05", "Rectifier 1F"),
    new Room("tl13", "Rectifier 2F"),
    new Room("tl06", "Solar Sailer"),
    new Room("tl15", "Solar Sailer"),
    new Room("tl18", "Solar Sailer"),
    new Room("tl07", "Docks"),
    new Room("tl08", "City"),
    new Room("tl09", "Throughput"),
    new Room("tl10", "Bridge"),
    new Room("tl11", "Light Cycle Arena"),
    new Room("tl16", "Light Cycle Arena"),
    new Room("tl12", "Stadium"),
    new Room("tl14", "Flynn's Hideout"),
    new Room("tl61", "Dive (Sora)"),
    new Room("tl60", "Dive (Riku)"),
    "Prankster's Paradise", // pi = pinocchio
    new Room("pi01", "Amusement Park"),
    new Room("pi11", "Windup Way"),
    new Room("pi12", "Circus"),
    new Room("pi04", "Promontory"),
    new Room("pi16", "Promontory"),
    new Room("pi02", "Ocean Floor"),
    new Room("pi03", "Ocean Depths"),
    new Room("pi19", "Ocean Depths"),
    new Room("pi14", "Ocean Depths (Floor)"),
    new Room("pi17", "Ocean Surface"),
    new Room("pi05", "Ocean Surface (Boss)"),
    new Room("pi13", "Ocean Surface (Reality Shift)"),
    new Room("pi06", "Monstro: Mouth"),
    new Room("pi08", "Monstro: Gullet"),
    new Room("pi07", "Monstro: Belly"),
    new Room("pi18", "Monstro: Belly (Cutscene)"),
    new Room("pi09", "Monstro: Cavity"),
    new Room("pi10", "Monstro: Bowels"),
    new Room("pi60", "Dive (Sora)"),
    new Room("pi61", "Dive (Riku)"),
    "Country of the Musketeers", // tm = the three musketeers
    new Room("tm14", "Mountain Road"),
    new Room("tm08", "Training Yard"),
    new Room("tm15", "Training Yard (Night)"),
    new Room("tm01", "The Opéra (Sora)"),
    new Room("tm17", "The Opéra (Riku)"),
    new Room("tm02", "Grand Lobby"),
    new Room("tm03", "Theatre"),
    new Room("tm16", "Theatre (Boss)"),
    new Room("tm12", "Backstage"),
    new Room("tm10", "Green Room"),
    new Room("tm11", "Machine Room"),
    new Room("tm05", "Tower Road"),
    new Room("tm06", "Tower"),
    new Room("tm09", "Shore"),
    new Room("tm04", "Mont Saint-Michel"),
    new Room("tm07", "Dungeon"),
    new Room("tm13", "Cell"),
    new Room("tm60", "Dive (Sora)"),
    new Room("tm61", "Dive (Riku)"),
    "Symphony of Sorcery", // fa = fantasia
    new Room("fa15", "Chamber"),
    new Room("fa16", "Chamber (Flooded)"),
    new Room("fa19", "Tower Entrance (Flooded)"),
    new Room("fa02", "Cloudwalk"),
    new Room("fa03", "Glen"),
    new Room("fa05", "Fields"),
    new Room("fa06", "Moonlight Wood"),
    new Room("fa07", "Golden Wood"),
    new Room("fa09", "Snowgleam Wood"),
    new Room("fa10", "Evil Grounds"),
    new Room("fa01", "Precipice"),
    new Room("fa11", "Precipice (Boss)"),
    new Room("fa62", "Chernabog (Boss Dive)"),
    new Room("fa60", "Dive (Sora)"),
    new Room("fa61", "Dive (Riku)"),
    "The World That Never Was", // eh = ???
    new Room("eh13", "Memory's Skyscraper"),
    new Room("eh01", "Avenue to Dreams"),
    new Room("eh02", "Contorted City"),
    new Room("eh03", "Nightmarish Abyss"),
    new Room("eh20", "Nightmarish Abyss (Cutscene)"),
    new Room("eh12", "Nightmarish Abyss (Boss)"),
    new Room("eh04", "Delusive Beginning"),
    new Room("eh05", "Walk of Delusions"),
    new Room("eh06", "Fact within Fiction"),
    new Room("eh07", "Verge of Chaos"),
    new Room("eh08", "Sanctum of Time"),
    new Room("eh09", "Darkness's Call"),
    new Room("eh10", "Darkest End"),
    new Room("eh14", "Brink of Despair"),
    new Room("eh11", "Where Nothing Gathers"),
    new Room("eh60", "Dive (Sora)"),
    new Room("eh61", "Dive (Riku)"),
    "Mysterious Tower", // yt = yensid tower
    new Room("yt01", "Chamber"),
    new Room("yt07", "Chamber (Open Door)"),
    new Room("yt02", "Tower"),
    new Room("yt03", "Tower Entrance"),
    new Room("yt06", "Station of Awakening"),
    new Room("yt04", "Station of Awakening (Boss)"),
    new Room("yt60", "Dive (Riku)"),
    "Radiant Garden",
    new Room("rg01", "Ansem's Study"),
    new Room("rg02", "Control Room"),
    new Room("rg04", "Castle Doors (Unused)"),
    new Room("rg06", "Castle Oblivion"),
    new Room("rg07", "Chamber of Waking"),
    new Room("rg03", "Station Plaza (Twilight Town)"),
    new Room("rg05", "Library (Disney Castle)"),
    new Room("rg08", "Dark Margin (Realm of Darkness)"),
    "Spirit Space", // de = dream eater
    new Room("de01", "Flick Rush"),
    new Room("de02", "Hexagonal Stage"),
    new Room("de03", "Final Round Stage"),
    new Room("de10", "Petting Plaza"),
    "World Map",
    new Room("wm01", "World Map"),
    "Treasure Planet (Unfinished)",
    new Room("tp01", "The Legacy's Deck"),
    "Unfinished Rooms",
    new Room("nd20", "nd20 Court of Miracles"),
    new Room("pi15", "pi15 Amusement Park"),
    new Room("tw13", "tw13 Fountain Plaza"),
    "Debug Rooms",
    new Room("fa04", "fa04 Debug"),
    new Room("fa08", "fa08 Debug"),
    new Room("fa12", "fa12 Debug"),
    new Room("fa17", "fa17 Debug"),
    new Room("fa18", "fa18 Debug"),
    new Room("tl03", "tl03 Debug"),
    new Room("tp02", "tp02 Debug"),
    new Room("tp03", "tp03 Debug"),
    new Room("tp04", "tp04 Debug"),
    new Room("tp05", "tp05 Debug"),
    new Room("tp06", "tp06 Debug"),
    new Room("tp07", "tp07 Debug"),
    new Room("tp08", "tp08 Debug"),
    new Room("tp09", "tp09 Debug"),
    new Room("tp10", "tp10 Debug"),
    new Room("tp11", "tp11 Debug")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
