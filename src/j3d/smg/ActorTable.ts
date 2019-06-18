
import { NameObjFactory } from "./smg_scenes";
import { Kinopio, TicoComet, EarthenPipe, StarPiece, CollapsePlane, BlackHole, Peach, PenguinRacer, Coin, Penguin, SimpleEffectObj, EffectObjR1000F50, GCaptureTarget, FountainBig, AstroEffectObj, WarpPod, AstroCountDownPlate, Butler, Rosetta, Tico, Sky, Air, ShootingStar, EffectObj20x20x10SyncClipping, EffectObj50x50x10SyncClipping, EffectObj10x10x10SyncClipping, AstroMapObj } from "./Actors";
import { OceanBowl } from "./OceanBowl";

interface ActorTableEntry {
    objName: string;
    factory: NameObjFactory;
}

function _(objName: string, factory: NameObjFactory): ActorTableEntry {
    return { objName, factory };
}

const ActorTable: ActorTableEntry[] = [
    _("Kinopio",                        Kinopio),
    _("Tico",                           Tico),
    _("TicoAstro",                      Tico),
    _("TicoComet",                      TicoComet),
    _("CollapsePlane",                  CollapsePlane),
    _("StarPiece",                      StarPiece),
    _("EarthenPipe",                    EarthenPipe),
    _("BlackHole",                      BlackHole),
    _("BlackHoleCube",                  BlackHole),
    _("Peach",                          Peach),
    _("Penguin",                        Penguin),
    _("PenguinRacer",                   PenguinRacer),
    _("PenguinRacerLeader",             PenguinRacer),
    _("Coin",                           Coin),
    _("PurpleCoin",                     Coin),
    _("OceanBowl",                      OceanBowl),
    _("GCaptureTarget",                 GCaptureTarget),
    _("FountainBig",                    FountainBig),
    _("WarpPod",                        WarpPod),
    _("Butler",                         Butler),
    _("Rosetta",                        Rosetta),

    // Sky/Air.
    _("AuroraSky",                      Sky),
    _("BeyondGalaxySky",                Sky),
    _("BeyondHellValleySky",            Sky),
    _("BeyondHorizonSky",               Sky),
    _("BeyondOrbitSky",                 Sky),
    _("BeyondPhantomSky",               Sky),
    _("BeyondSandSky",                  Sky),
    _("BeyondSandNightSky",             Sky),
    _("BeyondSummerSky",                Sky),
    _("BeyondTitleSky",                 Sky),
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
    _("DimensionAir",                   Air),
    _("DarknessRoomAir",                Air),
    // Not good enough for prime-time yet.
    // _("ShootingStar",         ShootingStar),

    // Effects.
    _("AstroTorchLightRed",             SimpleEffectObj),
    _("AstroTorchLightBlue",            SimpleEffectObj),
    _("EffectTicoS",                    AstroEffectObj),
    _("EffectTicoL",                    AstroEffectObj),
    _("WaterfallL",                     EffectObjR1000F50),
    _("WaterfallS",                     EffectObj20x20x10SyncClipping),
    _("FallGreenLeaf",                  EffectObj10x10x10SyncClipping),
    _("BirdLouseS",                     EffectObj20x20x10SyncClipping),
    _("BirdLouseL",                     EffectObj50x50x10SyncClipping),
    _("ForestWaterfallL",               EffectObjR1000F50),
    _("ForestWaterfallS",               EffectObjR1000F50),
    _("TwinFallLakeWaterFall",          EffectObjR1000F50),

    // Astro
    _("AstroCountDownPlate",            AstroCountDownPlate),
    _("AstroDomeEntrance",              AstroMapObj),
    _("AstroStarPlate",                 AstroMapObj),
];

export function getActorNameObjFactory(objName: string): NameObjFactory | null {
    const entry = ActorTable.find((entry) => entry.objName === objName);
    if (entry !== undefined)
        return entry.factory;
    return null;
}
