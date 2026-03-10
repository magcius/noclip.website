import * as BNTX from "../fres_nx/bntx.js";
import * as BFRES from "../fres_nx/bfres.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { PMTOKTextureHolder, ModelData, ModelRenderer, PMTOKRenderer } from "./render.js";

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

const pathBase = "PMTOK";
class PMTOKScene implements SceneDesc {
    public id: string;

    constructor(private bfresPath: string, public name: string) {
        this.id = this.bfresPath.split("/")[1].split(".")[0];
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const bfresFile = await context.dataFetcher.fetchData(`${pathBase}/map/${this.bfresPath}`);
        const commonBntxFile = await context.dataFetcher.fetchData(`${pathBase}/graphics/textures/common/default.bntx`);
        const bfres = BFRES.parse(bfresFile);

        const resourceSystem = new ResourceSystem(device);
        const sceneRenderer = new PMTOKRenderer(device);
        resourceSystem.loadBFRES(device, this.id, bfres);
        resourceSystem.textureHolder.addBNTXFile(device, commonBntxFile);
        sceneRenderer.setResourceSystem(resourceSystem);
        for (const fmdlData of resourceSystem.fmdlDataCache.values()) {
            if (fmdlData) {
                sceneRenderer.modelRenderers.push(
                    new ModelRenderer(device, sceneRenderer.renderHelper.renderCache, resourceSystem.textureHolder, fmdlData)
                );
            }   
        }

        return sceneRenderer;
    }
}

// TODO: Go through the game again to get level names right. For now they're either from memory or the literal file name
const id = "PMTOK";
const name = "Paper Mario: The Origami King";
const sceneDescs = [
    "Prologue",
    new PMTOKScene("field/W0C1_BasementWay.bfres",              "Basement Way"),
    new PMTOKScene("field/W0C1_CastleGate.bfres",               "Castle Gate"),
    new PMTOKScene("field/W0C1_EntranceWay.bfres",              "Entrance Way"),
    new PMTOKScene("field/W0C1_FoldRoom.bfres",                 "Fold Room"),
    new PMTOKScene("field/W0C1_HelpOlivia.bfres",               "Help Olivia"),
    new PMTOKScene("field/W0C1_MainHall.bfres",                 "Main Hall (Peach's Castle)"),
    new PMTOKScene("field/W0C1_SpiralStair.bfres",              "Spiral Stair"),
    new PMTOKScene("field/W0C1_WallHole.bfres",                 "Wall Hole"),
    new PMTOKScene("field/W0C2_VolcanoCastle.bfres",            "Volcano Castle"),
    new PMTOKScene("battle/Btl_W0C1_PeachcastleA.bfres",        "Battle - Peach's Castle"),
    "Red Streamer",
    new PMTOKScene("field/W1C1_BigStump.bfres",                 "Big Stump"),
    new PMTOKScene("field/W1C1_CampSite.bfres",                 "Camp Site"),
    new PMTOKScene("field/W1C1_CastleView.bfres",               "Castle View"),
    new PMTOKScene("field/W1C1_LogHouse.bfres",                 "Log House"),
    new PMTOKScene("field/W1C1_LostForest.bfres",               "Whispering Woods"),
    new PMTOKScene("field/W1C1_WakeUp.bfres",                   "Wake Up"),
    new PMTOKScene("field/W1C2_BasementFirst.bfres",            "Basement First"),
    new PMTOKScene("field/W1C2_BasementSecond.bfres",           "Basement Second"),
    new PMTOKScene("field/W1C2_BasementThird.bfres",            "Basement Third"),
    new PMTOKScene("field/W1C2_HelpKinopio.bfres",              "Help Kinopio"),
    new PMTOKScene("field/W1C2_TurnValve.bfres",                "Turn Valve"),
    new PMTOKScene("field/W1C3_BigTurtle.bfres",                "Big Turtle"),
    new PMTOKScene("field/W1C3_BossArea.bfres",                 "Boss Area 1"),
    new PMTOKScene("field/W1C3_PushRock.bfres",                 "Push Rock"),
    new PMTOKScene("field/W1C3_RollingTurtle.bfres",            "Rolling Turtle"),
    new PMTOKScene("field/W1C3_UpDownRock.bfres",               "Up Down Rock"),
    new PMTOKScene("field/W1C4_BossArea.bfres",                 "Boss Area 2"),
    new PMTOKScene("field/W1C4_Elevator.bfres",                 "Elevator"),
    new PMTOKScene("field/W1C4_FirstFloor.bfres",               "Overlook Tower (1st Floor)"),
    new PMTOKScene("field/W1C4_SecondFloor.bfres",              "Overlook Tower (2nd Floor)"),
    new PMTOKScene("field/W1C4_ThirdFloor.bfres",               "Overlook Tower (3rd Floor)"),
    new PMTOKScene("field/W1C4_FourthFloor.bfres",              "Overlook Tower (4th Floor)"),
    new PMTOKScene("field/W1G1_ArtGallery.bfres",               "Art Gallery"),
    new PMTOKScene("field/W1G1_BackRoom.bfres",                 "Back Room"),
    new PMTOKScene("field/W1G1_BattleLab.bfres",                "Battle Lab"),
    new PMTOKScene("field/W1G1_CastleGate.bfres",               "Castle Gate"),
    new PMTOKScene("field/W1G1_CollectableGallery.bfres",       "Collectible Gallery"),
    new PMTOKScene("field/W1G1_DokanRoom.bfres",                "Dokan Room"),
    new PMTOKScene("field/W1G1_EnemyGallery.bfres",             "Enemy Gallery"),
    new PMTOKScene("field/W1G1_HouseA.bfres",                   "House A (Toad Town)"),
    new PMTOKScene("field/W1G1_HouseB.bfres",                   "House B (Toad Town)"),
    new PMTOKScene("field/W1G1_HouseC.bfres",                   "House C (Toad Town)"),
    new PMTOKScene("field/W1G1_HouseD.bfres",                   "House D (Toad Town)"),
    new PMTOKScene("field/W1G1_HouseE.bfres",                   "House E (Toad Town)"),
    new PMTOKScene("field/W1G1_HouseF.bfres",                   "House F (Toad Town)"),
    new PMTOKScene("field/W1G1_HouseG.bfres",                   "House G (Toad Town)"),
    new PMTOKScene("field/W1G1_KartRoad.bfres",                 "Kart Road"),
    new PMTOKScene("field/W1G1_KinokoTown.bfres",               "Toad Town"),
    new PMTOKScene("field/W1G1_KinokoTownEnding.bfres",         "Toad Town (Ending)"),
    new PMTOKScene("field/W1G1_KinopioGallery.bfres",           "Kinopio Gallery"),
    new PMTOKScene("field/W1G1_KinopioHouse.bfres",             "Kinopio House"),
    new PMTOKScene("field/W1G1_MuseumEntrance.bfres",           "Museum Entrance"),
    new PMTOKScene("field/W1G1_Shop.bfres",                     "Shop (Toad Town)"),
    new PMTOKScene("field/W1G1_SoundGallery.bfres",             "Sound Gallery"),
    new PMTOKScene("field/W1G1_StoreRoom.bfres",                "Store Room (Toad Town)"),
    new PMTOKScene("field/W1G2_Hill.bfres",                     "Hill"),
    new PMTOKScene("field/W1G3_GondolaLift.bfres",              "Gondola Lift"),
    new PMTOKScene("field/W1G3_Observatory.bfres",              "Overlook Tower"),
    new PMTOKScene("battle/Btl_W1C1_MountainA.bfres",           "Battle - Overlook Mountain"),
    new PMTOKScene("battle/Btl_W1C2_WaterwayA.bfres",           "Battle - Waterway"),
    new PMTOKScene("battle/Btl_W1C3_CaveA.bfres",               "Battle - Earth Vellumental Temple"),
    new PMTOKScene("battle/Btl_W1C3_CaveBossA.bfres",           "Battle - Earth Vellumental Temple (Boss)"),
    new PMTOKScene("battle/Btl_W1C4_TenbouTowerA.bfres",        "Battle - Overlook Tower"),
    new PMTOKScene("battle/Btl_W1C4_TenbouTowerBossA.bfres",    "Battle - Overlook Tower (Boss)"),
    new PMTOKScene("battle/Btl_W1G1_KinokoTownA.bfres",         "Battle - Toad Town A"),
    new PMTOKScene("battle/Btl_W1G1_KinokoTownB.bfres",         "Battle - Toad Town B"),
    new PMTOKScene("battle/Btl_W1G2_HillA.bfres",               "Battle - Hill"),
    new PMTOKScene("battle/Btl_W1G3_ObservatoryA.bfres",        "Battle - Observatory"),
    "Blue Streamer",
    new PMTOKScene("field/W2C1_IgaguriValley.bfres",            "Chestnut Valley"),
    new PMTOKScene("field/W2C2_BossArea.bfres",                 "Boss Area 1"),
    new PMTOKScene("field/W2C2_BoxMaze.bfres",                  "Box Maze"),
    new PMTOKScene("field/W2C2_CrabIntro.bfres",                "Crab Intro"),
    new PMTOKScene("field/W2C2_CryDragon.bfres",                "Cry Dragon"),
    new PMTOKScene("field/W2C2_EntranceDragon.bfres",           "Entrance Dragon"),
    new PMTOKScene("field/W2C2_LoopWay.bfres",                  "Loop Way"),
    new PMTOKScene("field/W2C2_PanelGetA.bfres",                "Panel Get A"),
    new PMTOKScene("field/W2C2_PanelGetB.bfres",                "Panel Get B"),
    new PMTOKScene("field/W2C2_PuzzleEasy.bfres",               "Puzzle Easy"),
    new PMTOKScene("field/W2C2_PuzzleHard.bfres",               "Puzzle Hard"),
    new PMTOKScene("field/W2C3_DownRiver.bfres",                "Eddy River"),
    new PMTOKScene("field/W2C4_CabinetStair.bfres",             "Cabinet Stair"),
    new PMTOKScene("field/W2C4_EntranceWay.bfres",              "Entrance Way"),
    new PMTOKScene("field/W2C4_GoalRoom.bfres",                 "Goal Room"),
    new PMTOKScene("field/W2C4_HangingScroll.bfres",            "Hanging Scroll"),
    new PMTOKScene("field/W2C4_MaintenanceRoom.bfres",          "Maintenance Room"),
    new PMTOKScene("field/W2C4_PressWall.bfres",                "Press Wall"),
    new PMTOKScene("field/W2C4_SpearTrap.bfres",                "Spear Trap"),
    new PMTOKScene("field/W2C4_StaffRoom.bfres",                "Staff Room"),
    new PMTOKScene("field/W2C4_StartGoal.bfres",                "Start Goal"),
    new PMTOKScene("field/W2C4_TatamiFlip.bfres",               "Tatami Flip"),
    new PMTOKScene("field/W2C4_TeaHouse.bfres",                 "Tea House"),
    new PMTOKScene("field/W2C5_EntranceGate.bfres",             "Entrance Gate"),
    new PMTOKScene("field/W2C5_FirstTheater.bfres",             "First Theater"),
    new PMTOKScene("field/W2C5_SecondTheater.bfres",            "Second Theater"),
    new PMTOKScene("field/W2C5_ThirdTheater.bfres",             "Third Theater"),
    new PMTOKScene("field/W2C5_FourthTheater.bfres",            "Fourth Theater"),
    new PMTOKScene("field/W2C5_Lobby.bfres",                    "Lobby"),
    new PMTOKScene("field/W2G1_MomijiMountain.bfres",           "Autumn Mountain"),
    new PMTOKScene("field/W2G2_CastlePark.bfres",               "Castle Park"),
    new PMTOKScene("field/W2G2_HitTarget.bfres",                "Hit Target"),
    new PMTOKScene("field/W2G2_HouseA.bfres",                   "House A"),
    new PMTOKScene("field/W2G2_HouseE.bfres",                   "House E"),
    new PMTOKScene("field/W2G2_HouseF.bfres",                   "House F"),
    new PMTOKScene("field/W2G2_HouseH.bfres",                   "House H"),
    new PMTOKScene("field/W2G2_LongHouseA.bfres",               "Long House A"),
    new PMTOKScene("field/W2G2_LongHouseB.bfres",               "Long House B"),
    new PMTOKScene("field/W2G2_PhotoStudio.bfres",              "Photo Studio"),
    new PMTOKScene("field/W2G2_Shop.bfres",                     "Shop"),
    new PMTOKScene("field/W2G2_ShopUpstairs.bfres",             "Shop Upstairs"),
    new PMTOKScene("field/W2G2_StaffRoom.bfres",                "Staff Room"),
    new PMTOKScene("field/W2G2_TeaRoom.bfres",                  "Tea Room"),
    new PMTOKScene("battle/Btl_W2C2_WaterCaveA.bfres",          "Battle - Water Vellumental Shrine"),
    new PMTOKScene("battle/Btl_W2C2_WaterCaveBossA.bfres",      "Battle - Water Vellumental Shrine (Boss)"),
    new PMTOKScene("battle/Btl_W2C4_NinjyayashikiA.bfres",      "Battle - Shogun Studios"),
    new PMTOKScene("battle/Btl_W2C5_GekijouBossA.bfres",        "Battle - Big Sho' Theater"),
    new PMTOKScene("battle/Btl_W2G1_MomijiMountainA.bfres",     "Battle - Autumn Mountain"),
    new PMTOKScene("battle/Btl_W2G2_CastleParkA.bfres",         "Battle - Castle Park"),
    "Yellow Streamer",
    new PMTOKScene("field/W3C1_FindOlivia.bfres",               "Find Olivia"),
    new PMTOKScene("field/W3C1_LeftPassage.bfres",              "Left Passage"),
    new PMTOKScene("field/W3C1_RoomA.bfres",                    "Room A"),
    new PMTOKScene("field/W3C1_Tunnel.bfres",                   "Breezy Tunnel"),
    new PMTOKScene("field/W3C1_TunnelExit.bfres",               "Breezy Tunnel Exit"),
    new PMTOKScene("field/W3C3_BossArea.bfres",                 "Boss Area"),
    new PMTOKScene("field/W3C3_EntranceWay.bfres",              "Entrance Way"),
    new PMTOKScene("field/W3C3_FallBird.bfres",                 "Fall Bird"),
    new PMTOKScene("field/W3C3_FireBucketA.bfres",              "Fire Bucket"),
    new PMTOKScene("field/W3C3_FireJump.bfres",                 "Fire Jump"),
    new PMTOKScene("field/W3C3_LightMemory.bfres",              "Light Memory"),
    new PMTOKScene("field/W3C4_Desert.bfres",                   "Desert"),
    new PMTOKScene("field/W3C4_DiscoEntrance.bfres",            "Disco Entrance"),
    new PMTOKScene("field/W3C4_DiscoHall.bfres",                "Disco Hall"),
    new PMTOKScene("field/W3C4_EntranceWay.bfres",              "Entrance Way"),
    new PMTOKScene("field/W3C4_FallStatue.bfres",               "Fall Statue"),
    new PMTOKScene("field/W3C4_FavoriteCD.bfres",               "Favorite CD"),
    new PMTOKScene("field/W3C4_FourSwitch.bfres",               "Four Switch"),
    new PMTOKScene("field/W3C4_HorrorWay.bfres",                "Horror Way"),
    new PMTOKScene("field/W3C4_KanokeHall.bfres",               "Kanoke Hall"),
    new PMTOKScene("field/W3C4_MoveStatue.bfres",               "Move Statue"),
    new PMTOKScene("field/W3C4_MummyKuriboArea.bfres",          "Mummy Kuribo Area"),
    new PMTOKScene("field/W3C4_Outside.bfres",                  "Outside"),
    new PMTOKScene("field/W3C4_PilePuzzle.bfres",               "Pile Puzzle"),
    new PMTOKScene("field/W3C4_SpiderNest.bfres",               "Spider Nest"),
    new PMTOKScene("field/W3C4_TreasureRoom.bfres",             "Treasure Room"),
    new PMTOKScene("field/W3C4_TwoKinopio.bfres",               "Two Kinopio"),
    new PMTOKScene("field/W3G1_Canyon.bfres",                   "Canyon"),
    new PMTOKScene("field/W3G2_Desert.bfres",                   "Desert"),
    new PMTOKScene("field/W3G2_DesertRuin.bfres",               "Desert Ruin"),
    new PMTOKScene("field/W3G2_IceKinopio.bfres",               "Ice Kinopio"),
    new PMTOKScene("field/W3G2_KinopioTop.bfres",               "Kinopio Top"),
    new PMTOKScene("field/W3G2_KinopioTopRe.bfres",             "Kinopio Top Revisit"),
    new PMTOKScene("field/W3G2_OasisLeft.bfres",                "Oasis Left"),
    new PMTOKScene("field/W3G2_OasisRight.bfres",               "Oasis Right"),
    new PMTOKScene("field/W3G2_RuinLeft.bfres",                 "Ruin Left"),
    new PMTOKScene("field/W3G2_RuinRight.bfres",                "Ruin Right"),
    new PMTOKScene("field/W3G2_SamboArea.bfres",                "Sambo Area"),
    new PMTOKScene("field/W3G3_HotelLobby.bfres",               "Hotel Area"),
    new PMTOKScene("field/W3G3_HotelPool.bfres",                "Hotel Pool"),
    new PMTOKScene("field/W3G3_HouseA.bfres",                   "House A (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseB.bfres",                   "House B (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseC.bfres",                   "House C (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseD.bfres",                   "House D (Shroom City)"),
    new PMTOKScene("field/W3G3_HouseE.bfres",                   "House E (Shroom City)"),
    new PMTOKScene("field/W3G3_LeftPassage.bfres",              "Left Passage"),
    new PMTOKScene("field/W3G3_LeftRoomL.bfres",                "Left Room L"),
    new PMTOKScene("field/W3G3_LeftRoomR.bfres",                "Left Room R"),
    new PMTOKScene("field/W3G3_Oasis.bfres",                    "Oasis"),
    new PMTOKScene("field/W3G3_RightPassage.bfres",             "Right Passage"),
    new PMTOKScene("field/W3G3_SuiteRoom.bfres",                "Suite Room"),
    new PMTOKScene("battle/Btl_W3C1_TunnelA.bfres",             "Battle - Breezy Tunnel"),
    new PMTOKScene("battle/Btl_W3C3_FirecaveA.bfres",           "Battle - Fire Vellumental Cave"),
    new PMTOKScene("battle/Btl_W3C3_FirecaveBossA.bfres",       "Battle - Fire Vellumental Cave (Boss)"),
    new PMTOKScene("battle/Btl_W3C4_RuinA.bfres",               "Battle - Temple of Shrooms A"),
    new PMTOKScene("battle/Btl_W3C4_RuinB.bfres",               "Battle - Temple of Shrooms B"),
    new PMTOKScene("battle/Btl_W3C4_RuinBossA.bfres",           "Battle - Temple of Shrooms (Boss)"),
    new PMTOKScene("battle/Btl_W3G2_DesertA.bfres",             "Battle - Scorching Sandpaper Desert"),
    "Purple Streamer",
    new PMTOKScene("field/W4C1_ControlRoom.bfres",              "Control Room (The Princess Peach)"),
    new PMTOKScene("field/W4C1_EngineRoom.bfres",               "Engine Room (The Princess Peach)"),
    new PMTOKScene("field/W4C1_GessoArea.bfres",                "Gesso Area"),
    new PMTOKScene("field/W4C1_GuestAreaFirst.bfres",           "Guest Area (1st Floor)"),
    new PMTOKScene("field/W4C1_GuestAreaSecond.bfres",          "Guest Area (2nd Floor)"),
    new PMTOKScene("field/W4C1_GuestPassage.bfres",             "Guest Passage"),
    new PMTOKScene("field/W4C1_Lounge.bfres",                   "Lounge"),
    new PMTOKScene("field/W4C1_ShipDeck.bfres",                 "Deck (The Princess Peach)"),
    new PMTOKScene("field/W4C1_StaffAreaFirst.bfres",           "Staff Area (1st Floor)"),
    new PMTOKScene("field/W4C1_StaffAreaSecond.bfres",          "Staff Area (2nd Floor)"),
    new PMTOKScene("field/W4C1_StaffPassage.bfres",             "Staff Passage"),
    new PMTOKScene("field/W4C1_StoreRoom.bfres",                "Storage Room"),
    new PMTOKScene("field/W4C1_VIPRoom.bfres",                  "VIP Room"),
    new PMTOKScene("field/W4C2_BigJump.bfres",                  "Big Jump"),
    new PMTOKScene("field/W4C2_BossArea.bfres",                 "Boss Area"),
    new PMTOKScene("field/W4C2_IceEntrance.bfres",              "Ice Entrance"),
    new PMTOKScene("field/W4C2_IceSlide.bfres",                 "Ice Slide"),
    new PMTOKScene("field/W4C2_JumpStart.bfres",                "Jump Start"),
    new PMTOKScene("field/W4C2_PuzzleEasy.bfres",               "Puzzle Easy"),
    new PMTOKScene("field/W4C2_PuzzleHard.bfres",               "Puzzle Hard"),
    new PMTOKScene("field/W4C2_PuzzleResetA.bfres",             "Puzzle Reset"),
    new PMTOKScene("field/W4C2_PuzzleTutorial.bfres",           "Puzzle Tutorial"),
    new PMTOKScene("field/W4C2_SpiralStair.bfres",              "Spiral Stair"),
    new PMTOKScene("field/W4C3_BossArea.bfres",                 "Boss Area"),
    new PMTOKScene("field/W4C3_EarthArea.bfres",                "Earth Area"),
    new PMTOKScene("field/W4C3_EarthWater.bfres",               "Earth Water"),
    new PMTOKScene("field/W4C3_FireArea.bfres",                 "Fire Area"),
    new PMTOKScene("field/W4C3_FireIce.bfres",                  "Fire Ice"),
    new PMTOKScene("field/W4C3_FourGod.bfres",                  "Four God"),
    new PMTOKScene("field/W4C3_OrbTower.bfres",                 "Orb Tower"),
    new PMTOKScene("field/W4C3_OutSideA.bfres",                 "Out Side A"),
    new PMTOKScene("field/W4C3_OutSideB.bfres",                 "Out Side B"),
    new PMTOKScene("field/W4C3_PuzzleReset.bfres",              "Puzzle Reset"),
    new PMTOKScene("field/W4C3_WaterArea.bfres",                "Water Area"),
    new PMTOKScene("field/W4G1_BasementStair.bfres",            "Basement Stair"),
    new PMTOKScene("field/W4G1_CloverIsland.bfres",             "Clover Island"),
    new PMTOKScene("field/W4G1_DokuroFirst.bfres",              "Dokuro (1st Floor)"),
    new PMTOKScene("field/W4G1_DokuroSecond.bfres",             "Dokuro (2nd Floor)"),
    new PMTOKScene("field/W4G1_DokuroIsland.bfres",             "Dokuro Island"),
    new PMTOKScene("field/W4G1_HammerIsland.bfres",             "Hammer Island"),
    new PMTOKScene("field/W4G1_HatenaIsland.bfres",             "Hatena Island"),
    new PMTOKScene("field/W4G1_HeartIsland.bfres",              "Heart Island"),
    new PMTOKScene("field/W4G1_KinokoIsland.bfres",             "Mushroom Island"),
    new PMTOKScene("field/W4G1_KinopioHouse.bfres",             "Kinopio House"),
    new PMTOKScene("field/W4G1_MoonIsland.bfres",               "Full Moon Island"),
    new PMTOKScene("field/W4G1_Ocean.bfres",                    "The Great Sea"),
    new PMTOKScene("field/W4G1_OrigamiStudio.bfres",            "Origami Studio"),
    new PMTOKScene("field/W4G1_RingIsland.bfres",               "Scuffle Island"),
    new PMTOKScene("field/W4G1_Ship.bfres",                     "Ship"),
    new PMTOKScene("field/W4G1_SpadeIsland.bfres",              "Spade Island"),
    new PMTOKScene("field/W4G1_UnderSeaA.bfres",                "Under Sea"),
    new PMTOKScene("field/W4G1_UnderSeaMoonIsland.bfres",       "Under Sea (Full Moon Island)"),
    new PMTOKScene("field/W4G1_UnderSeaOrb.bfres",              "Under Sea (Orb)"),
    new PMTOKScene("field/W4G2_CourageEntrance.bfres",          "Courage Entrance"),
    new PMTOKScene("field/W4G2_CourageLevel1.bfres",            "Courage Level"),
    new PMTOKScene("field/W4G2_CourageOrb.bfres",               "Courage Orb"),
    new PMTOKScene("field/W4G2_OrbIsland.bfres",                "Orb Island"),
    new PMTOKScene("field/W4G2_WisdomLevel1.bfres",             "Wisdom Level"),
    new PMTOKScene("battle/Btl_W4C1_PeachShipA.bfres",          "Battle - The Princess Peach"),
    new PMTOKScene("battle/Btl_W4C2_IceMountainA.bfres",        "Battle - Ice Vellumental Mountain"),
    new PMTOKScene("battle/Btl_W4C2_IceMountainBossA.bfres",    "Battle - Ice Vellumental Mountain (Boss)"),
    new PMTOKScene("battle/Btl_W4C3_OrbTowerA.bfres",           "Battle - Sea Tower"),
    new PMTOKScene("battle/Btl_W4C3_OrbTowerBossA.bfres",       "Battle - Sea Tower (Boss)"),
    new PMTOKScene("battle/Btl_W4G1_OceanA.bfres",              "Battle - The Great Sea"),
    "Green Streamer",
    new PMTOKScene("field/W5C1_CliffWay.bfres",                 "Cliff Way"),
    new PMTOKScene("field/W5C1_QuizRoom.bfres",                 "Quiz Room"),
    new PMTOKScene("field/W5C1_RaceQuiz.bfres",                 "Race Quiz"),
    new PMTOKScene("field/W5C1_SecretSpa.bfres",                "Secret Spa"),
    new PMTOKScene("field/W5C1_SteamFirst.bfres",               "Steam First"),
    new PMTOKScene("field/W5C2_BigTreeFirst.bfres",             "Big Tree (1st Floor)"),
    new PMTOKScene("field/W5C2_BigTreeSecond.bfres",            "Big Tree (2nd Floor)"),
    new PMTOKScene("field/W5C2_BigTreeThird.bfres",             "Big Tree (3rd Floor)"),
    new PMTOKScene("field/W5C2_BreakBridge.bfres",              "Break Bridge"),
    new PMTOKScene("field/W5C2_DeadEnd.bfres",                  "Dead End A"),
    new PMTOKScene("field/W5C2_DeadEndB.bfres",                 "Dead End B"),
    new PMTOKScene("field/W5C2_DeepJungle.bfres",               "Deep Jungle"),
    new PMTOKScene("field/W5C2_JungleSpa.bfres",                "Spring of Jungle Mist"),
    new PMTOKScene("field/W5C2_LeafMemory.bfres",               "Leaf Memory"),
    new PMTOKScene("field/W5C3_BlackHandAreaSide.bfres",        "Black Hand Area Side"),
    new PMTOKScene("field/W5C3_Dockyard.bfres",                 "Dockyard (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_EntranceWay.bfres",              "Entrance (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_MainHall.bfres",                 "Main Hall (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_MetStatue.bfres",                "Met Statue (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_PillarPassage.bfres",            "Pillar Passage (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ResidenceFloor.bfres",           "Residence Floor (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_RoomA.bfres",                    "Room (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_SavePoint.bfres",                "Save Point (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_Shooting.bfres",                 "Shooting Gallery (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ShootingDemoAfter.bfres",        "Shooting Gallery Demo 1 (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ShootingDemoBefore.bfres",       "Shooting Gallery Demo 2 (Bowser's Castle)"),
    new PMTOKScene("field/W5C3_ThroneRoom.bfres",               "Throne Room (Bowser's Castle)"),
    new PMTOKScene("field/W5G1_DokanRoom.bfres",                "Dokan Room"),
    new PMTOKScene("field/W5G1_SkySpa.bfres",                   "Shangri-Spa"),
    new PMTOKScene("field/W5G1_SpaEntrance.bfres",              "Spa Entrance"),
    new PMTOKScene("field/W5G1_SpaRoom.bfres",                  "Spa Room"),
    new PMTOKScene("battle/Btl_W5C1_QuizA.bfres",               "Battle - Quiz"),
    new PMTOKScene("battle/Btl_W5C2_JungleA.bfres",             "Battle - Spring of Jungle Mist"),
    new PMTOKScene("battle/Btl_W5C3_KoopaCastleA.bfres",        "Battle - Bowser's Castle"),
    new PMTOKScene("battle/Btl_W5C3_KoopaCastleBossA.bfres",    "Battle - Bowser's Castle (Boss A)"),
    new PMTOKScene("battle/Btl_W5C3_KoopaCastleBossB.bfres",    "Battle - Bowser's Castle (Boss B)"),
    new PMTOKScene("battle/Btl_W5G1_SkySpaA.bfres",             "Battle - Shangri-Spa"),
    new PMTOKScene("battle/Btl_W5G1_SkySpaBossA.bfres",         "Battle - Shangri-Spa (Boss)"),
    "Finale",
    new PMTOKScene("field/W6C1_Volcano.bfres",                  "Volcano"),
    new PMTOKScene("field/W6C2_CastleGate.bfres",               "Castle Gate"),
    new PMTOKScene("field/W6C2_CollapsedWall.bfres",            "Collapsed Wall"),
    new PMTOKScene("field/W6C2_EnemyRush.bfres",                "Enemy Rush"),
    new PMTOKScene("field/W6C2_FirstFloor.bfres",               "First Floor"),
    new PMTOKScene("field/W6C2_GrowRoom.bfres",                 "Grow Room"),
    new PMTOKScene("field/W6C2_InsideBox.bfres",                "Inside Box"),
    new PMTOKScene("field/W6C2_LastBossArea.bfres",             "Final Boss Area"),
    new PMTOKScene("field/W6C2_LateralLift.bfres",              "Lateral Lift"),
    new PMTOKScene("field/W6C2_OrigamiCastle.bfres",            "Origami Castle"),
    new PMTOKScene("field/W6C2_PopUpBox.bfres",                 "Pop-Up Box"),
    new PMTOKScene("field/W6C2_SecondFloor.bfres",              "Second Floor"),
    new PMTOKScene("field/W6C2_StairRoomA.bfres",               "Stair Room A"),
    new PMTOKScene("field/W6C2_StairRoomC.bfres",               "Stair Room C"),
    new PMTOKScene("field/W6C2_ThirdFloor.bfres",               "Third Floor"),
    new PMTOKScene("field/W6C2_ThroneRoom.bfres",               "Throne Room"),
    new PMTOKScene("battle/Btl_W6C2_OrigamiCastleA.bfres",      "Battle - Origami Castle A"),
    new PMTOKScene("battle/Btl_W6C2_OrigamiCastleB.bfres",      "Battle - Origami Castle B"),
    new PMTOKScene("battle/Btl_W6C2_OrigamiCastleBossA.bfres",  "Battle - Origami Castle (Boss)"),
    "Epilogue",
    new PMTOKScene("field/W7C1_KinokoRoomA.bfres",              "Kinoko Room"),
    new PMTOKScene("field/W7C1_KinopioHouse.bfres",             "Toad House"),
    new PMTOKScene("field/W7C1_RadarTutorialA.bfres",           "Radar Tutorial"),
    new PMTOKScene("field/W7C2_CafeRoomA.bfres",                "Cafe Room")
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
