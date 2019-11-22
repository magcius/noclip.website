
import * as RARC from '../j3d/rarc';

import { SceneObjHolder } from "./Main";
import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { ZoneAndLayer } from './LiveActor';
import { Kinopio, TicoComet, EarthenPipe, StarPiece, CollapsePlane, BlackHole, Peach, PenguinRacer, Penguin, SimpleEffectObj, EffectObjR1000F50, GCaptureTarget, FountainBig, AstroEffectObj, AstroCountDownPlate, Butler, Rosetta, Tico, Sky, Air, ShootingStar, EffectObj20x20x10SyncClipping, EffectObj50x50x10SyncClipping, EffectObj10x10x10SyncClipping, AstroMapObj, EffectObjR100F50SyncClipping, PriorDrawAir, BlueChip, YellowChip, PeachCastleGardenPlanet, SimpleMapObj, CrystalCage, PlanetMap, HatchWaterPlanet, RotateMoveObj, LavaSteam, SignBoard, WoodBox, EffectObjR500F50, SurprisedGalaxy, AstroCore, TicoAstro, UFOKinokoUnderConstruction, KinopioAstro, createPurpleCoin, createCoin, createRailCoin, createPurpleRailCoin, requestArchivesCoin, requestArchivesPurpleCoin, createCircleCoinGroup, createPurpleCircleCoinGroup, Fountain, PhantomTorch, RandomEffectObj, OceanWaveFloater, FishGroup, SeaGullGroup, CoconutTreeLeafGroup, AirBubble, AirBubbleGenerator, RailMoveObj, SimpleEnvironmentObj, TreasureBoxCracked, RailPlanetMap, TicoRail, createSuperSpinDriverYellow, createSuperSpinDriverGreen, createSuperSpinDriverPink, requestArchivesSuperSpinDriver } from "./Actors";
import { OceanBowl } from "./OceanBowl";
import { WarpPod } from './WarpPod';
import { NameObj } from './NameObj';
import { createLightCtrlCylinder, createLightCtrlCube } from './LightData';

export interface NameObjFactory {
    new(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj;
    requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
}

export type NameObjFactoryFunc = (zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) => NameObj;
export type NameObjRequestArchivesFunc = (sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) => void;

export interface NameObjFactoryTableEntry {
    objName: string;
    factoryFunc: NameObjFactoryFunc | null;
    requestArchivesFunc: NameObjRequestArchivesFunc | null;
}

function makeExtraRequestArchivesFunc(extraArchives: string[]): NameObjRequestArchivesFunc {
    return function (sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        for (let i = 0; i < extraArchives.length; i++)
            sceneObjHolder.modelCache.requestObjectData(extraArchives[i]);
    };
}

function E(objName: string, factoryFunc: NameObjFactoryFunc, requestArchivesFunc: NameObjRequestArchivesFunc | null = null): NameObjFactoryTableEntry {
    return { objName, factoryFunc, requestArchivesFunc };
}

function N(objName: string): NameObjFactoryTableEntry {
    const factoryFunc = null;
    const requestArchivesFunc = null;
    return { objName, factoryFunc, requestArchivesFunc };
}

function _(objName: string, factory: NameObjFactory, extraRequestArchivesFunc: NameObjRequestArchivesFunc | null = null): NameObjFactoryTableEntry {
    // TODO(jstpierre): Is there a better way to construct dynamically like this? I swear there is.
    const factoryFunc: NameObjFactoryFunc = function(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
        return new factory(zoneAndLayer, sceneObjHolder, infoIter);
    };

    let requestArchivesFunc: NameObjRequestArchivesFunc;
    if (extraRequestArchivesFunc !== null) {
        requestArchivesFunc = function(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
            factory.requestArchives(sceneObjHolder, infoIter);
            extraRequestArchivesFunc(sceneObjHolder, infoIter);
        };
    } else {
        requestArchivesFunc = factory.requestArchives;
    }

    return { objName, factoryFunc, requestArchivesFunc };
}

const ActorTable: NameObjFactoryTableEntry[] = [
    // Environment
    _("FishGroupA",                     FishGroup),
    _("FishGroupB",                     FishGroup),
    _("FishGroupC",                     FishGroup),
    _("FishGroupD",                     FishGroup),
    _("FishGroupE",                     FishGroup),
    _("FishGroupF",                     FishGroup),
    _("SeaGullGroup",                   SeaGullGroup),
    _("AsteroidA",                      SimpleEnvironmentObj),
    _("AsteroidB",                      SimpleEnvironmentObj),
    _("AsteroidC",                      SimpleEnvironmentObj),
    _("AsteroidD",                      SimpleEnvironmentObj),
    _("SpaceStickA",                    SimpleEnvironmentObj),
    _("SpaceStickB",                    SimpleEnvironmentObj),
    _("KillerGunnerDouble",             SimpleEnvironmentObj),
    _("KillerGunnerTriple",             SimpleEnvironmentObj),
    _("LavaSpaceStickA",                SimpleEnvironmentObj),
    _("LavaSpaceStickB",                SimpleEnvironmentObj),
    _("LavaBlackUFO",                   SimpleEnvironmentObj),
    _("SpaceDustWoodA",                 SimpleEnvironmentObj),
    _("SpaceDustWoodB",                 SimpleEnvironmentObj),
    _("PhantomDecoratePartsA",          SimpleEnvironmentObj),
    _("PhantomDecoratePartsB",          SimpleEnvironmentObj),
    _("PhantomDecoratePartsHole",       SimpleEnvironmentObj),
    _("DeathSandEnvironmentSapotenA",   SimpleEnvironmentObj),
    _("DeathSandEnvironmentSapotenB",   SimpleEnvironmentObj),
    _("DeathSandEnvironmentRock",       SimpleEnvironmentObj),
    _("DeathSandEnvironmentPyramid",    SimpleEnvironmentObj),
    _("SweetDecoratePartsOrange",       SimpleEnvironmentObj),

    // NPCs
    _("Butler",                         Butler),
    _("Kinopio",                        Kinopio),
    _("KinopioAstro",                   KinopioAstro),
    _("Peach",                          Peach),
    _("Penguin",                        Penguin),
    _("PenguinRacer",                   PenguinRacer),
    _("PenguinRacerLeader",             PenguinRacer),
    _("Rosetta",                        Rosetta),
    _("SignBoard",                      SignBoard),
    _("Tico",                           Tico),
    _("TicoAstro",                      TicoAstro),
    _("TicoComet",                      TicoComet),
    _("TicoRail",                       TicoRail),

    // Coins
    E("Coin",                           createCoin,                  requestArchivesCoin),
    E("PurpleCoin",                     createPurpleCoin,            requestArchivesPurpleCoin),
    E("RailCoin",                       createRailCoin,              requestArchivesCoin),
    E("PurpleRailCoin",                 createPurpleRailCoin,        requestArchivesPurpleCoin),
    E("CircleCoinGroup",                createCircleCoinGroup,       requestArchivesCoin),
    E("CirclePurpleCoinGroup",          createPurpleCircleCoinGroup, requestArchivesPurpleCoin),

    // Misc objects
    _("AirBubble",                      AirBubble),
    _("AirBubbleGenerator",             AirBubbleGenerator),
    _("BlackHole",                      BlackHole),
    _("BlackHoleCube",                  BlackHole),
    _("BlueChip",                       BlueChip),
    _("CoconutTreeLeaf",                CoconutTreeLeafGroup),
    _("CollapsePlane",                  CollapsePlane),
    _("CrystalCageS",                   CrystalCage),
    _("CrystalCageM",                   CrystalCage),
    _("CrystalCageL",                   CrystalCage),
    _("EarthenPipe",                    EarthenPipe),
    _("EarthenPipeInWater",             EarthenPipe),
    _("Fountain",                       Fountain),
    _("FountainBig",                    FountainBig),
    _("GCaptureTarget",                 GCaptureTarget),
    _("OceanBowl",                      OceanBowl),
    _("OceanPierFloaterA",              OceanWaveFloater),
    _("OceanHexagonFloater",            OceanWaveFloater),
    _("PhantomBonfire",                 PhantomTorch),
    _("PhantomTorch",                   PhantomTorch),
    _("ShootingStar",                   ShootingStar),
    _("StarPiece",                      StarPiece),
    E("SuperSpinDriver",                createSuperSpinDriverYellow, requestArchivesSuperSpinDriver),
    E("SuperSpinDriverGreen",           createSuperSpinDriverGreen,  requestArchivesSuperSpinDriver),
    E("SuperSpinDriverPink",            createSuperSpinDriverPink,   requestArchivesSuperSpinDriver),
    _("TreasureBoxCrackedEmpty",        TreasureBoxCracked),
    _("TreasureBoxCrackedCoin",         TreasureBoxCracked),
    _("TreasureBoxCrackedYellowChip",   TreasureBoxCracked),
    _("TreasureBoxCrackedBlueChip",     TreasureBoxCracked),
    _("TreasureBoxCrackedKinokoOneUp",  TreasureBoxCracked),
    _("TreasureBoxCrackedKinokoLifeUp", TreasureBoxCracked),
    _("TreasureBoxCrackedAirBubble",    TreasureBoxCracked),
    _("TreasureBoxCrackedPowerStar",    TreasureBoxCracked),
    _("TreasureBoxEmpty",               TreasureBoxCracked),
    _("TreasureBoxCoin",                TreasureBoxCracked),
    _("TreasureBoxYellowChip",          TreasureBoxCracked),
    _("TreasureBoxBlueChip",            TreasureBoxCracked),
    _("TreasureBoxKinokoOneUp",         TreasureBoxCracked),
    _("TreasureBoxKinokoLifeUp",        TreasureBoxCracked),
    _("TreasureBoxGoldEmpty",           TreasureBoxCracked),
    _("WarpPod",                        WarpPod),
    _("WoodBox",                        WoodBox),
    _("YellowChip",                     YellowChip),

    // Sky/Air
    _("AstroDomeSky",                   Sky),
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

    // Misc. Map 
    _("FloaterLandPartsFrame",          SimpleMapObj),
    _("TemplateStageGeometry",          SimpleMapObj), // Unused
    _("WaterfallCaveNoBreakCover",      SimpleMapObj),
    _("SeaBottomTriplePropellerStand",  SimpleMapObj),
    _("FlipPanelFrame",                 SimpleMapObj),
    _("SpaceMineRailA",                 SimpleMapObj),
    _("SpaceMineRail5m",                SimpleMapObj),
    _("SandUpDownKillerGunnerBase",     SimpleMapObj),
    _("CaretakerGarbage",               SimpleMapObj),
    _("GlassBottleTall",                SimpleMapObj),
    _("PhantomFirewood",                SimpleMapObj),
    _("ArrowBoard",                     SimpleMapObj),
    _("ReverseGravityTowerInside",      SimpleMapObj),
    _("DropOfWaterCore",                SimpleMapObj),
    _("ForestAppearStepA",              SimpleMapObj),
    _("ForestWoodCover",                SimpleMapObj),
    _("StarDustStepA",                  SimpleMapObj),
    _("StarDustStepB",                  SimpleMapObj),
    _("StarPieceCluster",               SimpleMapObj),
    _("SpaceSeparatorA",                SimpleMapObj),
    _("SpaceSeparatorB",                SimpleMapObj),
    _("ForestNarrowStepA",              SimpleMapObj),
    _("ForestHomeGate",                 SimpleMapObj),
    _("WeatherVane",                    SimpleMapObj),
    _("ForestPoihanaFenceA",            SimpleMapObj),
    _("ForestPoihanaFenceB",            SimpleMapObj),
    _("TeresaMansionBridgeA",           SimpleMapObj),
    _("TeresaMansionBridgeB",           SimpleMapObj),
    _("ForestHomeBridge",               SimpleMapObj),
    _("ForestBarricadeRockA",           SimpleMapObj),
    _("BattleShipElevatorCover",        SimpleMapObj),
    _("TeresaRaceSpaceStickA",          SimpleMapObj),
    _("TeresaRaceSpaceStickB",          SimpleMapObj),
    _("TeresaRaceSpaceStickC",          SimpleMapObj),
    // We don't include this because we want to show the pristine map state...
    N("PeachCastleTownAfterAttack"),
    _("PeachCastleTownBeforeAttack",    SimpleMapObj, makeExtraRequestArchivesFunc(["PeachCastleTownBeforeAttackBloom"])),
    _("PeachCastleTownGate",            SimpleMapObj),
    _("CocoonStepA",                    SimpleMapObj),
    _("CocoonStepB",                    SimpleMapObj),
    _("SpaceCannonLauncher",            SimpleMapObj),
    _("TrapBaseA",                      SimpleMapObj),
    _("ColorPencil",                    SimpleMapObj),
    _("TeresaRacePartsBallA",           SimpleMapObj),
    _("BreakDownFixStepA",              SimpleMapObj),
    _("DeathSandLandPartsA",            SimpleMapObj),
    _("DeathSandLandPartsB",            SimpleMapObj),
    _("DeathSandLandPlatformStepA",     SimpleMapObj),
    _("UFOSandObstacleA",               SimpleMapObj),
    _("UFOSandObstacleB",               SimpleMapObj),
    _("UFOSandObstacleC",               SimpleMapObj),
    _("KameckShipLv1",                  SimpleMapObj),
    _("StrongBlock",                    SimpleMapObj),
    _("ChoConveyorChocoA",              SimpleMapObj),
    _("ForestHomePartsTree",            SimpleMapObj),
    _("ForestHomePartsTreeTower",       SimpleMapObj),
    _("PoltaBattlePlanetPartsA",        SimpleMapObj),
    _("ReverseKingdomTreeA",            SimpleMapObj),
    _("HugeBattleShipPlanetEntrance",   SimpleMapObj),
    _("MysteryGravityRoomBridgeA",      SimpleMapObj),
    _("DarkHopperPlanetPartsA",         SimpleMapObj),
    _("DarkHopperPlanetPartsC",         SimpleMapObj),
    _("DarkHopperPlanetPartsD",         SimpleMapObj),
    _("MiniMechaKoopaPartsFan",         SimpleMapObj),
    _("RockRoadCirclA",                 SimpleMapObj),
    _("HellBallGuidePartsA",            SimpleMapObj),
    _("IceSlipRoad",                    SimpleMapObj),
    _("SurfingRaceTutorialParts",       SimpleMapObj),
    _("SurfingRaceMiniGate",            SimpleMapObj),
    _("SurfingRaceSubGate",             SimpleMapObj),
    _("SurfingRaceStep",                SimpleMapObj),
    _("SurfingRaceSignBoard",           SimpleMapObj),
    _("SurfingRaceVictoryStand",        SimpleMapObj),
    _("HeavensDoorHouseDoor",           SimpleMapObj),
    _("HeavensDoorAppearStepAAfter",    SimpleMapObj),
    _("MechaKoopaPartsBody",            SimpleMapObj),
    _("MechaKoopaPartsRollerA",         SimpleMapObj),
    _("MechaKoopaPartsWreckA",          SimpleMapObj),
    _("IceRingBumpPartsA",              SimpleMapObj),
    _("IceLavaIslandSnowStepA",         SimpleMapObj),
    _("ChallengeBallVanishingRoadA",    SimpleMapObj),
    _("CubeBubbleExHomeStep",           SimpleMapObj),
    _("CubeBubbleExStartStep",          SimpleMapObj),
    _("CubeBubbleExPartsA",             SimpleMapObj),
    _("UFOKinokoLanding",               SimpleMapObj),
    _("KoopaShipA",                     SimpleMapObj),
    _("KoopaShipB",                     SimpleMapObj),
    _("KoopaShipC",                     SimpleMapObj),
    _("KoopaShipD",                     SimpleMapObj),
    _("KoopaShipE",                     SimpleMapObj),
    _("KoopaJrSmallShipAGuidePoint",    SimpleMapObj),
    _("KoopaJrKillerShipA",             SimpleMapObj),
    _("KoopaJrNormalShipA",             SimpleMapObj),
    _("WaterRoadCaveStepB",             SimpleMapObj),
    _("SubmarineVolcanoInside",         SimpleMapObj),
    _("OnimasuPlanetPartsGoal",         SimpleMapObj),
    _("OnimasuPlanetObstaclePartsA",    SimpleMapObj),
    _("TakoBarrelB",                    SimpleMapObj),
    _("KoopaVS1PartsSpiralRoad",        SimpleMapObj),
    _("KoopaVS1PartsReverseGRoad",      SimpleMapObj),
    _("KoopaVS1PartsStairRoad",         SimpleMapObj),
    _("KoopaVS1PartsBattleStage",       SimpleMapObj),
    _("KoopaVS2PartsReverseGRoadA",     SimpleMapObj),
    _("KoopaVS2PartsReverseGRoadB",     SimpleMapObj),
    _("KoopaVS2PartsStartRestStep",     SimpleMapObj),
    _("KoopaVS2PartsRestStepA",         SimpleMapObj),
    _("KoopaVS2PartsRestStepB",         SimpleMapObj),
    _("KoopaVS2PartsRestStepC",         SimpleMapObj),
    _("KoopaVS2PartsRestStepD",         SimpleMapObj),
    _("KoopaVS2PartsRestStepE",         SimpleMapObj),
    _("KoopaVS2PartsRestStepF",         SimpleMapObj),
    _("KoopaVS2PartsRestStepG",         SimpleMapObj),
    _("KoopaVS2PartsDarkMatterA",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterB",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterC",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterD",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterE",       SimpleMapObj),
    _("KoopaVS2PartsStairBig",          SimpleMapObj),
    _("KoopaVS2Parts2DRailGuideA",      SimpleMapObj),
    _("KoopaVS3Parts2DWallA",           SimpleMapObj),
    _("OceanRingRuinsColumn",           SimpleMapObj),
    _("OceanRingRuinsBase",             SimpleMapObj),
    _("KameckShip",                     SimpleMapObj),
    _("BeachParasol",                   SimpleMapObj),
    _("BeachChair",                     SimpleMapObj),
    _("PhantomCaveStepA",               SimpleMapObj),
    _("GhostShipCaveClosedRockA",       SimpleMapObj),
    _("GhostShipBrokenHead",            SimpleMapObj),
    _("CannonUnderConstructionA",       SimpleMapObj),
    _("CannonUnderConstructionB",       SimpleMapObj),
    _("AstroRoomLibrary",               SimpleMapObj),
    _("UFOKinokoLandingAstro",          SimpleMapObj),
    _("WhiteRoom",                      SimpleMapObj),
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
    _("LavaHomeVolcanoInnerFlow",       RailMoveObj),
    _("LavaRotatePlanetStartStep",      RailMoveObj),
    _("ShutterDoorB",                   RailMoveObj),
    _("PhantomTowerMoveStepA",          RailMoveObj),
    _("HopperBeltConveyerMovePartsA",   RailMoveObj),
    _("AsteroidMoveA",                  RailMoveObj),
    _("WaterBazookaTowerMoveStepB",     RailMoveObj),
    _("WaterBazookaTowerMoveStepC",     RailMoveObj),
    _("BeeWallClimbPartsA",             RailMoveObj),
    _("BroadBeanMoveStepA",             RailMoveObj),
    _("BroadBeanMoveStepB",             RailMoveObj),
    _("SandStreamHighTowerMoveStepA",   RailMoveObj),
    _("MiniMechaKoopaPartsMoveStepA",   RailMoveObj),
    _("HoleDeathSandMoveStepA",         RailMoveObj),
    _("SandUpDownTowerMoveStepA",       RailMoveObj),
    _("ChoConveyorMoveChocoA",          RailMoveObj),
    _("BiriBiriBegomanSpikePistonA",    RailMoveObj),
    _("DeathPromenadeMovePartsSpuareA", RailMoveObj),
    _("IceVolcanoMoveStepA",            RailMoveObj),
    _("IceLavaIslandIceMovableStepA",   RailMoveObj),
    _("IceLavaIslandLavaMovableStepA",  RailMoveObj),
    _("HoleBeltConveyerPartsA",         RailMoveObj),
    _("HoleBeltConveyerPartsB",         RailMoveObj),
    _("HoleBeltConveyerPartsC",         RailMoveObj),
    _("HoleBeltConveyerPartsD",         RailMoveObj),
    _("HoleBeltConveyerPartsE",         RailMoveObj),
    _("HoleBeltConveyerPartsF",         RailMoveObj),
    _("HoleBeltConveyerPartsH",         RailMoveObj),
    _("ChallengeBallMoveGroundA",       RailMoveObj),
    _("ChallengeBallMoveGroundB",       RailMoveObj),
    _("TrialBubbleMoveWallA",           RailMoveObj),
    _("KoopaJrSmallShipA",              RailMoveObj),
    _("WaterRoadCaveStepA",             RailMoveObj),
    _("OnimasuPlanetRailMovePartsA",    RailMoveObj),
    _("KoopaVS1PartsMoveStepA",         RailMoveObj),
    _("KoopaVS1PartsMoveStepB",         RailMoveObj),
    _("KoopaVS2PartsStartMoveStepC",    RailMoveObj),
    _("KoopaVS2Parts2DMoveStepBarA",    RailMoveObj),
    _("KoopaVS2Parts2DMoveStepBarB",    RailMoveObj),
    _("KoopaVS2Parts2DMoveStepSBarB",   RailMoveObj),
    _("KoopaVS2Parts2DMoveStepLShape",  RailMoveObj),
    _("KoopaVS2Parts2DMoveStepCross",   RailMoveObj),
    _("KoopaVS2PartsJoinedMoveStep",    RailMoveObj),
    _("KoopaVS2PartsSquareMoveStepA",   RailMoveObj),
    _("KoopaVS2PartsSquareMoveStepB",   RailMoveObj),
    _("OceanRingRuinsMove",             RailMoveObj),
    _("GhostShipCaveMoveGroundA",       RailMoveObj),
    _("GhostShipCaveMoveGroundB",       RailMoveObj),

    // Astro
    _("AstroCore",                      AstroCore),
    _("AstroCountDownPlate",            AstroCountDownPlate),
    _("AstroDomeEntrance",              AstroMapObj),
    _("AstroStarPlate",                 AstroMapObj),
    _("AstroBaseA",                     AstroMapObj),
    _("AstroBaseB",                     AstroMapObj),
    _("AstroBaseC",                     AstroMapObj),
    _("AstroBaseKitchen",               AstroMapObj),
    _("AstroBaseCenterA",               AstroMapObj),
    _("AstroBaseCenterB",               AstroMapObj),
    _("AstroBaseCenterC",               AstroMapObj),
    _("AstroBaseCenterTop",             AstroMapObj),
    _("AstroRotateStepA",               AstroMapObj),
    _("AstroRotateStepB",               AstroMapObj),
    _("AstroDecoratePartsA",            AstroMapObj),
    _("AstroDecoratePartsGearA",        AstroMapObj),
    _("AstroChildRoom",                 AstroMapObj),
    _("AstroParking",                   AstroMapObj),
    _("AstroLibrary",                   AstroMapObj),
    // AstroOverlookObj is a logic actor to show some UI when Mario enters a trigger volume...
    N("AstroOverlookObj"),
    _("UFOKinokoUnderConstruction",     UFOKinokoUnderConstruction),

    _("SurpBeltConveyerExGalaxy",       SurprisedGalaxy),
    _("SurpCocoonExGalaxy",             SurprisedGalaxy),
    _("SurpTearDropGalaxy",             SurprisedGalaxy),
    _("SurpTeresaMario2DGalaxy",        SurprisedGalaxy),
    _("SurpSnowCapsuleGalaxy",          SurprisedGalaxy),
    _("SurpTransformationExGalaxy",     SurprisedGalaxy),
    _("SurpFishTunnelGalaxy",           SurprisedGalaxy),
    _("SurpTamakoroExLv2Galaxy",        SurprisedGalaxy),
    _("SurpSurfingLv2Galaxy",           SurprisedGalaxy),
    _("SurpCubeBubbleExLv2Galaxy",      SurprisedGalaxy),
    _("SurpPeachCastleFinalGalaxy",     SurprisedGalaxy),

    // Effects
    _("AstroTorchLightBlue",            SimpleEffectObj),
    _("AstroTorchLightRed",             SimpleEffectObj),
    _("BattleShipExplosionMetal",       EffectObjR500F50),
    _("BattleShipExplosionRock",        EffectObjR500F50),
    _("BirdLouseS",                     EffectObj20x20x10SyncClipping),
    _("BirdLouseL",                     EffectObj50x50x10SyncClipping),
    _("EffectTeresa",                   EffectObj50x50x10SyncClipping),
    _("EffectTicoS",                    AstroEffectObj),
    _("EffectTicoL",                    AstroEffectObj),
    _("FallGreenLeaf",                  EffectObj10x10x10SyncClipping),
    _("FallRedLeaf",                    EffectObj10x10x10SyncClipping),
    _("FireworksA",                     RandomEffectObj),
    _("ForestWaterfallL",               EffectObjR1000F50),
    _("ForestWaterfallS",               EffectObjR1000F50),
    _("IcePlanetLight",                 EffectObjR100F50SyncClipping),
    _("IcicleRockLight",                EffectObjR100F50SyncClipping),
    _("LavaSparksS",                    EffectObj20x20x10SyncClipping),
    _("LavaSparksL",                    EffectObj50x50x10SyncClipping),
    _("LavaSteam",                      LavaSteam),
    _("SandBreezeS",                    EffectObj10x10x10SyncClipping),
    _("SandBreezeL",                    EffectObj50x50x10SyncClipping),
    _("SnowS",                          EffectObj10x10x10SyncClipping),
    _("SpaceDustS",                     EffectObj20x20x10SyncClipping),
    _("SpaceDustL",                     EffectObj50x50x10SyncClipping),
    _("Steam",                          SimpleEffectObj),
    _("TwinFallLakeWaterFall",          EffectObjR1000F50),
    _("WaterDropBottom",                EffectObjR1000F50),
    _("WaterDropTop",                   EffectObjR1000F50),
    _("WaterfallL",                     EffectObjR1000F50),
    _("WaterfallS",                     EffectObj20x20x10SyncClipping),
    _("UFOKinokoLandingBlackSmoke",     EffectObjR500F50),

    // Invisible / Collision only.
    N("CollisionBlocker"),
    N("GhostShipCavePipeCollision"),
    N("InvisibleWall10x10"),
    N("InvisibleWall10x20"),
    N("InvisibleWallJump10x20"),
    N("InvisibleWallGCapture10x20"),
    N("InvisibleWaterfallTwinFallLake"),
    N("PoleSquareNoModel"),

    // Logic objects
    N("TimerSwitch"),
    N("ClipFieldSwitch"),
    N("SoundSyncSwitch"),
    N("ExterminationSwitch"),
    N("RepeartTimerSwitch"),
    N("ExterminationCheckerWoodBox"),
    N("ExterminationCheckerLuribo"),
    N("ExterminationKuriboKeySwitch"),
    N("ExterminationPowerStar"),
    N("SwitchSynchronizerReverse"),
    N("PrologueDirector"),
    N("MovieStarter"),
    N("ScenarioStarter"),
    N("LuigiEvent"),
    N("MameMuimuiScorer"),
    N("MameMuimuiScorerLv2"),
    N("ScoreAttackCounter"),
    N("FlipPanelObserver"),
    N("PurpleCoinStarter"),
    N("PurpleCoinCompleteWatcher"),
    N("RunawayRabbitCollect"),
    N("GroupSwitchWatcher"),

    // Cutscenes
    N("OpeningDemoObj"),
    N("NormalEndingDemoObj"),
    N("MeetKoopaDemoObj"),
    N("StarReturnDemoStarter"),
    N("GrandStarReturnDemoStarter"),
    N("SimpleDemoExecutor"),

    // Ugly actors, hide for now until we have a full impl.
    N("ElectricRail"),
    N("ElectricRailMoving"),

    // Stuff we don't care about (yet?)
    N("CubeCameraBox"),
    N("CubeCameraCylinder"),
    N("DemoGroup"),
    N("DemoSubGroup"),
    N("SoundEmitter"),
    N("LensFlare"),
    N("CelestrialSphere"),
    N("AstroOverlookAreaCylinder"),
    N("ViewGroupCtrlCube"),
    N("PullBackCube"),
    N("PullBackCylinder"),
    N("AstroChangeStageCube"),

    // Gravity
    N("GlobalPointGravity"),
    N("GlobalPlaneGravityInBox"),

    // Areas
    E("LightCtrlCube",              createLightCtrlCube),
    E("LightCtrlCylinder",          createLightCtrlCylinder),
];

export function getNameObjFactoryTableEntry(objName: string, table: NameObjFactoryTableEntry[] = ActorTable): NameObjFactoryTableEntry | null {
    const entry = table.find((entry) => entry.objName === objName);
    if (entry !== undefined)
        return entry;
    return null;
}

const SpecialPlanetTable: NameObjFactoryTableEntry[] = [
    _("ChoConveyorPlanetB",            RailPlanetMap),
    _("ChoConveyorPlanetD",            RotateMoveObj),
    _("FlagDiscPlanetD",               RotateMoveObj),
    _("HatchWaterPlanet",              HatchWaterPlanet),
    _("HeavensDoorInsidePlanet",       SimpleMapObj),
    _("PeachCastleGardenPlanet",       PeachCastleGardenPlanet),
    _("TridentPlanet",                 AstroMapObj),
    _("Quicksand2DPlanet",             RailPlanetMap),
    _("SandStreamHighTowerPlanet",     RailPlanetMap),
    _("SandStreamJointPlanetA",        RailPlanetMap),
    _("SandStreamJointPlanetB",        RailPlanetMap),
    _("StarDustStartPlanet",           RotateMoveObj),
];

const genericPlanetMapEntry: NameObjFactoryTableEntry = _("PlanetMap", PlanetMap);

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

    public getActorTableEntry(objName: string): NameObjFactoryTableEntry | null {
        const specialPlanetEntry = getNameObjFactoryTableEntry(objName, SpecialPlanetTable);
        if (specialPlanetEntry !== null)
            return specialPlanetEntry;

        if (this.isRegisteredObj(objName))
            return genericPlanetMapEntry;

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
