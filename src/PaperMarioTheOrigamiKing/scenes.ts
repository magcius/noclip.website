import * as BNTX from "../fres_nx/bntx.js";
import * as BFRES from "../fres_nx/bfres.js";
import { decompress } from "fzstd";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { PMTOKTextureHolder, ModelData, ModelRenderer, PMTOKRenderer } from "./render.js";
import { ELFType, MObjInstance, MObjModel, MObjType, parseELF } from "./bin_elf.js";
import { computeModelMatrixSRT, MathConstants } from "../MathHelpers.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { mat4 } from "gl-matrix";

export class ResourceSystem {
    // Adapated from Odyssey's class of the same name
    public textureHolder = new PMTOKTextureHolder();
    public bfresCache = new Map<string, BFRES.FRES | null>();
    public fmdlDataCache = new Map<string, ModelData | null>();
    private renderCache: GfxRenderCache;

    constructor(device: GfxDevice) {
        this.renderCache = new GfxRenderCache(device);
    }

    public loadBFRES(device: GfxDevice, name: string, bfres: BFRES.FRES) {
        if (!this.bfresCache.has(name)) {
            this.bfresCache.set(name, bfres);
            const bntxFile = bfres.externalFiles.find((f) => f.name === `${name}.bntx`);
            if (bntxFile) {
                const bntx = BNTX.parse(bntxFile.buffer);
                for (const t of bntx.textures) {
                    this.textureHolder.addTexture(device, t);
                }
            } else {
                console.warn("Could not find embedded textures in", name);
            }
            for (const fmdl of bfres.fmdl) {
                this.fmdlDataCache.set(fmdl.name, new ModelData(this.renderCache, fmdl));
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.renderCache.destroy();
        this.textureHolder.destroy(device);
        this.fmdlDataCache.forEach((value) => {
            if (value !== null) {
                value.destroy(device);
            }
        });
    }
}

function decompressZST(file: ArrayBufferSlice): ArrayBufferSlice {
    const d = decompress(file.createTypedArray(Uint8Array));
    return ArrayBufferSlice.fromView(d);
}

function isValidMobjDataWorldId(worldId: string): boolean {
    return worldId !== "W0";
}

const NO_MOBJS_LEVELS = ["W0C1_BasementWay", "W1G1_KinopioHouse", "W1G1_DokanRoom", "W1G3_GondolaLift"];
const NO_MOBJS_LEVELGROUPS = ["W0C2"];
const ALT_DISPOS_MOBJS = new Map<string, string[]>([
    // some levels have either no dispos_Mobj file or multiple. Unknown how to dynamically detect this
    ["W1C4_SecondFloor", ["dispos_Mobj_A", "dispos_Mobj_B"]]
]);

const pathBase = "PMTOK";
class PMTOKScene implements SceneDesc {
    public id: string;

    constructor(private path: string, public name: string) {
        this.id = this.path.split("/")[1];
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const isBattle = this.id.startsWith("Btl_");
        const bfresFile = decompressZST(await context.dataFetcher.fetchData(`${pathBase}/map/${this.path}.bfres.zst`));
        const commonBntxFile = decompressZST(await context.dataFetcher.fetchData(`${pathBase}/graphics/textures/common/default.bntx.zst`));
        const bfres = BFRES.parse(bfresFile);

        const resourceSystem = new ResourceSystem(device);
        const sceneRenderer = new PMTOKRenderer(device);
        resourceSystem.loadBFRES(device, this.id, bfres);

        // prepare map objects (mobj) for non-battle levels
        let mobjInstances = [];
        if (!isBattle && !NO_MOBJS_LEVELS.includes(this.id)) {
            const worldId = this.id.substring(0, 2);
            const levelGroupId = this.id.substring(0, 4);
            // get type data
            const mobjTypes: MObjType[] = [];
            for (const s of ["data_mobj_Cmn",
                isValidMobjDataWorldId(worldId) ? `data_mobj_${worldId}_Cmn` : "",
                !NO_MOBJS_LEVELGROUPS.includes(levelGroupId) ? `data_mobj_${levelGroupId}` : ""]) {
                if (s.length === 0) {
                    continue;
                }
                const file = decompressZST(await context.dataFetcher.fetchData(`${pathBase}/data/mobj/${s}.elf.zst`));
                mobjTypes.push(...parseELF(file, ELFType.DataMobj) as MObjType[]);
            }
            // get model data
            const mobjModels: MObjModel[] = [];
            for (const s of ["data_mobj_model_Cmn",
                isValidMobjDataWorldId(worldId) ? `data_mobj_model_${worldId}_Cmn` : "",
                !NO_MOBJS_LEVELGROUPS.includes(levelGroupId) ? `data_mobj_model_${levelGroupId}` : ""]) {
                if (s.length === 0) {
                    continue;
                }
                const file = decompressZST(await context.dataFetcher.fetchData(`${pathBase}/data/mobj_model/${s}.elf.zst`));
                mobjModels.push(...parseELF(file, ELFType.DataMobjModel) as MObjModel[]);
            }
            // get location data
            for (const disposName of ALT_DISPOS_MOBJS.has(this.id) ? ALT_DISPOS_MOBJS.get(this.id)! : ["dispos_Mobj"]) {
                const disposMobjFile = decompressZST(await context.dataFetcher.fetchData(`${pathBase}/data/map/${this.id}/${disposName}.elf.zst`));
                mobjInstances.push(...parseELF(disposMobjFile, ELFType.DisposMobj) as MObjInstance[]);
            }
            // get unique mobj types so each model is only loaded once
            const types: string[] = [];
            for (const instance of mobjInstances) {
                if (!types.includes(instance.typeId)) {
                    types.push(instance.typeId);
                }
            }
            // get location of each type's model file by traversing data ELF files (absurdly obtuse)
            for (const typeId of types) {
                const type = mobjTypes.find(m => m.id === typeId)!;
                const modelAG = mobjModels.find(m => m.id === type.modelId)!.assetGroups[0];
                for (const instance of mobjInstances) {
                    if (instance.typeId === typeId) {
                        // store model's name for later when patching its renderer with instance matrices
                        instance.resolvedModelName = modelAG.file;
                    }
                }
                const file = decompressZST(await context.dataFetcher.fetchData(`${pathBase}/${modelAG.directory}/${modelAG.file}.bfres.zst`));
                const mobjBFRES = BFRES.parse(file);
                resourceSystem.loadBFRES(device, modelAG.file, mobjBFRES);
            }
        }

        resourceSystem.textureHolder.addBNTXFile(device, commonBntxFile);
        sceneRenderer.setResourceSystem(resourceSystem);
        for (const fmdlData of resourceSystem.fmdlDataCache.values()) {
            if (fmdlData) {
                sceneRenderer.modelRenderers.push(new ModelRenderer(device, sceneRenderer.renderHelper.renderCache, resourceSystem.textureHolder, fmdlData));
            }
        }
        // patch each mobj renderer with instance matrices (prevent instances of same type using seperate copies of same model)
        for (const renderer of sceneRenderer.modelRenderers) {
            if (renderer.name.startsWith("Mobj_") && mobjInstances) {
                // get all instances that use this model
                const instances = [];
                for (const instance of mobjInstances) {
                    if (instance.resolvedModelName === renderer.name) {
                        instances.push(instance);
                    }
                }
                if (instances.length === 0) {
                    console.warn("Could not find any instances of", renderer.name);
                    continue;
                }
                renderer.modelMatrices = [];
                for (const instance of instances) {
                    // one-to-one model to renderer, but a renderer could have more than one instance of a model with different SRT
                    const m = mat4.create();
                    computeModelMatrixSRT(m, 1, 1, 1,
                        instance.rotation[0] * MathConstants.DEG_TO_RAD, instance.rotation[1] * MathConstants.DEG_TO_RAD, instance.rotation[2] * MathConstants.DEG_TO_RAD,
                        instance.position[0], instance.position[1], instance.position[2]);
                    renderer.modelMatrices.push(m);
                }
            }
        }

        return sceneRenderer;
    }
}

const id = "PMTOK";
const name = "Paper Mario: The Origami King";
const sceneDescs = [
    "Peach's Castle",
    new PMTOKScene("field/W0C1_CastleGate", "Outside the Castle"),
    new PMTOKScene("field/W0C1_EntranceWay", "Entrance Hall"),
    new PMTOKScene("field/W0C1_MainHall", "Main Hall"),
    new PMTOKScene("field/W0C1_HelpOlivia", "Dungeon (Rescue Olivia)"),
    new PMTOKScene("field/W0C1_WallHole", "Dungeon (Main)"),
    new PMTOKScene("field/W0C1_FoldRoom", "Dungeon (Help Bowser)"),
    new PMTOKScene("field/W0C1_BasementWay", "Dungeon (Exit)"),
    new PMTOKScene("field/W0C1_SpiralStair", "Spiral Staircase"),
    new PMTOKScene("field/W0C2_VolcanoCastle", "Top of the Volcano"),
    new PMTOKScene("battle/Btl_W0C1_PeachcastleA", "Battle - Peach's Castle"),
    "Whispering Woods",
    new PMTOKScene("field/W1C1_WakeUp", "Starting Area"),
    new PMTOKScene("field/W1C1_CastleView", "Castle View"),
    new PMTOKScene("field/W1C1_LostForest", "Whispering Woods"),
    new PMTOKScene("field/W1C1_BigStump", "Whispering Woods (Grandsappy)"),
    new PMTOKScene("field/W1C1_CampSite", "Camp Site"),
    new PMTOKScene("field/W1C1_LogHouse", "Log House"),
    new PMTOKScene("battle/Btl_W1C1_MountainA", "Battle - Whispering Woods"),
    "Toad Town",
    new PMTOKScene("field/W1G1_KinokoTown", "Toad Town"),
    new PMTOKScene("field/W1G1_KinokoTownEnding", "Toad Town (Ending)"),
    new PMTOKScene("field/W1G1_MuseumEntrance", "Museum (Entrance)"),
    new PMTOKScene("field/W1G1_ArtGallery", "Museum (Art Gallery)"),
    new PMTOKScene("field/W1G1_KinopioGallery", "Museum (Toad Gallery)"),
    new PMTOKScene("field/W1G1_CollectableGallery", "Museum (Collectible Gallery)"),
    new PMTOKScene("field/W1G1_EnemyGallery", "Museum (Enemy Gallery)"),
    new PMTOKScene("field/W1G1_SoundGallery", "Museum (Sound Gallery)"),
    new PMTOKScene("field/W1G1_HouseA", "House A"),
    new PMTOKScene("field/W1G1_HouseB", "House B"),
    new PMTOKScene("field/W1G1_HouseC", "House C"),
    new PMTOKScene("field/W1G1_HouseD", "House D"),
    new PMTOKScene("field/W1G1_HouseE", "House E"),
    new PMTOKScene("field/W1G1_HouseF", "House F"),
    new PMTOKScene("field/W1G1_HouseG", "House G"),
    new PMTOKScene("field/W1G1_KartRoad", "Kart Road"),
    new PMTOKScene("field/W1G1_KinopioHouse", "Toad House"),
    new PMTOKScene("field/W1G1_DokanRoom", "Pipe Room"),
    new PMTOKScene("field/W1G1_Shop", "Item Shop"),
    new PMTOKScene("field/W1G1_BattleLab", "Battle Lab"),
    new PMTOKScene("field/W1G1_StoreRoom", "Storage (Main Room)"),
    new PMTOKScene("field/W1G1_BackRoom", "Storage (Back Room)"),
    new PMTOKScene("field/W1G1_CastleGate", "Peach's Castle Rubble"),
    new PMTOKScene("battle/Btl_W1G1_KinokoTownA", "Battle - Toad Town"),
    new PMTOKScene("battle/Btl_W1G1_KinokoTownB", "Battle - Toad Town Underground"),
    "Graffiti Underground",
    new PMTOKScene("field/W1C2_BasementFirst", "1st Floor"),
    new PMTOKScene("field/W1C2_BasementSecond", "2nd Floor"),
    new PMTOKScene("field/W1C2_BasementThird", "3rd Floor"),
    new PMTOKScene("field/W1C2_TurnValve", "Main Room"),
    new PMTOKScene("field/W1C2_HelpKinopio", "Side Room"),
    new PMTOKScene("battle/Btl_W1C2_WaterwayA", "Battle - Graffiti Underground"),
    "Picnic Road",
    new PMTOKScene("field/W1G2_Hill", "Picnic Road"),
    new PMTOKScene("battle/Btl_W1G2_HillA", "Battle - Picnic Road"),
    "Overlook Moutain",
    new PMTOKScene("field/W1G3_Observatory", "Overlook Mountain"),
    new PMTOKScene("field/W1G3_GondolaLift", "Gondola Lift"),
    new PMTOKScene("battle/Btl_W1G3_ObservatoryA", "Battle - Overlook Mountain"),
    "Earth Vellumental Temple",
    new PMTOKScene("field/W1C3_UpDownRock", "Temple Path"),
    new PMTOKScene("field/W1C3_BigTurtle", "Entrance Room"),
    new PMTOKScene("field/W1C3_PushRock", "Side Room 1"),
    new PMTOKScene("field/W1C3_RollingTurtle", "Side Room 2"),
    new PMTOKScene("field/W1C3_BossArea", "Boss Room"),
    new PMTOKScene("battle/Btl_W1C3_CaveA", "Battle - Earth Vellumental Temple"),
    new PMTOKScene("battle/Btl_W1C3_CaveBossA", "Battle - Earth Vellumental Temple (Boss)"),
    "Overlook Tower",
    new PMTOKScene("field/W1C4_FirstFloor", "1st Floor"),
    new PMTOKScene("field/W1C4_SecondFloor", "2nd Floor"),
    new PMTOKScene("field/W1C4_ThirdFloor", "3rd Floor"),
    new PMTOKScene("field/W1C4_FourthFloor", "4th Floor"),
    new PMTOKScene("field/W1C4_Elevator", "Elevator"),
    new PMTOKScene("field/W1C4_BossArea", "Boss Area"),
    new PMTOKScene("battle/Btl_W1C4_TenbouTowerA", "Battle - Overlook Tower"),
    new PMTOKScene("battle/Btl_W1C4_TenbouTowerBossA", "Battle - Overlook Tower (Boss)"),
    "Blue Streamer",
    new PMTOKScene("field/W2C1_IgaguriValley", "Chestnut Valley"),
    new PMTOKScene("field/W2C2_BossArea", "Boss Area 1"),
    new PMTOKScene("field/W2C2_BoxMaze", "Box Maze"),
    new PMTOKScene("field/W2C2_CrabIntro", "Crab Intro"),
    new PMTOKScene("field/W2C2_CryDragon", "Cry Dragon"),
    new PMTOKScene("field/W2C2_EntranceDragon", "Entrance Dragon"),
    new PMTOKScene("field/W2C2_LoopWay", "Loop Way"),
    new PMTOKScene("field/W2C2_PanelGetA", "Panel Get A"),
    new PMTOKScene("field/W2C2_PanelGetB", "Panel Get B"),
    new PMTOKScene("field/W2C2_PuzzleEasy", "Puzzle Easy"),
    new PMTOKScene("field/W2C2_PuzzleHard", "Puzzle Hard"),
    new PMTOKScene("field/W2C3_DownRiver", "Eddy River"),
    new PMTOKScene("field/W2C4_CabinetStair", "Cabinet Stair"),
    new PMTOKScene("field/W2C4_EntranceWay", "Entrance Way"),
    new PMTOKScene("field/W2C4_GoalRoom", "Goal Room"),
    new PMTOKScene("field/W2C4_HangingScroll", "Hanging Scroll"),
    new PMTOKScene("field/W2C4_MaintenanceRoom", "Maintenance Room"),
    new PMTOKScene("field/W2C4_PressWall", "Press Wall"),
    new PMTOKScene("field/W2C4_SpearTrap", "Spear Trap"),
    new PMTOKScene("field/W2C4_StaffRoom", "Staff Room"),
    new PMTOKScene("field/W2C4_StartGoal", "Start Goal"),
    new PMTOKScene("field/W2C4_TatamiFlip", "Tatami Flip"),
    new PMTOKScene("field/W2C4_TeaHouse", "Tea House"),
    new PMTOKScene("field/W2C5_EntranceGate", "Entrance Gate"),
    new PMTOKScene("field/W2C5_FirstTheater", "First Theater"),
    new PMTOKScene("field/W2C5_SecondTheater", "Second Theater"),
    new PMTOKScene("field/W2C5_ThirdTheater", "Third Theater"),
    new PMTOKScene("field/W2C5_FourthTheater", "Fourth Theater"),
    new PMTOKScene("field/W2C5_Lobby", "Lobby"),
    new PMTOKScene("field/W2G1_MomijiMountain", "Autumn Mountain"),
    new PMTOKScene("field/W2G2_CastlePark", "Castle Park"),
    new PMTOKScene("field/W2G2_HitTarget", "Hit Target"),
    new PMTOKScene("field/W2G2_HouseA", "House A"),
    new PMTOKScene("field/W2G2_HouseE", "House E"),
    new PMTOKScene("field/W2G2_HouseF", "House F"),
    new PMTOKScene("field/W2G2_HouseH", "House H"),
    new PMTOKScene("field/W2G2_LongHouseA", "Long House A"),
    new PMTOKScene("field/W2G2_LongHouseB", "Long House B"),
    new PMTOKScene("field/W2G2_PhotoStudio", "Photo Studio"),
    new PMTOKScene("field/W2G2_Shop", "Shop"),
    new PMTOKScene("field/W2G2_ShopUpstairs", "Shop Upstairs"),
    new PMTOKScene("field/W2G2_StaffRoom", "Staff Room"),
    new PMTOKScene("field/W2G2_TeaRoom", "Tea Room"),
    new PMTOKScene("battle/Btl_W2C2_WaterCaveA", "Battle - Water Vellumental Shrine"),
    new PMTOKScene("battle/Btl_W2C2_WaterCaveBossA", "Battle - Water Vellumental Shrine (Boss)"),
    new PMTOKScene("battle/Btl_W2C4_NinjyayashikiA", "Battle - Shogun Studios"),
    new PMTOKScene("battle/Btl_W2C5_GekijouBossA", "Battle - Big Sho' Theater"),
    new PMTOKScene("battle/Btl_W2G1_MomijiMountainA", "Battle - Autumn Mountain"),
    new PMTOKScene("battle/Btl_W2G2_CastleParkA", "Battle - Castle Park"),
    "Yellow Streamer",
    new PMTOKScene("field/W3C1_FindOlivia", "Find Olivia"),
    new PMTOKScene("field/W3C1_LeftPassage", "Left Passage"),
    new PMTOKScene("field/W3C1_RoomA", "Room A"),
    new PMTOKScene("field/W3C1_Tunnel", "Breezy Tunnel"),
    new PMTOKScene("field/W3C1_TunnelExit", "Breezy Tunnel Exit"),
    new PMTOKScene("field/W3C3_BossArea", "Boss Area"),
    new PMTOKScene("field/W3C3_EntranceWay", "Entrance Way"),
    new PMTOKScene("field/W3C3_FallBird", "Fall Bird"),
    new PMTOKScene("field/W3C3_FireBucketA", "Fire Bucket"),
    new PMTOKScene("field/W3C3_FireJump", "Fire Jump"),
    new PMTOKScene("field/W3C3_LightMemory", "Light Memory"),
    new PMTOKScene("field/W3C4_Desert", "Desert"),
    new PMTOKScene("field/W3C4_DiscoEntrance", "Disco Entrance"),
    new PMTOKScene("field/W3C4_DiscoHall", "Disco Hall"),
    new PMTOKScene("field/W3C4_EntranceWay", "Entrance Way"),
    new PMTOKScene("field/W3C4_FallStatue", "Fall Statue"),
    new PMTOKScene("field/W3C4_FavoriteCD", "Favorite CD"),
    new PMTOKScene("field/W3C4_FourSwitch", "Four Switch"),
    new PMTOKScene("field/W3C4_HorrorWay", "Horror Way"),
    new PMTOKScene("field/W3C4_KanokeHall", "Kanoke Hall"),
    new PMTOKScene("field/W3C4_MoveStatue", "Move Statue"),
    new PMTOKScene("field/W3C4_MummyKuriboArea", "Mummy Kuribo Area"),
    new PMTOKScene("field/W3C4_Outside", "Outside"),
    new PMTOKScene("field/W3C4_PilePuzzle", "Pile Puzzle"),
    new PMTOKScene("field/W3C4_SpiderNest", "Spider Nest"),
    new PMTOKScene("field/W3C4_TreasureRoom", "Treasure Room"),
    new PMTOKScene("field/W3C4_TwoKinopio", "Two Kinopio"),
    new PMTOKScene("field/W3G1_Canyon", "Canyon"),
    new PMTOKScene("field/W3G2_Desert", "Desert"),
    new PMTOKScene("field/W3G2_DesertRuin", "Desert Ruin"),
    new PMTOKScene("field/W3G2_IceKinopio", "Ice Kinopio"),
    new PMTOKScene("field/W3G2_KinopioTop", "Kinopio Top"),
    new PMTOKScene("field/W3G2_KinopioTopRe", "Kinopio Top Revisit"),
    new PMTOKScene("field/W3G2_OasisLeft", "Oasis Left"),
    new PMTOKScene("field/W3G2_OasisRight", "Oasis Right"),
    new PMTOKScene("field/W3G2_RuinLeft", "Ruin Left"),
    new PMTOKScene("field/W3G2_RuinRight", "Ruin Right"),
    new PMTOKScene("field/W3G2_SamboArea", "Sambo Area"),
    new PMTOKScene("field/W3G3_HotelLobby", "Hotel Area"),
    new PMTOKScene("field/W3G3_HotelPool", "Hotel Pool"),
    new PMTOKScene("field/W3G3_HouseA", "House A (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseB", "House B (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseC", "House C (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseD", "House D (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseE", "House E (Shroom City)"),
    new PMTOKScene("field/W3G3_LeftPassage", "Left Passage"),
    new PMTOKScene("field/W3G3_LeftRoomL", "Left Room L"),
    new PMTOKScene("field/W3G3_LeftRoomR", "Left Room R"),
    new PMTOKScene("field/W3G3_Oasis", "Oasis"),
    new PMTOKScene("field/W3G3_RightPassage", "Right Passage"),
    new PMTOKScene("field/W3G3_SuiteRoom", "Suite Room"),
    new PMTOKScene("battle/Btl_W3C1_TunnelA", "Battle - Breezy Tunnel"),
    new PMTOKScene("battle/Btl_W3C3_FirecaveA", "Battle - Fire Vellumental Cave"),
    new PMTOKScene("battle/Btl_W3C3_FirecaveBossA", "Battle - Fire Vellumental Cave (Boss)"),
    new PMTOKScene("battle/Btl_W3C4_RuinA", "Battle - Temple of Shrooms A"),
    new PMTOKScene("battle/Btl_W3C4_RuinB", "Battle - Temple of Shrooms B"),
    new PMTOKScene("battle/Btl_W3C4_RuinBossA", "Battle - Temple of Shrooms (Boss)"),
    new PMTOKScene("battle/Btl_W3G2_DesertA", "Battle - Scorching Sandpaper Desert"),
    "Purple Streamer",
    new PMTOKScene("field/W4C1_ControlRoom", "Control Room (The Princess Peach)"),
    new PMTOKScene("field/W4C1_EngineRoom", "Engine Room (The Princess Peach)"),
    new PMTOKScene("field/W4C1_GessoArea", "Gesso Area"),
    new PMTOKScene("field/W4C1_GuestAreaFirst", "Guest Area (1st Floor)"),
    new PMTOKScene("field/W4C1_GuestAreaSecond", "Guest Area (2nd Floor)"),
    new PMTOKScene("field/W4C1_GuestPassage", "Guest Passage"),
    new PMTOKScene("field/W4C1_Lounge", "Lounge"),
    new PMTOKScene("field/W4C1_ShipDeck", "Deck (The Princess Peach)"),
    new PMTOKScene("field/W4C1_StaffAreaFirst", "Staff Area (1st Floor)"),
    new PMTOKScene("field/W4C1_StaffAreaSecond", "Staff Area (2nd Floor)"),
    new PMTOKScene("field/W4C1_StaffPassage", "Staff Passage"),
    new PMTOKScene("field/W4C1_StoreRoom", "Storage Room"),
    new PMTOKScene("field/W4C1_VIPRoom", "VIP Room"),
    new PMTOKScene("field/W4C2_BigJump", "Big Jump"),
    new PMTOKScene("field/W4C2_BossArea", "Boss Area"),
    new PMTOKScene("field/W4C2_IceEntrance", "Ice Entrance"),
    new PMTOKScene("field/W4C2_IceSlide", "Ice Slide"),
    new PMTOKScene("field/W4C2_JumpStart", "Jump Start"),
    new PMTOKScene("field/W4C2_PuzzleEasy", "Puzzle Easy"),
    new PMTOKScene("field/W4C2_PuzzleHard", "Puzzle Hard"),
    new PMTOKScene("field/W4C2_PuzzleResetA", "Puzzle Reset"),
    new PMTOKScene("field/W4C2_PuzzleTutorial", "Puzzle Tutorial"),
    new PMTOKScene("field/W4C2_SpiralStair", "Spiral Stair"),
    new PMTOKScene("field/W4C3_BossArea", "Boss Area"),
    new PMTOKScene("field/W4C3_EarthArea", "Earth Area"),
    new PMTOKScene("field/W4C3_EarthWater", "Earth Water"),
    new PMTOKScene("field/W4C3_FireArea", "Fire Area"),
    new PMTOKScene("field/W4C3_FireIce", "Fire Ice"),
    new PMTOKScene("field/W4C3_FourGod", "Four God"),
    new PMTOKScene("field/W4C3_OrbTower", "Orb Tower"),
    new PMTOKScene("field/W4C3_OutSideA", "Out Side A"),
    new PMTOKScene("field/W4C3_OutSideB", "Out Side B"),
    new PMTOKScene("field/W4C3_PuzzleReset", "Puzzle Reset"),
    new PMTOKScene("field/W4C3_WaterArea", "Water Area"),
    new PMTOKScene("field/W4G1_BasementStair", "Basement Stair"),
    new PMTOKScene("field/W4G1_CloverIsland", "Clover Island"),
    new PMTOKScene("field/W4G1_DokuroFirst", "Dokuro (1st Floor)"),
    new PMTOKScene("field/W4G1_DokuroSecond", "Dokuro (2nd Floor)"),
    new PMTOKScene("field/W4G1_DokuroIsland", "Dokuro Island"),
    new PMTOKScene("field/W4G1_HammerIsland", "Hammer Island"),
    new PMTOKScene("field/W4G1_HatenaIsland", "Hatena Island"),
    new PMTOKScene("field/W4G1_HeartIsland", "Heart Island"),
    new PMTOKScene("field/W4G1_KinokoIsland", "Mushroom Island"),
    new PMTOKScene("field/W4G1_KinopioHouse", "Kinopio House"),
    new PMTOKScene("field/W4G1_MoonIsland", "Full Moon Island"),
    new PMTOKScene("field/W4G1_Ocean", "The Great Sea"),
    new PMTOKScene("field/W4G1_OrigamiStudio", "Origami Studio"),
    new PMTOKScene("field/W4G1_RingIsland", "Scuffle Island"),
    new PMTOKScene("field/W4G1_Ship", "Ship"),
    new PMTOKScene("field/W4G1_SpadeIsland", "Spade Island"),
    new PMTOKScene("field/W4G1_UnderSeaA", "Under Sea"),
    new PMTOKScene("field/W4G1_UnderSeaMoonIsland", "Under Sea (Full Moon Island)"),
    new PMTOKScene("field/W4G1_UnderSeaOrb", "Under Sea (Orb)"),
    new PMTOKScene("field/W4G2_CourageEntrance", "Courage Entrance"),
    new PMTOKScene("field/W4G2_CourageLevel1", "Courage Level"),
    new PMTOKScene("field/W4G2_CourageOrb", "Courage Orb"),
    new PMTOKScene("field/W4G2_OrbIsland", "Orb Island"),
    new PMTOKScene("field/W4G2_WisdomLevel1", "Wisdom Level"),
    new PMTOKScene("battle/Btl_W4C1_PeachShipA", "Battle - The Princess Peach"),
    new PMTOKScene("battle/Btl_W4C2_IceMountainA", "Battle - Ice Vellumental Mountain"),
    new PMTOKScene("battle/Btl_W4C2_IceMountainBossA", "Battle - Ice Vellumental Mountain (Boss)"),
    new PMTOKScene("battle/Btl_W4C3_OrbTowerA", "Battle - Sea Tower"),
    new PMTOKScene("battle/Btl_W4C3_OrbTowerBossA", "Battle - Sea Tower (Boss)"),
    new PMTOKScene("battle/Btl_W4G1_OceanA", "Battle - The Great Sea"),
    "Green Streamer",
    new PMTOKScene("field/W5C1_CliffWay", "Cliff Way"),
    new PMTOKScene("field/W5C1_QuizRoom", "Quiz Room"),
    new PMTOKScene("field/W5C1_RaceQuiz", "Race Quiz"),
    new PMTOKScene("field/W5C1_SecretSpa", "Secret Spa"),
    new PMTOKScene("field/W5C1_SteamFirst", "Steam First"),
    new PMTOKScene("field/W5C2_BigTreeFirst", "Big Tree (1st Floor)"),
    new PMTOKScene("field/W5C2_BigTreeSecond", "Big Tree (2nd Floor)"),
    new PMTOKScene("field/W5C2_BigTreeThird", "Big Tree (3rd Floor)"),
    new PMTOKScene("field/W5C2_BreakBridge", "Break Bridge"),
    new PMTOKScene("field/W5C2_DeadEnd", "Dead End A"),
    new PMTOKScene("field/W5C2_DeadEndB", "Dead End B"),
    new PMTOKScene("field/W5C2_DeepJungle", "Deep Jungle"),
    new PMTOKScene("field/W5C2_JungleSpa", "Spring of Jungle Mist"),
    new PMTOKScene("field/W5C2_LeafMemory", "Leaf Memory"),
    new PMTOKScene("field/W5C3_BlackHandAreaSide", "Black Hand Area Side"),
    new PMTOKScene("field/W5C3_Dockyard", "Dockyard (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_EntranceWay", "Entrance (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_MainHall", "Main Hall (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_MetStatue", "Met Statue (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_PillarPassage", "Pillar Passage (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ResidenceFloor", "Residence Floor (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_RoomA", "Room (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_SavePoint", "Save Point (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_Shooting", "Shooting Gallery (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ShootingDemoAfter", "Shooting Gallery Demo 1 (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ShootingDemoBefore", "Shooting Gallery Demo 2 (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ThroneRoom", "Throne Room (Bowser's Castle)"),
    new PMTOKScene("field/W5G1_DokanRoom", "Pipe Room"),
    new PMTOKScene("field/W5G1_SkySpa", "Shangri-Spa"),
    new PMTOKScene("field/W5G1_SpaEntrance", "Spa Entrance"),
    new PMTOKScene("field/W5G1_SpaRoom", "Spa Room"),
    new PMTOKScene("battle/Btl_W5C1_QuizA", "Battle - Quiz"),
    new PMTOKScene("battle/Btl_W5C2_JungleA", "Battle - Spring of Jungle Mist"),
    new PMTOKScene("battle/Btl_W5C3_KoopaCastleA", "Battle - Bowser's Castle"),
    new PMTOKScene("battle/Btl_W5C3_KoopaCastleBossA", "Battle - Bowser's Castle (Boss A)"),
    new PMTOKScene("battle/Btl_W5C3_KoopaCastleBossB", "Battle - Bowser's Castle (Boss B)"),
    new PMTOKScene("battle/Btl_W5G1_SkySpaA", "Battle - Shangri-Spa"),
    new PMTOKScene("battle/Btl_W5G1_SkySpaBossA", "Battle - Shangri-Spa (Boss)"),
    "Peach's Castle (Atop the Volcano)",
    new PMTOKScene("field/W6C1_Volcano", "Inside the Volcano"),
    new PMTOKScene("field/W6C2_CastleGate", "Outside the Castle"),
    new PMTOKScene("field/W6C2_CollapsedWall", "Castle Broken Wall"),
    "Origami Castle",
    new PMTOKScene("field/W6C2_EnemyRush", "Enemy Rush"),
    new PMTOKScene("field/W6C2_FirstFloor", "First Floor"),
    new PMTOKScene("field/W6C2_GrowRoom", "Grow Room"),
    new PMTOKScene("field/W6C2_InsideBox", "Inside Box"),
    new PMTOKScene("field/W6C2_LastBossArea", "Final Boss Area"),
    new PMTOKScene("field/W6C2_LateralLift", "Lateral Lift"),
    new PMTOKScene("field/W6C2_OrigamiCastle", "Origami Castle"),
    new PMTOKScene("field/W6C2_PopUpBox", "Pop-Up Box"),
    new PMTOKScene("field/W6C2_SecondFloor", "Second Floor"),
    new PMTOKScene("field/W6C2_StairRoomA", "Stair Room A"),
    new PMTOKScene("field/W6C2_StairRoomC", "Stair Room C"),
    new PMTOKScene("field/W6C2_ThirdFloor", "Third Floor"),
    new PMTOKScene("field/W6C2_ThroneRoom", "Throne Room"),
    new PMTOKScene("battle/Btl_W6C2_OrigamiCastleA", "Battle - Origami Castle A"),
    new PMTOKScene("battle/Btl_W6C2_OrigamiCastleB", "Battle - Origami Castle B"),
    new PMTOKScene("battle/Btl_W6C2_OrigamiCastleBossA", "Battle - Origami Castle (Boss)"),
    "Other",
    new PMTOKScene("field/W7C1_KinokoRoomA", "Kinoko Room"),
    new PMTOKScene("field/W7C1_KinopioHouse", "Toad House"),
    new PMTOKScene("field/W7C1_RadarTutorialA", "Radar Tutorial"),
    new PMTOKScene("field/W7C2_CafeRoomA", "Cafe Room")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
