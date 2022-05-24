
import * as Viewer from '../viewer';
import * as Yaz0 from '../Common/Compression/Yaz0';
import * as BYML from '../byml';
import { DataFetcher } from '../DataFetcher';
import * as SARC from './sarc';
import * as BFRES from './bfres';
import { GfxBindingLayoutDescriptor, GfxDevice } from '../gfx/platform/GfxPlatform';
import { BRTITextureHolder, BasicFRESRenderer, FMDLRenderer, FMDLData } from './render';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, assertExists } from '../util';
import { mat4 } from 'gl-matrix';
import { SceneContext } from '../SceneBase';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers';

const pathBase = `smo`;

class ResourceSystem {
    public textureHolder = new BRTITextureHolder();
    public mounts = new Map<string, SARC.SARC>();
    public bfresCache = new Map<string, BFRES.FRES | null>();
    public fmdlDataCache = new Map<string, FMDLData | null>();
    public arcPromiseCache = new Map<string, Promise<SARC.SARC | null>>();

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
                    fmdlData = new FMDLData(device, fres.fmdl[0]);
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
        const resourceSystem = new ResourceSystem();
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
        const cache = sceneRenderer.renderHelper.getCache();

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
    new OdysseySceneDesc("PoisonWaveExStage", "Poison Wave Sublevel"),
    new OdysseySceneDesc("PushBlockExStage", "Block Pushing Sublevel"),
    new OdysseySceneDesc("FrogSearchExStage", "Frog Search Sublevel"),
    "Cascade Kingdom",
    new OdysseySceneDesc("WaterfallWorldHomeStage", "Cascade Kingdom"),
    new OdysseySceneDesc("CapAppearExStage", "Cap Appear Sublevel"),
    new OdysseySceneDesc("WanwanClashExStage"),
    new OdysseySceneDesc("Lift2DExStage", "2D Lift Sublevel"),
    new OdysseySceneDesc("WindBlowExStage", "Wind Blow Sublevel"),
    new OdysseySceneDesc("TrexPoppunExStage", "T-Rex Poppun Sublevel"),
    "Sand Kingdom",
    new OdysseySceneDesc("SandWorldHomeStage", "Sand Kingdom"),
    new OdysseySceneDesc("SandWorldMeganeExStage", "Megane Sublevel"),
    new OdysseySceneDesc("SandWorldSphinxExStage", "Sphinx room"),
    new OdysseySceneDesc("SandWorldUnderground000Stage", "Sand Kingdom Underground 1"),
    new OdysseySceneDesc("SandWorldUnderground001Stage", "Sand Kingdom Underground 2"),
    new OdysseySceneDesc("SandWorldKillerExStage", "Killer Sublevel"),
    new OdysseySceneDesc("SandWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("SandWorldPressExStage", "Press Sublevel"),
    new OdysseySceneDesc("SandWorldPyramid000Stage", "Inverted Pyramid 1"),
    new OdysseySceneDesc("SandWorldPyramid001Stage", "Inverted Pyramid 2"),
    new OdysseySceneDesc("SandWorldCostumeStage", "Sand Kingdom Costume Stage"),
    new OdysseySceneDesc("SandWorldRotateExStage", "Rotate Sublevel"),
    new OdysseySceneDesc("SandWorldSlotStage", "Slots"),
    new OdysseySceneDesc("SandWorldSecretStage", "Sand Kingdom Secret Sublevel"),
    new OdysseySceneDesc("MeganeLiftExStage", "Megane Lift Sublevel"),
    new OdysseySceneDesc("RocketFlowerExStage", "Rocket Flower Sublevel"),
    new OdysseySceneDesc("WaterTubeExStage", "Water Tube Sublevel"),
    new OdysseySceneDesc("SandWorldVibrationStage", "Vibration Sublevel"),
    "Wooded Kingdom",
    new OdysseySceneDesc("ForestWorldHomeStage", "Wooded Kingdom"),
    new OdysseySceneDesc("ForestWorldTowerStage", "Wooded Kingdom Tower"),
    new OdysseySceneDesc("ForestWorldWaterExStage", "Rising Water Sublevel"),
    new OdysseySceneDesc("ForestWorldCloudBonusExStage", "Cloud Bonus stage"),
    new OdysseySceneDesc("ShootingElevatorExStage", "Shooting Elevator Sublevel"),
    new OdysseySceneDesc("FogMountainExStage", "Fog Mountain Sublevel"),
    new OdysseySceneDesc("ForestWorldBossStage", "Secret Garden (Boss)"),
    new OdysseySceneDesc("RailCollisionExStage", "Rail Collision Sublevel"),
    new OdysseySceneDesc("AnimalChaseExStage", "Animal Chase Sublevel"),
    new OdysseySceneDesc("ForestWorldWoodsStage", "Deep Woods"),
    new OdysseySceneDesc("ForestWorldWoodsTreasureStage", "Deep Woods treasure stage"),
    new OdysseySceneDesc("PackunPoisonExStage", "Packun Poison Sublevel"),
    new OdysseySceneDesc("ForestWorldBonusStage", "Bonus Stage"),
    new OdysseySceneDesc("ForestWorldWoodsCostumeStage", "Deep Woods costume stage"),
    new OdysseySceneDesc("KillerRoadExStage", "Killer Road Sublevel"),
    "Lake Kingdom",
    new OdysseySceneDesc("LakeWorldHomeStage", "Lake Kingdom"),
    new OdysseySceneDesc("LakeWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("FrogPoisonExStage", "Frog Poison Sublevel"),
    new OdysseySceneDesc("TrampolineWallCatchExStage", "Trampoline Wall Catch Sublevel"),
    new OdysseySceneDesc("GotogotonExStage", "Gotogoton Sublevel"),
    new OdysseySceneDesc("FastenerExStage", "Fastener Sublevel"),
    "Cloud Kingdom",
    new OdysseySceneDesc("CloudWorldHomeStage", "Cloud Kingdom"),
    new OdysseySceneDesc("Cube2DExStage", "2D Cube Sublevel"),
    new OdysseySceneDesc("FukuwaraiKuriboStage"),
    "Lost Kingdom",
    new OdysseySceneDesc("ClashWorldHomeStage", "Lost Kingdom"),
    new OdysseySceneDesc("ClashWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("ImomuPoisonExStage"),
    new OdysseySceneDesc("JangoExStage", "Jango Sublevel"),
    "Metro Kingdom",
    new OdysseySceneDesc("CityWorldHomeStage", "Metro Kingdom"),
    new OdysseySceneDesc("CityWorldShop01Stage", "Crazy Cap"),
    new OdysseySceneDesc("Note2D3DRoomExStage", "2D 3D Note Sublevel"),
    new OdysseySceneDesc("CityWorldFactoryStage", "New Donk City Power Plant"),
    new OdysseySceneDesc("CityWorldMainTowerStage", "New Donk City Hall Interior"),
    new OdysseySceneDesc("PoleKillerExStage"),
    new OdysseySceneDesc("BikeSteelExStage"),
    new OdysseySceneDesc("CapRotatePackunExStage"),
    new OdysseySceneDesc("ElectricWireExStage"),
    new OdysseySceneDesc("CityWorldSandSlotStage", "Slots"),
    new OdysseySceneDesc("RadioControlExStage", "RC Car Sublevel"),
    new OdysseySceneDesc("ShootingCityExStage", "Tank Sublevel"),
    new OdysseySceneDesc("SwingSteelExStage"),
    new OdysseySceneDesc("PoleGrabCeilExStage"),
    new OdysseySceneDesc("Theater2DExStage", "SMB 1-1 Sublevel"),
    new OdysseySceneDesc("DonsukeExStage"),
    new OdysseySceneDesc("CityPeopleRoadStage", "Crowded Sublevel"),
    new OdysseySceneDesc("TrexBikeExStage", "T-Rex Chase Sublevel"),
    "Seaside Kingdom",
    new OdysseySceneDesc("SeaWorldHomeStage", "Seaside Kingdom"),
    new OdysseySceneDesc("SeaWorldCostumeStage", "Seaside Kingdom Costume Stage"),
    new OdysseySceneDesc("WaterValleyExStage"),
    new OdysseySceneDesc("SeaWorldSecretStage", "Seaside Secret Stage"),
    new OdysseySceneDesc("CloudExStage", "Cloud Sublevel"),
    new OdysseySceneDesc("SenobiTowerExStage"),
    new OdysseySceneDesc("ReflectBombExStage", "Bomb Reflect Sublevel"),
    new OdysseySceneDesc("TogezoRotateExStage"),
    new OdysseySceneDesc("SeaWorldSneakingManStage"),
    new OdysseySceneDesc("SeaWorldUtsuboCaveStage"),
    new OdysseySceneDesc("SeaWorldVibrationStage", "Vibration Sublevel"),
    "Snow Kingdom",
    new OdysseySceneDesc("SnowWorldHomeStage", "Snow Kingdom"),
    new OdysseySceneDesc("IceWaterBlockExStage"),
    new OdysseySceneDesc("SnowWorldTownStage", "Shiveria Town"),
    new OdysseySceneDesc("ByugoPuzzleExStage"),
    new OdysseySceneDesc("IceWaterDashExStage"),
    new OdysseySceneDesc("KillerRailCollisionExStage"),
    new OdysseySceneDesc("SnowWorldCloudBonusExStage"),
    new OdysseySceneDesc("SnowWorldLobby000Stage", "Bound Bowl Lobby: Regular Cup"),
    new OdysseySceneDesc("SnowWorldRaceExStage", "Bound Bowl: Regular Cup"),
    new OdysseySceneDesc("SnowWorldLobby001Stage", "Bound Bowl Lobby: Master Cup"),
    new OdysseySceneDesc("SnowWorldRaceHardExStage", "Bound Bowl: Master Cup"),
    new OdysseySceneDesc("SnowWorldRaceTutorialStage", "Bound Bowl Tutorial"),
    new OdysseySceneDesc("SnowWorldRace000Stage"),
    new OdysseySceneDesc("SnowWorldRace001Stage"),
    new OdysseySceneDesc("SnowWorldLobbyExStage"),
    new OdysseySceneDesc("SnowWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("IceWalkerExStage"),
    new OdysseySceneDesc("SnowWorldCostumeStage", "Snow Kingdom Costume Stage"),
    "Luncheon Kingdom",
    new OdysseySceneDesc("LavaWorldHomeStage", "Luncheon Kingdom"),
    new OdysseySceneDesc("LavaWorldUpDownExStage"),
    new OdysseySceneDesc("LavaWorldBubbleLaneExStage"),
    new OdysseySceneDesc("LavaWorldFenceLiftExStage"),
    new OdysseySceneDesc("LavaWorldClockExStage"),
    new OdysseySceneDesc("LavaWorldExcavationExStage"),
    new OdysseySceneDesc("LavaWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("DemoLavaWorldScenario1EndStage"),
    new OdysseySceneDesc("CapAppearLavaLiftExStage"),
    new OdysseySceneDesc("ForkExStage"),
    new OdysseySceneDesc("GabuzouClockExStage"),
    new OdysseySceneDesc("LavaWorldTreasureStage", "Treasure Stage"),
    new OdysseySceneDesc("LavaWorldCostumeStage", "Luncheon Kingdom Costume Stage"),
    "Ruined Kingdom",
    new OdysseySceneDesc("BossRaidWorldHomeStage", "Ruined Kingdom"),
    new OdysseySceneDesc("BullRunExStage", "Chargin' Chuck Sublevel"),
    new OdysseySceneDesc("DotTowerExStage", "Platform Switch Sublevel"),
    "Bowser's Kingdom",
    new OdysseySceneDesc("SkyWorldHomeStage", "Bowser's Kingdom"),
    new OdysseySceneDesc("SkyWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("SkyWorldCostumeStage", "Bowser's Kingdom Costume Stage"),
    new OdysseySceneDesc("TsukkunClimbExStage"),
    new OdysseySceneDesc("TsukkunRotateExStage"),
    new OdysseySceneDesc("JizoSwitchExStage"),
    new OdysseySceneDesc("SkyWorldCloudBonusExStage", "Cloud Bonus Stage"),
    new OdysseySceneDesc("KaronWingTowerStage"),
    new OdysseySceneDesc("SkyWorldTreasureStage", "Treasure Stage"),
    "Moon Kingdom",
    new OdysseySceneDesc("MoonWorldHomeStage", "Moon Kingdom"),
    new OdysseySceneDesc("MoonWorldWeddingRoomStage", "Wedding Hall"),
    new OdysseySceneDesc("MoonWorldShopRoom", "Crazy Cap"),
    new OdysseySceneDesc("MoonWorldSphinxRoom", "Sphinx Room"),
    new OdysseySceneDesc("MoonWorldCaptureParadeStage", "Capture Parade"),
    new OdysseySceneDesc("MoonAthleticExStage", "Athletic Sublevel"),
    new OdysseySceneDesc("Galaxy2DExStage", "2D Galaxy Sublevel"),
    new OdysseySceneDesc("MoonWorldBasementStage", "Moon Kingdom Basement"),
    new OdysseySceneDesc("MoonWorldKoopa1Stage", "Captured Bowser Stage Background"),
    "Mushroom Kingdom",
    new OdysseySceneDesc("PeachWorldHomeStage", "Mushroom Kingdom"),
    new OdysseySceneDesc("PeachWorldCastleStage", "Peach's Castle Interior"),
    new OdysseySceneDesc("PeachWorldShopStage", "Crazy Cap"),
    new OdysseySceneDesc("PeachWorldCostumeStage", "SM64 Castle Courtyard Sublevel"),
    new OdysseySceneDesc("YoshiCloudExStage", "Yoshi Cloud Sublevel"),
    new OdysseySceneDesc("FukuwaraiMarioStage"),
    new OdysseySceneDesc("DotHardExStage"),
    new OdysseySceneDesc("PeachWorldPictureBossMagmaStage", "Luncheon Kingdom Rematch Painting"),
    new OdysseySceneDesc("PeachWorldPictureMofumofuStage", "Metro Kingdom Rematch Painting"),
    new OdysseySceneDesc("PeachWorldPictureBossRaidStage", "Ruined Kingdom Rematch Painting"),
    new OdysseySceneDesc("PeachWorldPictureBossForestStage", "Wooded Kingdom Rematch Painting"),
    new OdysseySceneDesc("PeachWorldPictureBossKnuckleStage", "Sand Kingdom Rematch Painting"),
    new OdysseySceneDesc("PeachWorldPictureGiantWanderBossStage", "Seaside Kingdom Rematch Painting"),
    new OdysseySceneDesc("RevengeBossMagmaStage", "Luncheon Kingdom Rematch"),
    new OdysseySceneDesc("RevengeMofumofuStage", "Metro Kingdom Rematch"),
    new OdysseySceneDesc("RevengeBossRaidStage", "Ruined Kingdom Rematch"),
    new OdysseySceneDesc("RevengeForestBossStage", "Wooded Kingdom Rematch"),
    new OdysseySceneDesc("RevengeBossKnuckleStage", "Sand Kingdom Rematch"),
    new OdysseySceneDesc("RevengeGiantWanderBossStage", "Seaside Kingdom Rematch"),
    "Dark Side",
    new OdysseySceneDesc("Special1WorldHomeStage", "Dark Side"),
    new OdysseySceneDesc("PackunPoisonNoCapExStage"),
    new OdysseySceneDesc("KillerRoadNoCapExStage"),
    new OdysseySceneDesc("BikeSteelNoCapExStage"),
    new OdysseySceneDesc("SenobiTowerYoshiExStage"),
    new OdysseySceneDesc("ShootingCityYoshiExStage", "Tank Sublevel, with Yoshi"),
    new OdysseySceneDesc("LavaWorldUpDownYoshiExStage"),
    new OdysseySceneDesc("Special1WorldTowerStackerStage", "Topper Rematch"),
    new OdysseySceneDesc("Special1WorldTowerBombTailStage", "Bomb Tail Rematch"),
    new OdysseySceneDesc("Special1WorldTowerFireBlowerStage", "Spewart Rematch"),
    new OdysseySceneDesc("Special1WorldTowerCapThrowerStage", "Cap Thrower Rematch"),
    "Darker Side",
    new OdysseySceneDesc("Special2WorldHomeStage", "Darker Side"),
    new OdysseySceneDesc("Special2WorldKoopaStage", "Bowser Boss"),
    new OdysseySceneDesc("Special2WorldLavaStage", "Lava Stage"),
    new OdysseySceneDesc("Special2WorldCloudStage", "Cloud Stage"),
    "Duplicates",
    new OdysseySceneDesc("MoonWorldKoopa2Stage", "Captured Bowser Stage Background Duplicate"),
    new OdysseySceneDesc("MoonWorldWeddingRoom2Stage", "Wedding Hall Duplicate"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
