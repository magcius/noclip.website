
import * as Viewer from '../../viewer';
import * as Yaz0 from '../../Common/Compression/Yaz0';
import * as BYML from '../../byml';
import { DataFetcher } from '../../DataFetcher';
import * as SARC from '../../fres_nx/sarc';
import * as BFRES from '../../fres_nx/bfres';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { BRTITextureHolder, BasicFRESRenderer, FMDLRenderer, FMDLData } from '../../fres_nx/render';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assert, assertExists } from '../../util';
import { mat4 } from 'gl-matrix';
import { SceneContext } from '../../SceneBase';
import { computeModelMatrixSRT, MathConstants } from '../../MathHelpers';

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

    public destroy(device: GfxDevice): void {
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
    "Cap",
    new OdysseySceneDesc("CapWorldHomeStage"),
    new OdysseySceneDesc("CapWorldTowerStage"),
    new OdysseySceneDesc("RollingExStage"),
    new OdysseySceneDesc("PoisonWaveExStage"),
    new OdysseySceneDesc("PushBlockExStage"),
    new OdysseySceneDesc("FrogSearchExStage"),
    "Waterfall",
    new OdysseySceneDesc("WaterfallWorldHomeStage"),
    new OdysseySceneDesc("CapAppearExStage"),
    new OdysseySceneDesc("WanwanClashExStage"),
    new OdysseySceneDesc("Lift2DExStage"),
    new OdysseySceneDesc("WindBlowExStage"),
    new OdysseySceneDesc("TrexPoppunExStage"),
    "Sand",
    new OdysseySceneDesc("SandWorldHomeStage"),
    new OdysseySceneDesc("SandWorldMeganeExStage"),
    new OdysseySceneDesc("SandWorldSphinxExStage"),
    new OdysseySceneDesc("SandWorldUnderground000Stage"),
    new OdysseySceneDesc("SandWorldKillerExStage"),
    new OdysseySceneDesc("SandWorldShopStage"),
    new OdysseySceneDesc("SandWorldPressExStage"),
    new OdysseySceneDesc("SandWorldPyramid000Stage"),
    new OdysseySceneDesc("SandWorldPyramid001Stage"),
    new OdysseySceneDesc("SandWorldCostumeStage"),
    new OdysseySceneDesc("SandWorldUnderground001Stage"),
    new OdysseySceneDesc("SandWorldRotateExStage"),
    new OdysseySceneDesc("SandWorldSlotStage"),
    new OdysseySceneDesc("SandWorldSecretStage"),
    new OdysseySceneDesc("MeganeLiftExStage"),
    new OdysseySceneDesc("RocketFlowerExStage"),
    new OdysseySceneDesc("WaterTubeExStage"),
    new OdysseySceneDesc("SandWorldVibrationStage"),
    "Forest",
    new OdysseySceneDesc("ForestWorldHomeStage"),
    new OdysseySceneDesc("ForestWorldTowerStage"),
    new OdysseySceneDesc("ForestWorldWaterExStage"),
    new OdysseySceneDesc("ForestWorldCloudBonusExStage"),
    new OdysseySceneDesc("ShootingElevatorExStage"),
    new OdysseySceneDesc("FogMountainExStage"),
    new OdysseySceneDesc("ForestWorldBossStage"),
    new OdysseySceneDesc("RailCollisionExStage"),
    new OdysseySceneDesc("AnimalChaseExStage"),
    new OdysseySceneDesc("ForestWorldWoodsStage"),
    new OdysseySceneDesc("ForestWorldWoodsTreasureStage"),
    new OdysseySceneDesc("PackunPoisonExStage"),
    new OdysseySceneDesc("ForestWorldBonusStage"),
    new OdysseySceneDesc("ForestWorldWoodsCostumeStage"),
    new OdysseySceneDesc("KillerRoadExStage"),
    "Lake",
    new OdysseySceneDesc("LakeWorldHomeStage"),
    new OdysseySceneDesc("LakeWorldShopStage"),
    new OdysseySceneDesc("FrogPoisonExStage"),
    new OdysseySceneDesc("TrampolineWallCatchExStage"),
    new OdysseySceneDesc("GotogotonExStage"),
    new OdysseySceneDesc("FastenerExStage"),
    "Cloud",
    new OdysseySceneDesc("CloudWorldHomeStage"),
    new OdysseySceneDesc("Cube2DExStage"),
    new OdysseySceneDesc("FukuwaraiKuriboStage"),
    "Clash",
    new OdysseySceneDesc("ClashWorldHomeStage"),
    new OdysseySceneDesc("ClashWorldShopStage"),
    new OdysseySceneDesc("ImomuPoisonExStage"),
    new OdysseySceneDesc("JangoExStage"),
    "City",
    new OdysseySceneDesc("CityWorldHomeStage"),
    new OdysseySceneDesc("CityWorldShop01Stage"),
    new OdysseySceneDesc("Note2D3DRoomExStage"),
    new OdysseySceneDesc("CityWorldFactoryStage"),
    new OdysseySceneDesc("CityWorldMainTowerStage"),
    new OdysseySceneDesc("PoleKillerExStage"),
    new OdysseySceneDesc("BikeSteelExStage"),
    new OdysseySceneDesc("CapRotatePackunExStage"),
    new OdysseySceneDesc("ElectricWireExStage"),
    new OdysseySceneDesc("CityWorldSandSlotStage"),
    new OdysseySceneDesc("RadioControlExStage"),
    new OdysseySceneDesc("ShootingCityExStage"),
    new OdysseySceneDesc("SwingSteelExStage"),
    new OdysseySceneDesc("PoleGrabCeilExStage"),
    new OdysseySceneDesc("Theater2DExStage"),
    new OdysseySceneDesc("DonsukeExStage"),
    new OdysseySceneDesc("CityPeopleRoadStage"),
    new OdysseySceneDesc("TrexBikeExStage"),
    "Sea",
    new OdysseySceneDesc("SeaWorldHomeStage"),
    new OdysseySceneDesc("SeaWorldCostumeStage"),
    new OdysseySceneDesc("WaterValleyExStage"),
    new OdysseySceneDesc("SeaWorldSecretStage"),
    new OdysseySceneDesc("CloudExStage"),
    new OdysseySceneDesc("SenobiTowerExStage"),
    new OdysseySceneDesc("ReflectBombExStage"),
    new OdysseySceneDesc("TogezoRotateExStage"),
    new OdysseySceneDesc("SeaWorldSneakingManStage"),
    new OdysseySceneDesc("SeaWorldUtsuboCaveStage"),
    new OdysseySceneDesc("SeaWorldVibrationStage"),
    "Snow",
    new OdysseySceneDesc("SnowWorldHomeStage"),
    new OdysseySceneDesc("IceWaterBlockExStage"),
    new OdysseySceneDesc("SnowWorldTownStage"),
    new OdysseySceneDesc("ByugoPuzzleExStage"),
    new OdysseySceneDesc("IceWaterDashExStage"),
    new OdysseySceneDesc("KillerRailCollisionExStage"),
    new OdysseySceneDesc("SnowWorldCloudBonusExStage"),
    new OdysseySceneDesc("SnowWorldLobby000Stage"),
    new OdysseySceneDesc("SnowWorldLobby001Stage"),
    new OdysseySceneDesc("SnowWorldShopStage"),
    new OdysseySceneDesc("SnowWorldRace000Stage"),
    new OdysseySceneDesc("IceWalkerExStage"),
    new OdysseySceneDesc("SnowWorldLobbyExStage"),
    new OdysseySceneDesc("SnowWorldRaceExStage"),
    new OdysseySceneDesc("SnowWorldCostumeStage"),
    new OdysseySceneDesc("SnowWorldRaceTutorialStage"),
    new OdysseySceneDesc("SnowWorldRace001Stage"),
    new OdysseySceneDesc("SnowWorldRaceHardExStage"),
    "Lava",
    new OdysseySceneDesc("LavaWorldHomeStage"),
    new OdysseySceneDesc("LavaWorldUpDownExStage"),
    new OdysseySceneDesc("LavaWorldBubbleLaneExStage"),
    new OdysseySceneDesc("LavaWorldFenceLiftExStage"),
    new OdysseySceneDesc("LavaWorldClockExStage"),
    new OdysseySceneDesc("LavaWorldExcavationExStage"),
    new OdysseySceneDesc("LavaWorldShopStage"),
    new OdysseySceneDesc("DemoLavaWorldScenario1EndStage"),
    new OdysseySceneDesc("CapAppearLavaLiftExStage"),
    new OdysseySceneDesc("ForkExStage"),
    new OdysseySceneDesc("GabuzouClockExStage"),
    new OdysseySceneDesc("LavaWorldTreasureStage"),
    new OdysseySceneDesc("LavaWorldCostumeStage"),
    "BossRaid",
    new OdysseySceneDesc("BossRaidWorldHomeStage"),
    new OdysseySceneDesc("BullRunExStage"),
    new OdysseySceneDesc("DotTowerExStage"),
    "Sky",
    new OdysseySceneDesc("SkyWorldHomeStage"),
    new OdysseySceneDesc("SkyWorldShopStage"),
    new OdysseySceneDesc("SkyWorldCostumeStage"),
    new OdysseySceneDesc("TsukkunClimbExStage"),
    new OdysseySceneDesc("TsukkunRotateExStage"),
    new OdysseySceneDesc("JizoSwitchExStage"),
    new OdysseySceneDesc("SkyWorldCloudBonusExStage"),
    new OdysseySceneDesc("KaronWingTowerStage"),
    new OdysseySceneDesc("SkyWorldTreasureStage"),
    "Moon",
    new OdysseySceneDesc("MoonWorldHomeStage"),
    new OdysseySceneDesc("MoonWorldWeddingRoomStage"),
    new OdysseySceneDesc("MoonWorldShopRoom"),
    new OdysseySceneDesc("MoonWorldSphinxRoom"),
    new OdysseySceneDesc("MoonWorldCaptureParadeStage"),
    new OdysseySceneDesc("MoonAthleticExStage"),
    new OdysseySceneDesc("Galaxy2DExStage"),
    new OdysseySceneDesc("MoonWorldBasementStage"),
    new OdysseySceneDesc("MoonWorldKoopa1Stage"),
    new OdysseySceneDesc("MoonWorldKoopa2Stage"),
    new OdysseySceneDesc("MoonWorldWeddingRoom2Stage"),
    "Peach",
    new OdysseySceneDesc("PeachWorldHomeStage"),
    new OdysseySceneDesc("PeachWorldCastleStage"),
    new OdysseySceneDesc("PeachWorldPictureBossMagmaStage"),
    new OdysseySceneDesc("PeachWorldPictureMofumofuStage"),
    new OdysseySceneDesc("PeachWorldPictureBossRaidStage"),
    new OdysseySceneDesc("PeachWorldPictureBossForestStage"),
    new OdysseySceneDesc("PeachWorldPictureBossKnuckleStage"),
    new OdysseySceneDesc("PeachWorldPictureGiantWanderBossStage"),
    new OdysseySceneDesc("PeachWorldShopStage"),
    new OdysseySceneDesc("PeachWorldCostumeStage"),
    new OdysseySceneDesc("YoshiCloudExStage"),
    new OdysseySceneDesc("FukuwaraiMarioStage"),
    new OdysseySceneDesc("DotHardExStage"),
    new OdysseySceneDesc("RevengeMofumofuStage"),
    new OdysseySceneDesc("RevengeBossMagmaStage"),
    new OdysseySceneDesc("RevengeForestBossStage"),
    new OdysseySceneDesc("RevengeBossRaidStage"),
    new OdysseySceneDesc("RevengeBossKnuckleStage"),
    new OdysseySceneDesc("RevengeGiantWanderBossStage"),
    "Special1",
    new OdysseySceneDesc("Special1WorldHomeStage"),
    new OdysseySceneDesc("PackunPoisonNoCapExStage"),
    new OdysseySceneDesc("KillerRoadNoCapExStage"),
    new OdysseySceneDesc("BikeSteelNoCapExStage"),
    new OdysseySceneDesc("SenobiTowerYoshiExStage"),
    new OdysseySceneDesc("ShootingCityYoshiExStage"),
    new OdysseySceneDesc("LavaWorldUpDownYoshiExStage"),
    new OdysseySceneDesc("Special1WorldTowerStackerStage"),
    new OdysseySceneDesc("Special1WorldTowerBombTailStage"),
    new OdysseySceneDesc("Special1WorldTowerFireBlowerStage"),
    new OdysseySceneDesc("Special1WorldTowerCapThrowerStage"),
    "Special2",
    new OdysseySceneDesc("Special2WorldKoopaStage"),
    new OdysseySceneDesc("Special2WorldHomeStage"),
    new OdysseySceneDesc("Special2WorldLavaStage"),
    new OdysseySceneDesc("Special2WorldCloudStage"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
