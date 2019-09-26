
import * as RARC from '../rarc';

import { NameObjFactory, SceneObjHolder } from "./smg_scenes";
import { Kinopio, TicoComet, EarthenPipe, StarPiece, CollapsePlane, BlackHole, Peach, PenguinRacer, Coin, Penguin, SimpleEffectObj, EffectObjR1000F50, GCaptureTarget, FountainBig, AstroEffectObj, WarpPod, AstroCountDownPlate, Butler, Rosetta, Tico, Sky, Air, ShootingStar, EffectObj20x20x10SyncClipping, EffectObj50x50x10SyncClipping, EffectObj10x10x10SyncClipping, AstroMapObj, EffectObjR100F50SyncClipping, PriorDrawAir, BlueChip, YellowChip, PeachCastleGardenPlanet, SimpleMapObj, CrystalCage, PlanetMap, HatchWaterPlanet, RotateMoveObj, LavaSteam } from "./Actors";
import { OceanBowl } from "./OceanBowl";
import { JMapInfoIter, createCsvParser } from "./JMapInfo";

interface ActorTableEntry {
    objName: string;
    factory: NameObjFactory;
    extraObjectDataArchiveNames: string[];
}

function _(objName: string, factory: NameObjFactory, extraObjectDataArchiveNames: string[] = []): ActorTableEntry {
    return { objName, factory, extraObjectDataArchiveNames };
}

const ActorTable: ActorTableEntry[] = [
    // NPCs
    _("Butler",                         Butler),
    _("Kinopio",                        Kinopio),
    _("Peach",                          Peach),
    _("Penguin",                        Penguin),
    _("PenguinRacer",                   PenguinRacer),
    _("PenguinRacerLeader",             PenguinRacer),
    _("Rosetta",                        Rosetta),
    _("Tico",                           Tico),
    _("TicoAstro",                      Tico),
    _("TicoComet",                      TicoComet),

    // Misc objects
    _("BlackHole",                      BlackHole),
    _("BlackHoleCube",                  BlackHole),
    _("BlueChip",                       BlueChip),
    _("Coin",                           Coin),
    _("PurpleCoin",                     Coin),
    _("CollapsePlane",                  CollapsePlane),
    _("CrystalCageS",                   CrystalCage),
    _("CrystalCageM",                   CrystalCage),
    _("CrystalCageL",                   CrystalCage),
    _("EarthenPipe",                    EarthenPipe),
    _("EarthenPipeInWater",             EarthenPipe),
    _("FountainBig",                    FountainBig),
    _("GCaptureTarget",                 GCaptureTarget),
    _("OceanBowl",                      OceanBowl),
    _("StarPiece",                      StarPiece),
    _("WarpPod",                        WarpPod),
    _("YellowChip",                     YellowChip),

    // Not good enough for prime-time yet.
    _("ShootingStar",                   ShootingStar),

    // Sky/Air
    _("AstroDomeSkyA",                  Sky),
    _("AuroraSky",                      Sky),
    _("BigFallSky",                     Sky),
    _("Blue2DSky",                      Sky),
    _("BrightGalaxySky",                Sky),
    _("ChildRoomSky",                   Sky),
    _("CloudSky",                       Sky),
    _("DarkSpaceStormSky",              Sky),
    _("DesertSky",                      Sky),
    _("DotPatternSky",                  Sky),
    _("FamicomMarioSky",                Sky),
    _("GalaxySky",                      Sky),
    _("GoodWeatherSky",                 Sky),
    _("GreenPlanetOrbitSky",            Sky),
    _("HalfGalaxySky",                  Sky),
    _("HolePlanetInsideSky",            Sky),
    _("KoopaVS1Sky",                    Sky),
    _("KoopaVS2Sky",                    Sky),
    _("KoopaJrLv3Sky",                  Sky),
    _("MagmaMonsterSky",                Sky),
    _("MemoryRoadSky",                  Sky),
    _("MilkyWaySky",                    Sky),
    _("OmoteuLandSky",                  Sky),
    _("PhantomSky",                     Sky),
    _("RockPlanetOrbitSky",             Sky),
    _("SummerSky",                      Sky),
    _("VRDarkSpace",                    Sky),
    _("VROrbit",                        Sky),
    _("VRSandwichSun",                  Sky),
    _("VsKoopaLv3Sky",                  Sky),
    _("HomeAir",                        Air),
    _("SphereAir",                      PriorDrawAir),
    _("SunsetAir",                      Air),
    _("FineAir",                        Air),
    _("DimensionAir",                   Air),
    _("DarknessRoomAir",                Air),
    _("TwilightAir",                    Air),

    // SMG2 skies
    _("BeyondGalaxySky",                Sky),
    _("BeyondHellValleySky",            Sky),
    _("BeyondHorizonSky",               Sky),
    _("BeyondOrbitSky",                 Sky),
    _("BeyondPhantomSky",               Sky),
    _("BeyondSandSky",                  Sky),
    _("BeyondSandNightSky",             Sky),
    _("BeyondSummerSky",                Sky),
    _("BeyondTitleSky",                 Sky),
    _("FineAndStormSky",                Sky),
    _("BeyondDimensionAir",             Air),

    // Misc. Map Objects
    _("KoopaShipE",                     SimpleMapObj),
    _("PeachCastleTownBeforeAttack",    SimpleMapObj, ["PeachCastleTownBeforeAttackBloom"]),
    _("PeachCastleTownGate",            SimpleMapObj),
    _("OceanFloaterTowerRotateStepA",   RotateMoveObj),
    _("OceanFloaterTowerRotateStepB",   RotateMoveObj),
    _("OceanFloaterTowerRotateStepC",   RotateMoveObj),
    _("OceanFloaterTowerRotateStepD",   RotateMoveObj),
    _("HopperBeltConveyerRotatePartsA", RotateMoveObj),
    _("StarDustRollingStepA",           RotateMoveObj),
    _("PowerStarKeeperA",               RotateMoveObj),
    _("PowerStarKeeperB",               RotateMoveObj),
    _("PowerStarKeeperC",               RotateMoveObj),
    _("WaterBazookaTowerMoveStepA",     RotateMoveObj),
    _("RollingOvalPlanetParts",         RotateMoveObj),
    _("BattleShipMovePartsA",           RotateMoveObj),
    _("BattleShipMovePartsB",           RotateMoveObj),
    _("TeresaRacePartsA",               RotateMoveObj),
    _("SweetsDecoratePartsSpoon",       RotateMoveObj),
    _("SweetsDecoratePartsFork",        RotateMoveObj),
    _("SandStreamMoveStepsA",           RotateMoveObj),
    _("SandStreamMoveStepsB",           RotateMoveObj),
    _("RayGunPlanetPartsGear",          RotateMoveObj),
    _("ToyFactoryDecoratePartsGearA",   RotateMoveObj),
    _("MiniMechaKoopaPartsGear",        RotateMoveObj),
    _("MiniMechaKoopaPartsCage",        RotateMoveObj),
    _("AsteroidBlockRotateStepA",       RotateMoveObj),
    _("WindMillPropeller",              RotateMoveObj),
    _("WindMillPropellerMini",          RotateMoveObj),
    _("LavaRotateStepsRotatePartsA",    RotateMoveObj),
    _("LavaRotateStepsRotatePartsB",    RotateMoveObj),
    _("LavaRotateStepsRotatePartsC",    RotateMoveObj),
    _("LavaRotateStepsRotatePartsD",    RotateMoveObj),
    _("QuickSand2DMovePartsA",          RotateMoveObj),
    _("DeathPromenadeRotateCircleL",    RotateMoveObj),
    _("DeathPromenadeRotateCircleS",    RotateMoveObj),
    _("HellBallRotatePartsA",           RotateMoveObj),
    _("HellBallRotatePartsB",           RotateMoveObj),
    _("HellBallRotatePartsC",           RotateMoveObj),
    _("HellBallRotatePartsD",           RotateMoveObj),
    _("HellBallRotatePartsE",           RotateMoveObj),
    _("HellBallRotatePartsF",           RotateMoveObj),
    _("HellBallRotatePartsG",           RotateMoveObj),
    _("CandyLiftA",                     RotateMoveObj),
    _("CandyLiftB",                     RotateMoveObj),
    _("HeavensDoorMiddleRotatePartsA",  RotateMoveObj),
    _("HeavensDoorMiddleRotatePartsB",  RotateMoveObj),
    _("HeavensDoorInsideRotatePartsA",  RotateMoveObj),
    _("HeavensDoorInsideRotatePartsB",  RotateMoveObj),
    _("HeavensDoorInsideRotatePartsC",  RotateMoveObj),
    _("MechaKoopaPartsCollar",          RotateMoveObj),
    _("HoleBeltConveyerPartsG",         RotateMoveObj),
    _("ChallengeBallAccelCylinderA",    RotateMoveObj),
    _("ChallengeBallGearA",             RotateMoveObj),
    _("ChallengeBallRotateBridgeA",     RotateMoveObj),
    _("TrialBubbleRotateWallA",         RotateMoveObj),
    _("TrialBubbleRevolvingPartsA",     RotateMoveObj),
    _("CubeBubbleExRotateWallS",        RotateMoveObj),
    _("CubeBubbleExRotateWallL",        RotateMoveObj),
    _("WaterRoadWaveRotateGround",      RotateMoveObj),
    _("OnimasuPlanetRotatePartsA",      RotateMoveObj),
    _("OnimasuPlanetRotatePartsB",      RotateMoveObj),
    _("KoopaVS2PartsStartMoveStepA",    RotateMoveObj),
    _("KoopaVS2PartsStartMoveStepB",    RotateMoveObj),
    _("KoopaVS2PartsRollingStep",       RotateMoveObj),
    _("KoopaVS3RotateStepA",            RotateMoveObj),
    _("KoopaVS3RotateStepB",            RotateMoveObj),
    _("KoopaVS3RotateStepD",            RotateMoveObj),
    _("KoopaVS3RotateStepsA",           RotateMoveObj),
    _("OceanRingRuinsGearSmall",        RotateMoveObj),
    _("OceanRingRuinsGearBig",          RotateMoveObj),

    // Astro
    _("AstroCountDownPlate",            AstroCountDownPlate),
    _("AstroDomeEntrance",              AstroMapObj),
    _("AstroStarPlate",                 AstroMapObj),
    _("AstroRotateStepA",               AstroMapObj),
    _("AstroRotateStepB",               AstroMapObj),
    _("AstroDecoratePartsA",            AstroMapObj),

    // Effects
    _("AstroTorchLightRed",             SimpleEffectObj),
    _("AstroTorchLightBlue",            SimpleEffectObj),
    _("BirdLouseS",                     EffectObj20x20x10SyncClipping),
    _("BirdLouseL",                     EffectObj50x50x10SyncClipping),
    _("EffectTicoS",                    AstroEffectObj),
    _("EffectTicoL",                    AstroEffectObj),
    _("FallGreenLeaf",                  EffectObj10x10x10SyncClipping),
    _("FallRedLeaf",                    EffectObj10x10x10SyncClipping),
    _("ForestWaterfallL",               EffectObjR1000F50),
    _("ForestWaterfallS",               EffectObjR1000F50),
    _("IcePlanetLight",                 EffectObjR100F50SyncClipping),
    _("IcicleRockLight",                EffectObjR100F50SyncClipping),
    _("SandBreezeS",                    EffectObj10x10x10SyncClipping),
    _("SnowS",                          EffectObj10x10x10SyncClipping),
    _("SpaceDustL",                     EffectObj50x50x10SyncClipping),
    _("Steam",                          SimpleEffectObj),
    _("TwinFallLakeWaterFall",          EffectObjR1000F50),
    _("WaterfallL",                     EffectObjR1000F50),
    _("WaterfallS",                     EffectObj20x20x10SyncClipping),
    _("LavaSteam",                      LavaSteam),
];

export function getNameObjTableEntry(objName: string, table: ActorTableEntry[] = ActorTable): ActorTableEntry | null {
    const entry = table.find((entry) => entry.objName === objName);
    if (entry !== undefined)
        return entry;
    return null;
}

const SpecialPlanetTable: ActorTableEntry[] = [
    _("PeachCastleGardenPlanet",       PeachCastleGardenPlanet),
    _("HatchWaterPlanet",              HatchWaterPlanet),
    _("ChoConveyorPlanetD",            RotateMoveObj),
    _("FlagDiscPlanetD",               RotateMoveObj),
    _("StarDustStartPlanet",           RotateMoveObj),
];

export class PlanetMapCreator {
    public planetMapDataTable: JMapInfoIter;

    constructor(arc: RARC.RARC) {
        this.planetMapDataTable = createCsvParser(arc.findFileData('PlanetMapDataTable.bcsv')!);
    }

    private setPlanetRecordFromName(objName: string): boolean {
        for (let i = 0; i < this.planetMapDataTable.getNumRecords(); i++) {
            this.planetMapDataTable.setRecord(i);
            if (this.planetMapDataTable.getValueString('PlanetName') === objName)
                return true;
        }

        return false;
    }

    public isRegisteredObj(objName: string): boolean {
        return this.setPlanetRecordFromName(objName);
    }

    public getNameObjFactory(objName: string): NameObjFactory | null {
        const specialPlanetEntry = getNameObjTableEntry(objName, SpecialPlanetTable);
        if (specialPlanetEntry !== null)
            return specialPlanetEntry.factory;

        if (this.isRegisteredObj(objName))
            return PlanetMap;

        return null;
    }

    public requestArchive(sceneObjHolder: SceneObjHolder, objName: string): void {
        const modelCache = sceneObjHolder.modelCache;

        this.setPlanetRecordFromName(objName);

        modelCache.requestObjectData(objName);
        if (this.planetMapDataTable.getValueNumber('BloomFlag') !== 0)
            modelCache.requestObjectData(`${objName}Bloom`);
        if (this.planetMapDataTable.getValueNumber('IndirectFlag') !== 0)
            modelCache.requestObjectData(`${objName}Indirect`);
        if (this.planetMapDataTable.getValueNumber('WaterFlag') !== 0)
            modelCache.requestObjectData(`${objName}Water`);
    }
}
