
import * as Viewer from '../viewer.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';
import * as BYML from '../byml.js';
import { DataFetcher } from '../DataFetcher.js';
import * as SARC from './sarc.js';
import * as BFRES from './bfres.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { BRTITextureHolder, BasicFRESRenderer, FMDLRenderer, FMDLData } from './render.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { assert, assertExists } from '../util.js';
import { mat4 } from 'gl-matrix';
import { SceneContext } from '../SceneBase.js';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';

const pathBase = `SuperMarioOdyssey`;

class ResourceSystem {
    public textureHolder = new BRTITextureHolder();
    public mounts = new Map<string, SARC.SARC>();
    public bfresCache = new Map<string, BFRES.FRES | null>();
    public fmdlDataCache = new Map<string, FMDLData | null>();
    public arcPromiseCache = new Map<string, Promise<SARC.SARC | null>>();
    private renderCache: GfxRenderCache;

    constructor(device: GfxDevice) {
        this.renderCache = new GfxRenderCache(device);
    }

    private loadResource(device: GfxDevice, mountName: string, sarc: SARC.SARC): void {
        assert(!this.mounts.has(mountName));
        this.mounts.set(mountName, sarc);

        for (let i = 0; i < sarc.files.length; i++) {
            if (!sarc.files[i].name.endsWith('.bfres'))
                continue;

            // Sanity check: there should only be one .bfres per archive.
            assert(!this.bfresCache.has(mountName));

            const fres = BFRES.parse(sarc.files[i].buffer);
            this.bfresCache.set(mountName, fres);

            this.textureHolder.addFRESTextures(device, fres);
        }
    }

    private async fetchDataInternal(device: GfxDevice, dataFetcher: DataFetcher, arcPath: string): Promise<SARC.SARC | null> {
        const buffer = await dataFetcher.fetchData(`${pathBase}/${arcPath}.szs`, { allow404: true });

        if (buffer.byteLength === 0)
            return null;

        const decompressed = await Yaz0.decompress(buffer);
        const sarc = SARC.parse(decompressed);

        this.loadResource(device, arcPath, sarc);
        return sarc;
    }

    public fetchData(device: GfxDevice, dataFetcher: DataFetcher, arcPath: string): Promise<SARC.SARC | null> {
        if (!this.arcPromiseCache.has(arcPath))
            this.arcPromiseCache.set(arcPath, this.fetchDataInternal(device, dataFetcher, arcPath));
        return this.arcPromiseCache.get(arcPath)!;
    }

    public waitForLoad(): Promise<void> {
        return Promise.all(this.arcPromiseCache.values()) as unknown as Promise<void>;
    }

    public findFRES(mountName: string): BFRES.FRES | null {
        if (!this.bfresCache.has(mountName)) {
            console.log(`No FRES for ${mountName}`);
            this.bfresCache.set(mountName, null);
        }

        return this.bfresCache.get(mountName)!;
    }

    public getFMDLData(device: GfxDevice, mountName: string): FMDLData | null {
        if (!this.fmdlDataCache.has(mountName)) {
            const fres = this.findFRES(mountName);
            let fmdlData: FMDLData | null = null;
            if (fres !== null) {
                // TODO(jstpierre): Proper actor implementations...
                if (fres.fmdl.length > 0) {
                    assert(fres.fmdl.length === 1);
                    fmdlData = new FMDLData(this.renderCache, fres.fmdl[0]);
                } else {
                    return null;
                }
            }
            this.fmdlDataCache.set(mountName, fmdlData);
        }

        return this.fmdlDataCache.get(mountName)!;
    }

    public findBuffer(mountName: string, fileName: string): ArrayBufferSlice {
        const sarc = assertExists(this.mounts.get(mountName));
        return sarc.files.find((n) => n.name === fileName)!.buffer;
    }

    public destroy(device: GfxDevice): void {
        this.renderCache.destroy();
        this.textureHolder.destroy(device);
        this.fmdlDataCache.forEach((value) => {
            if (value !== null)
                value.destroy(device);
        });
    }
}

type StageMap = { ObjectList?: StageObject[], ZoneList?: StageObject[] }[];
type Vector = { X: number, Y: number, Z: number };
type StageObject = {
    UnitConfigName: string,
    UnitConfig: UnitConfig,
    Rotate: Vector,
    Scale: Vector,
    Translate: Vector,
};
type UnitConfig = {
    DisplayName: string,
    DisplayRotate: Vector,
    DisplayScale: Vector,
    DisplayTranslate: Vector,
    GenerateCategory: string,
    ParameterConfigName: string,
    PlacementTargetFile: string,
};

function calcModelMtxFromTRSVectors(dst: mat4, tv: Vector, rv: Vector, sv: Vector): void {
    computeModelMatrixSRT(dst,
        sv.X, sv.Y, sv.Z,
        rv.X * MathConstants.DEG_TO_RAD, rv.Y * MathConstants.DEG_TO_RAD, rv.Z * MathConstants.DEG_TO_RAD,
        tv.X, tv.Y, tv.Z);
}

export class OdysseyRenderer extends BasicFRESRenderer {
    constructor(device: GfxDevice, private resourceSystem: ResourceSystem) {
        super(device, resourceSystem.textureHolder);
    }

    public override destroy(device: GfxDevice): void {
        super.destroy(device);
        this.resourceSystem.destroy(device);
    }
}

class OdysseySceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const resourceSystem = new ResourceSystem(device);
        const dataFetcher = context.dataFetcher;

        const worldListSARC = assertExists(await resourceSystem.fetchData(device, dataFetcher, `SystemData/WorldList`));
        type WorldListFromDb = { Name: string, StageList: [{ category: string, name: string }], WorldName: string, ScenarioNum: number, ClearMainScenario: number, AfterEndingScenario: number, MoonRockScenario: number };
        const worldList: WorldListFromDb[] = BYML.parse(worldListSARC.files.find((f) => f.name === 'WorldListFromDb.byml')!.buffer);

        // Find the right world from the stage given.
        function findWorldFromStage(worldList: WorldListFromDb[], stageName: string) {
            for (let i = 0; i < worldList.length; i++)
                for (let j = 0; j < worldList[i].StageList.length; j++)
                    if (worldList[i].StageList[j].name === stageName)
                        return worldList[i];
            return null;
        }
        const world = assertExists(findWorldFromStage(worldList, this.id));

        const sceneRenderer = new OdysseyRenderer(device, resourceSystem);
        const cache = sceneRenderer.renderHelper.renderCache;

        resourceSystem.fetchData(device, dataFetcher, `ObjectData/${world.Name}Texture`);

        const spawnZone = async (stageName: string, placement: mat4) => {
            const stageMapData = assertExists(await resourceSystem.fetchData(device, dataFetcher, `StageData/${stageName}Map`));
            const stageMap: StageMap = BYML.parse(assertExists(stageMapData.files.find((n) => n.name === `${stageName}Map.byml`)).buffer);

            const scenarioNum = world.AfterEndingScenario;
            // It seems like the scenarios are 1-indexed, and 0 means "default" (which appears to be 1).
            const scenarioIndex = scenarioNum > 0 ? scenarioNum - 1 : 0;
            const entry = stageMap[scenarioIndex];

            if (entry.ObjectList !== undefined)
                for (let i = 0; i < entry.ObjectList.length; i++)
                    resourceSystem.fetchData(device, dataFetcher, `ObjectData/${entry.ObjectList[i].UnitConfigName}`);
            if (entry.ZoneList !== undefined)
                for (let i = 0; i < entry.ZoneList.length; i++)
                    resourceSystem.fetchData(device, dataFetcher, `StageData/${entry.ZoneList[i].UnitConfigName}Map`);

            await resourceSystem.waitForLoad();

            if (entry.ObjectList !== undefined) {
                for (let i = 0; i < entry.ObjectList.length; i++) {
                    const stageObject = entry.ObjectList[i];
                    const fmdlData = resourceSystem.getFMDLData(device, `ObjectData/${stageObject.UnitConfigName}`);
                    if (fmdlData === null)
                        continue;

                    const fmdlRenderer = new FMDLRenderer(device, cache, resourceSystem.textureHolder, fmdlData);
                    calcModelMtxFromTRSVectors(fmdlRenderer.modelMatrix, stageObject.Translate, stageObject.Rotate, stageObject.Scale);
                    mat4.mul(fmdlRenderer.modelMatrix, placement, fmdlRenderer.modelMatrix);
                    sceneRenderer.fmdlRenderers.push(fmdlRenderer);
                }
            }

            if (entry.ZoneList !== undefined) {
                for (let i = 0; i < entry.ZoneList.length; i++) {
                    const zoneEntry = entry.ZoneList[i];
                    const zonePlacement = mat4.create();
                    calcModelMtxFromTRSVectors(zonePlacement, zoneEntry.Translate, zoneEntry.Rotate, zoneEntry.Scale);
                    mat4.mul(zonePlacement, placement, zonePlacement);
                    spawnZone(`${zoneEntry.UnitConfigName}`, zonePlacement);
                }
            }
        };

        await spawnZone(this.id, mat4.create());
        await resourceSystem.waitForLoad();

        return sceneRenderer;
    }
}

// Splatoon Models
const name = "Super Mario Odyssey";
const id = "smo";
const sceneDescs = [
    "Cap Kingdom",
    new OdysseySceneDesc("CapWorldHomeStage", "Cap Kingdom"),
    new OdysseySceneDesc("CapWorldTowerStage", "Cap Tower"),
    new OdysseySceneDesc("RollingExStage", "Rolling Sublevel"),
    new OdysseySceneDesc("PoisonWaveExStage", "Poison Tide Sublevel"),
    new OdysseySceneDesc("PushBlockExStage", "Push-Block Sublevel"),
    new OdysseySceneDesc("FrogSearchExStage", "Frog Pond Sublevel"),
    "Cascade Kingdom",
    new OdysseySceneDesc("WaterfallWorldHomeStage", "Cascade Kingdom"),
    new OdysseySceneDesc("CapAppearExStage", "Mysterious Clouds Sublevel"),
    new OdysseySceneDesc("WanwanClashExStage", "Chain Chomp Cave Sublevel"),
    new OdysseySceneDesc("Lift2DExStage", "Chasm Lifts Sublevel"),
    new OdysseySceneDesc("WindBlowExStage", "Gusty Bridges Sublevel"),
    new OdysseySceneDesc("TrexPoppunExStage", "Dinosaur Nest Sublevel"),
    "Sand Kingdom",
    new OdysseySceneDesc("SandWorldHomeStage", "Sand Kingdom"),
    new OdysseySceneDesc("SandWorldMeganeExStage", "Invisible Maze Sublevel"),
    new OdysseySceneDesc("SandWorldSphinxExStage", "Jaxi Ruins Underground"),
    new OdysseySceneDesc("SandWorldUnderground000Stage", "Underground Temple"),
    new OdysseySceneDesc("SandWorldUnderground001Stage", "Deepest Underground"),
    new OdysseySceneDesc("SandWorldKillerExStage", "Bullet Bill Maze Sublevel"),
    new OdysseySceneDesc("SandWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("SandWorldPressExStage", "Ice Cave"),
    new OdysseySceneDesc("SandWorldPyramid000Stage", "Inverted Pyramid 1"),
    new OdysseySceneDesc("SandWorldPyramid001Stage", "Inverted Pyramid 2"),
    new OdysseySceneDesc("SandWorldCostumeStage", "Dance Room"),
    new OdysseySceneDesc("SandWorldRotateExStage", "Strange Neighborhood Sublevel"),
    new OdysseySceneDesc("SandWorldSlotStage", "Slots Room"),
    new OdysseySceneDesc("SandWorldSecretStage", "Sand Kingdom Secret Sublevel"),
    new OdysseySceneDesc("MeganeLiftExStage", "Transparent Platform Sublevel"),
    new OdysseySceneDesc("RocketFlowerExStage", "Colossal Ruins Sublevel"),
    new OdysseySceneDesc("WaterTubeExStage", "Freezing Waterway Sublevel"),
    new OdysseySceneDesc("SandWorldVibrationStage", "Rumbling Floor Sublevel"),
    "Wooded Kingdom",
    new OdysseySceneDesc("ForestWorldHomeStage", "Wooded Kingdom"),
    new OdysseySceneDesc("ForestWorldTowerStage", "Sky Garden Tower"),
    new OdysseySceneDesc("ForestWorldWaterExStage", "Flooding Pipeway Sublevel"),
    new OdysseySceneDesc("ForestWorldCloudBonusExStage", "Cloud Lift Bonus Stage"),
    new OdysseySceneDesc("ShootingElevatorExStage", "Elevator Shaft Sublevel"),
    new OdysseySceneDesc("FogMountainExStage", "Foggy Sky Sublevel"),
    new OdysseySceneDesc("ForestWorldBossStage", "Secret Flower Field (Boss)"),
    new OdysseySceneDesc("RailCollisionExStage", "Flower Road Sublevel"),
    new OdysseySceneDesc("AnimalChaseExStage", "Herding Path Sublevel"),
    new OdysseySceneDesc("ForestWorldWoodsStage", "Deep Woods"),
    new OdysseySceneDesc("ForestWorldWoodsTreasureStage", "Deep Woods (Treasure Chest Tree)"),
    new OdysseySceneDesc("PackunPoisonExStage", "Invisible Road Sublevel"),
    new OdysseySceneDesc("ForestWorldBonusStage", "Treasure Room"),
    new OdysseySceneDesc("ForestWorldWoodsCostumeStage", "Deep Woods (Treasure Chest Cave)"),
    new OdysseySceneDesc("KillerRoadExStage", "Breakdown Road Sublevel"),
    "Lake Kingdom",
    new OdysseySceneDesc("LakeWorldHomeStage", "Lake Kingdom"),
    new OdysseySceneDesc("LakeWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("FrogPoisonExStage", "Waves of Poison Sublevel"),
    new OdysseySceneDesc("TrampolineWallCatchExStage", "Ledge Climbing Sublevel"),
    new OdysseySceneDesc("GotogotonExStage", "Puzzle Part Sublevel"),
    new OdysseySceneDesc("FastenerExStage", "Zipper Chasm Sublevel"),
    "Cloud Kingdom",
    new OdysseySceneDesc("CloudWorldHomeStage", "Cloud Kingdom"),
    new OdysseySceneDesc("Cube2DExStage", "2D Cube Sublevel"),
    new OdysseySceneDesc("FukuwaraiKuriboStage", "Goomba Picture Match Sublevel"),
    "Lost Kingdom",
    new OdysseySceneDesc("ClashWorldHomeStage", "Lost Kingdom"),
    new OdysseySceneDesc("ClashWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("ImomuPoisonExStage", "Poison Geyser Sublevel"),
    new OdysseySceneDesc("JangoExStage", "Klepto Lava Pit Sublevel"),
    "Metro Kingdom",
    new OdysseySceneDesc("CityWorldHomeStage", "Metro Kingdom"),
    new OdysseySceneDesc("CityWorldShop01Stage", "Crazy Cap"),
    new OdysseySceneDesc("Note2D3DRoomExStage", "Private Room 2D Sublevel"),
    new OdysseySceneDesc("CityWorldFactoryStage", "New Donk City Power Plant"),
    new OdysseySceneDesc("CityWorldMainTowerStage", "New Donk City Hall Interior"),
    new OdysseySceneDesc("PoleKillerExStage", "Bullet Bill Sublevel"),
    new OdysseySceneDesc("BikeSteelExStage", "Vanishing Road Sublevel"),
    new OdysseySceneDesc("CapRotatePackunExStage", "Rotating Maze Sublevel"),
    new OdysseySceneDesc("ElectricWireExStage", "Wiring Costume Sublevel"),
    new OdysseySceneDesc("CityWorldSandSlotStage", "Slots Room"),
    new OdysseySceneDesc("RadioControlExStage", "RC Car Room Sublevel"),
    new OdysseySceneDesc("ShootingCityExStage", "Siege Area Sublevel"),
    new OdysseySceneDesc("SwingSteelExStage", "Swinging Scaffolding Sublevel"),
    new OdysseySceneDesc("PoleGrabCeilExStage", "Swinging High-Rise Sublevel"),
    new OdysseySceneDesc("Theater2DExStage", "Projection Room Sublevel"),
    new OdysseySceneDesc("DonsukeExStage", "Pitchblack Mountain Sublevel"),
    new OdysseySceneDesc("CityPeopleRoadStage", "Crowded Alleyway Sublevel"),
    new OdysseySceneDesc("TrexBikeExStage", "T-Rex Chase Sublevel"),
    "Seaside Kingdom",
    new OdysseySceneDesc("SeaWorldHomeStage", "Seaside Kingdom"),
    new OdysseySceneDesc("SeaWorldCostumeStage", "Beach House Costume Sublevel"),
    new OdysseySceneDesc("WaterValleyExStage", "Narrow Valley Sublevel"),
    new OdysseySceneDesc("SeaWorldSecretStage", "Sphynx's Underwater Vault"),
    new OdysseySceneDesc("CloudExStage", "Cloud Sea Sublevel"),
    new OdysseySceneDesc("SenobiTowerExStage", "Sinking Island Sublevel"),
    new OdysseySceneDesc("ReflectBombExStage", "Pokio Valley Sublevel"),
    new OdysseySceneDesc("TogezoRotateExStage", "Spinning Maze Sublevel"),
    new OdysseySceneDesc("SeaWorldSneakingManStage", "Flooded Cave Sublevel"),
    new OdysseySceneDesc("SeaWorldUtsuboCaveStage", "Underwater Tunnel Sublevel"),
    new OdysseySceneDesc("SeaWorldVibrationStage", "Rumbling Floor Sublevel"),
    "Snow Kingdom",
    new OdysseySceneDesc("SnowWorldHomeStage", "Snow Kingdom"),
    new OdysseySceneDesc("IceWaterBlockExStage", "Freezing Water Sublevel"),
    new OdysseySceneDesc("SnowWorldTownStage", "Shiveria Town"),
    new OdysseySceneDesc("ByugoPuzzleExStage", "Wooden Block Puzzle Sublevel"),
    new OdysseySceneDesc("IceWaterDashExStage", "Freezing Water Path Sublevel"),
    new OdysseySceneDesc("KillerRailCollisionExStage", "Flower Road Sublevel"),
    new OdysseySceneDesc("SnowWorldCloudBonusExStage", "Sky Bonus Sublevel"),
    new OdysseySceneDesc("SnowWorldLobby000Stage", "Bound Bowl Lobby: Regular Cup"),
    new OdysseySceneDesc("SnowWorldRaceExStage", "Bound Bowl: Regular Cup"),
    new OdysseySceneDesc("SnowWorldLobby001Stage", "Bound Bowl Lobby: Master Cup"),
    new OdysseySceneDesc("SnowWorldRaceHardExStage", "Bound Bowl: Master Cup"),
    new OdysseySceneDesc("SnowWorldRaceTutorialStage", "Bound Bowl Tutorial"),
    new OdysseySceneDesc("SnowWorldRace000Stage", "Bound Bowl Race 1"),
    new OdysseySceneDesc("SnowWorldRace001Stage", "Bound Bowl Race 2"),
    new OdysseySceneDesc("SnowWorldLobbyExStage", "Bound Bowl Race 3"),
    new OdysseySceneDesc("SnowWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("IceWalkerExStage", "Trace-Walking Cave Sublevel"),
    new OdysseySceneDesc("SnowWorldCostumeStage", "Cold Room Costume Sublevel"),
    "Luncheon Kingdom",
    new OdysseySceneDesc("LavaWorldHomeStage", "Luncheon Kingdom"),
    new OdysseySceneDesc("LavaWorldUpDownExStage", "Magma Swap Sublevel"),
    new OdysseySceneDesc("LavaWorldBubbleLaneExStage", "Magma Narrow Path Sublevel"),
    new OdysseySceneDesc("LavaWorldFenceLiftExStage", "Lava Islands Sublevel"),
    new OdysseySceneDesc("LavaWorldClockExStage", "Spinning Athletics Sublevel"),
    new OdysseySceneDesc("LavaWorldExcavationExStage", "Cheese Rock Sublevel"),
    new OdysseySceneDesc("LavaWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("DemoLavaWorldScenario1EndStage"),
    new OdysseySceneDesc("CapAppearLavaLiftExStage", "Volcano Cave Sublevel"),
    new OdysseySceneDesc("ForkExStage", "Fork Flickin' Mountain Sublevel"),
    new OdysseySceneDesc("GabuzouClockExStage", "Rotating Gear Sublevel"),
    new OdysseySceneDesc("LavaWorldTreasureStage", "Treasure Room"),
    new OdysseySceneDesc("LavaWorldCostumeStage", "Simmering Room Costume Sublevel"),
    "Ruined Kingdom",
    new OdysseySceneDesc("BossRaidWorldHomeStage", "Ruined Kingdom"),
    new OdysseySceneDesc("BullRunExStage", "Chincho Army Sublevel"),
    new OdysseySceneDesc("DotTowerExStage", "Roulette Tower Sublevel"),
    "Bowser's Kingdom",
    new OdysseySceneDesc("SkyWorldHomeStage", "Bowser's Kingdom"),
    new OdysseySceneDesc("SkyWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("SkyWorldCostumeStage", "Folding Screen Costume Sublevel"),
    new OdysseySceneDesc("TsukkunClimbExStage", "Wooden Tower Sublevel"),
    new OdysseySceneDesc("TsukkunRotateExStage", "Spinning Tower Sublevel"),
    new OdysseySceneDesc("JizoSwitchExStage", "Jizo Area Sublevel"),
    new OdysseySceneDesc("SkyWorldCloudBonusExStage", "Sky Slope Bonus Stage"),
    new OdysseySceneDesc("KaronWingTowerStage", "Hexagon Tower Sublevel"),
    new OdysseySceneDesc("SkyWorldTreasureStage", "Bowser's Castle Treasure Vault"),
    "Moon Kingdom",
    new OdysseySceneDesc("MoonWorldHomeStage", "Moon Kingdom"),
    new OdysseySceneDesc("MoonWorldWeddingRoomStage", "Wedding Hall"),
    new OdysseySceneDesc("MoonWorldShopRoom", "Crazy Cap"),
    new OdysseySceneDesc("MoonWorldSphinxRoom", "Sphinx's Hidden Vault"),
    new OdysseySceneDesc("MoonWorldCaptureParadeStage", "Underground Moon Caverns"),
    new OdysseySceneDesc("MoonAthleticExStage", "Giant Swing Sublevel"),
    new OdysseySceneDesc("Galaxy2DExStage", "2D Galaxy Sublevel"),
    new OdysseySceneDesc("MoonWorldBasementStage", "Crumbling Cavern Bowser Stage"),
    new OdysseySceneDesc("MoonWorldKoopa1Stage", "Captured Bowser Stage Background"),
    "Mushroom Kingdom",
    new OdysseySceneDesc("PeachWorldHomeStage", "Mushroom Kingdom"),
    new OdysseySceneDesc("PeachWorldCastleStage", "Peach's Castle Interior"),
    new OdysseySceneDesc("PeachWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("PeachWorldCostumeStage", "SM64 Castle Courtyard Sublevel"),
    new OdysseySceneDesc("YoshiCloudExStage", "Yoshi Cloud Sublevel"),
    new OdysseySceneDesc("FukuwaraiMarioStage", "Mario Picture Match Sublevel"),
    new OdysseySceneDesc("DotHardExStage", "Moving 2D Sublevel"),
    new OdysseySceneDesc("PeachWorldPictureBossMagmaStage", "Cookatiel's Rematch Painting Room"),
    new OdysseySceneDesc("PeachWorldPictureMofumofuStage", "Mechawiggler's Rematch Painting Room"),
    new OdysseySceneDesc("PeachWorldPictureBossRaidStage", "Ruined Dragon's Rematch Painting Room"),
    new OdysseySceneDesc("PeachWorldPictureBossForestStage", "Torkdrift's Rematch Painting Room"),
    new OdysseySceneDesc("PeachWorldPictureBossKnuckleStage", "Knucklotec's Rematch Painting Room"),
    new OdysseySceneDesc("PeachWorldPictureGiantWanderBossStage", "Mollusque-Lanceur's Rematch Painting Room"),
    new OdysseySceneDesc("RevengeBossMagmaStage", "Cookatiel's Rematch Sublevel"),
    new OdysseySceneDesc("RevengeMofumofuStage", "Mechawiggler's Rematch Sublevel"),
    new OdysseySceneDesc("RevengeBossRaidStage", "Ruined Dragon's Rematch Sublevel"),
    new OdysseySceneDesc("RevengeForestBossStage", "Torkdrift's Rematch Sublevel"),
    new OdysseySceneDesc("RevengeBossKnuckleStage", "Knucklotec's Rematch Sublevel"),
    new OdysseySceneDesc("RevengeGiantWanderBossStage", "Mollusque-Lanceur's Rematch Sublevel"),
    "Dark Side",
    new OdysseySceneDesc("Special1WorldHomeStage", "Dark Side"),
    new OdysseySceneDesc("PackunPoisonNoCapExStage", "Invisible Road Sublevel"),
    new OdysseySceneDesc("KillerRoadNoCapExStage", "Breakdown Road Sublevel"),
    new OdysseySceneDesc("BikeSteelNoCapExStage", "Vanishing Road Sublevel"),
    new OdysseySceneDesc("SenobiTowerYoshiExStage", "Sinking Island Sublevel"),
    new OdysseySceneDesc("ShootingCityYoshiExStage", "Siege Sublevel, with Yoshi"),
    new OdysseySceneDesc("LavaWorldUpDownYoshiExStage", "Magma Swamp Sublevel"),
    new OdysseySceneDesc("Special1WorldTowerStackerStage", "Topper Rematch"),
    new OdysseySceneDesc("Special1WorldTowerBombTailStage", "Hariet Rematch"),
    new OdysseySceneDesc("Special1WorldTowerFireBlowerStage", "Spewart Rematch"),
    new OdysseySceneDesc("Special1WorldTowerCapThrowerStage", "Rango Rematch"),
    "Darker Side",
    new OdysseySceneDesc("Special2WorldHomeStage", "Darker Side"),
    new OdysseySceneDesc("Special2WorldKoopaStage", "Darker Side Bowser Area"),
    new OdysseySceneDesc("Special2WorldLavaStage", "Darker Side Course Area"),
    new OdysseySceneDesc("Special2WorldCloudStage", "Darker Side Cloud Area"),
    "Duplicates",
    new OdysseySceneDesc("MoonWorldKoopa2Stage", "Captured Bowser Stage Background Duplicate"),
    new OdysseySceneDesc("MoonWorldWeddingRoom2Stage", "Wedding Hall Duplicate"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
