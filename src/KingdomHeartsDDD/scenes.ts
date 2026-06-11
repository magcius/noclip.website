import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { DreamDropParser, DreamDropPMO, DreamDropPMP } from "./bin";
import { CTRTexture, CTRTFormat, decodeDreamDropCTRT } from "./texture";
import { Texture as ViewerTexture } from "../viewer.js";
import { DreamDropRoomRenderer } from "./render";
import { getDreamDropRoomConfig, DreamDropRoomConfig } from "./config/room";
import { COOL_BLUE_COLOR, EYE_ICON, LAYER_ICON, LayerPanel, MultiSelect, Panel } from "../ui";
import { DREAMDROP_PAM, DREAMDROP_TXA, DREAMDROP_VALID_BOSS, DREAMDROP_VALID_D_OBJ, DREAMDROP_VALID_E_OBJ, DREAMDROP_VALID_ENEMY, DREAMDROP_VALID_F_OBJ, DREAMDROP_VALID_GIM, DREAMDROP_VALID_HIGH, DREAMDROP_VALID_NPC, DREAMDROP_VALID_PC, DREAMDROP_VALID_WEP } from "./config/chara";
import { DREAMDROP_INVALID_SETDATA, DREAMDROP_VALID_OLO } from "./config/setdata";
import { LuxObjectSet, LuxOLOInstance, LuxRoomObjects, LuxSkeletalAnimation, LuxTexture, LuxTXA } from "./lux";

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

class Renderer implements SceneGfx {
    public textureHolder: TextureHolder;
    private roomRenderer: DreamDropRoomRenderer;
    private textures: LuxTexture[];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, pmp: DreamDropPMP, objects: LuxRoomObjects, txas: LuxTXA[], private config?: DreamDropRoomConfig) {
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
            const t = new CTRTexture(device, ctrts[i].name, ctrts[i].width, ctrts[i].height, pixels, ctrts[i].format);
            this.textures[i] = t;
        }

        const viewerTextures: ViewerTexture[] = Array(this.textures.length);
        for (let i = 0; i < this.textures.length; i++) {
            viewerTextures[i] = {
                gfxTexture: this.textures[i].gfxTexture,
                extraInfo: new Map([["Format", `${CTRTFormat[(this.textures[i] as CTRTexture).format]}`]])
            };
        }
        viewerTextures.sort((a, b) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!));
        this.textureHolder = new FakeTextureHolder(viewerTextures);

        this.renderHelper = new GfxRenderHelper(device);
        this.roomRenderer = new DreamDropRoomRenderer(this.renderHelper.renderCache, pmp, this.textures, objects, txas, this.config);
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
                    const uniqueInstances = instances.filter((instance, index, self) =>
                        index === self.findIndex((t) => (
                            t.name === instance.name &&
                            t.position[0] === instance.position[0] &&
                            t.position[1] === instance.position[1] &&
                            t.position[2] === instance.position[2] &&
                            t.rotation[0] === instance.rotation[0] &&
                            t.rotation[1] === instance.rotation[1] &&
                            t.rotation[2] === instance.rotation[2]
                        ))
                    );
                    sets.push({ name: set.name, instances: uniqueInstances });
                }
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
                    const pamFile = await context.dataFetcher.fetchData(`${pathBase}/chara/${subdir}/${DREAMDROP_PAM.get(instance.name)}.pam`);
                    const pam = new DreamDropParser(pamFile).parsePAM();
                    animations.set(instance.name, pam.animations[0]);
                }
            }
        }
        for (const model of models.values()) {
            if (DREAMDROP_TXA.includes(model.name)) {
                const txaFile = await context.dataFetcher.fetchData(`${pathBase}/chara/${getCharaSubDirectory(model.name)}/${model.name}.txa`);
                txas.push(...new DreamDropParser(txaFile).parseTXA(model.ctrts));
            }
        }

        return new Renderer(device, pmp, { sets, models, animations }, txas, config);
    }
}

/*
TODO

g_ex010 has a weird PMO format with no shapes or materials, fails at reading shape offsets
g_nd300 also can't be read
Proper depth sorting. Bboxes are inconsistent, so typical depth sorting completely breaks some rooms (yt04 for example)
Some skeletal animations might use hermite interpolation. Linear interpolation is assumed and some animations look wrong with it
    b_de060 and b_de140 for examples
TXAs need cleanup and the functionality to animate opacity between frames like in the game
    Most things look fine with the current implementation, but Monstro looks kind of weird without the fading
    Will probably need an altered shader that takes two texture inputs, idk how else to do it
Depth bias/poly offset needs more work to fix z-fighting. Only some z-fighting is fixed with the current logic
Figure out other ways level objects are loaded besides OLO (e.g. world map g objects)
Clean up class/interface names
Invesigate PMO model issue from BBS. Very rare here in DDD, but see Mickey in Musketeers for an example
    I thought it was a vertex color issue originally, but it actually seems like a problem with the UVs
    It's weird because only some parts of the same model have wrong UVs, while others are correct

May your heart be your guiding key
*/

// Adapted room names from https://openkh.dev/ddd/dictionary/worlds.html and TCRF
const id = "KHDDD";
const name = "Kingdom Hearts 3D: Dream Drop Distance";
const sceneDescs = [
    "Destiny Islands",
    new Room("di01", "Beach (Day)"),
    new Room("di02", "Beach (Evening)"),
    new Room("di03", "Beach (Night)"),
    new Room("di05", "Combat Tutorial"),
    "Traverse Town", // tw = the world ends with you
    new Room("tw01", "First District"),
    new Room("tw02", "Second District"),
    new Room("tw03", "Third District"),
    new Room("tw14", "Third District"),
    new Room("tw04", "Fourth District"),
    new Room("tw05", "Fifth District"),
    new Room("tw10", "Fifth District"),
    new Room("tw07", "Post Office"),
    new Room("tw06", "Garden"),
    new Room("tw11", "Garden (Boss)"),
    new Room("tw08", "Back Streets"),
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
    new Room("tl12", "Stadium (Boss)"),
    new Room("tl14", "Flynn's Hideout"),
    new Room("tl60", "Dive (Sora)"),
    new Room("tl61", "Dive (Riku)"),
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
    new Room("pi13", "Ocean Surface"),
    new Room("pi17", "Ocean Surface"),
    new Room("pi05", "Ocean Surface (Boss)"),
    new Room("pi06", "Monstro: Mouth"),
    new Room("pi07", "Monstro: Belly"),
    new Room("pi18", "Monstro: Belly"),
    new Room("pi08", "Monstro: Gullet"),
    new Room("pi09", "Monstro: Cavity"),
    new Room("pi10", "Monstro: Bowels"),
    new Room("pi60", "Dive (Sora)"),
    new Room("pi61", "Dive (Riku)"),
    "Country of the Musketeers", // tm = the three musketeers
    new Room("tm08", "Training Yard (Day)"),
    new Room("tm15", "Training Yard (Night)"),
    new Room("tm01", "The Opéra (Sora)"),
    new Room("tm17", "The Opéra (Riku)"),
    new Room("tm02", "Grand Lobby"),
    new Room("tm03", "Theatre"),
    new Room("tm16", "Theatre"),
    new Room("tm10", "Green Room"),
    new Room("tm11", "Machine Room"),
    new Room("tm12", "Backstage"),
    new Room("tm04", "Mont Saint-Michel"),
    new Room("tm05", "Tower Road"),
    new Room("tm06", "Tower"),
    new Room("tm07", "Dungeon"),
    new Room("tm09", "Shore"),
    new Room("tm13", "Cell"),
    new Room("tm14", "Mountain Road"),
    new Room("tm60", "Dive (Sora)"),
    new Room("tm61", "Dive (Riku)"),
    "Symphony of Sorcery", // fa = fantasia
    new Room("fa01", "Precipice"),
    new Room("fa02", "Cloudwalk"),
    new Room("fa03", "Glen"),
    new Room("fa05", "Fields"),
    new Room("fa06", "Moonlight Wood"),
    new Room("fa07", "Golden Wood"),
    new Room("fa09", "Snowgleam Wood"),
    new Room("fa10", "Evil Grounds"),
    new Room("fa11", "Precipice (Boss)"),
    new Room("fa15", "Chamber"),
    new Room("fa16", "Chamber (Flooded)"),
    new Room("fa19", "Tower Entrance (Flooded)"),
    new Room("fa60", "Dive (Sora)"),
    new Room("fa61", "Dive (Riku)"),
    new Room("fa62", "Chernabog (Boss Dive)"),
    "The World That Never Was", // eh = ???
    new Room("eh01", "Avenue to Dreams"),
    new Room("eh02", "Contorted City"),
    new Room("eh03", "Nightmarish Abyss"),
    new Room("eh12", "Nightmarish Abyss"),
    new Room("eh20", "Nightmarish Abyss"),
    new Room("eh13", "Memory's Skyscraper"),
    new Room("eh14", "Brink of Despair"),
    new Room("eh04", "Delusive Beginning"),
    new Room("eh05", "Walk of Delusions"),
    new Room("eh06", "Fact within Fiction"),
    new Room("eh07", "Verge of Chaos"),
    new Room("eh08", "Sanctum of Time"),
    new Room("eh09", "Darkness's Call"),
    new Room("eh10", "Darkest End"),
    new Room("eh11", "Where Nothing Gathers"),
    new Room("eh60", "Dive (Sora)"),
    new Room("eh61", "Dive (Riku)"),
    "Radiant Garden",
    new Room("rg01", "Ansem's Study"),
    new Room("rg02", "Control Room"),
    new Room("rg03", "Station Plaza (Twilight Town)"),
    new Room("rg04", "Castle Doors (Unused)"),
    new Room("rg05", "Library (Disney Castle)"),
    new Room("rg06", "Castle Oblivion"),
    new Room("rg07", "Chamber of Waking"),
    new Room("rg08", "Dark Margin"),
    "Mysterious Tower", // yt = yensid tower
    new Room("yt01", "Chamber"),
    new Room("yt07", "Chamber (Open Door)"),
    new Room("yt02", "Tower"),
    new Room("yt03", "Tower Entrance"),
    new Room("yt06", "Station of Awakening"),
    new Room("yt04", "Station of Awakening (Boss)"),
    new Room("yt60", "Dive (Riku)"),
    "Spirit Space", // de = dream eater
    new Room("de01", "Flick Rush"),
    new Room("de02", "Hexagonal Stage"),
    new Room("de03", "Final Round Stage"),
    new Room("de10", "Petting Plaza"),
    "World Map",
    new Room("wm01", "World Map"),
    "Treasure Planet",
    new Room("tp01", "The Legacy's Deck"),
    "Unfinished Rooms",
    new Room("di60", "di60 Ocean"),
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
