
import { NameObjFactory } from "./smg_scenes";
import { Kinopio, TicoComet, EarthenPipe, StarPiece, CollapsePlane, BlackHole, Peach, PenguinRacer, Coin, Penguin, SimpleEffectObj, EffectObjR1000F50, GCaptureTarget, FountainBig, AstroEffectObj, WarpPod } from "./Actors";
import { OceanBowl } from "./OceanBowl";

interface ActorTableEntry {
    objName: string;
    factory: NameObjFactory;
}

function _(objName: string, factory: NameObjFactory): ActorTableEntry {
    return { objName, factory };
}

const ActorTable: ActorTableEntry[] = [
    _("Kinopio",              Kinopio),
    _("TicoComet",            TicoComet),
    _("CollapsePlane",        CollapsePlane),
    _("StarPiece",            StarPiece),
    _("EarthenPipe",          EarthenPipe),
    _("BlackHole",            BlackHole),
    _("BlackHoleCube",        BlackHole),
    _("Peach",                Peach),
    _("Penguin",              Penguin),
    _("PenguinRacer",         PenguinRacer),
    _("PenguinRacerLeader",   PenguinRacer),
    _("Coin",                 Coin),
    _("PurpleCoin",           Coin),
    _("OceanBowl",            OceanBowl),
    _("AstroTorchLightRed",   SimpleEffectObj),
    _("AstroTorchLightBlue",  SimpleEffectObj),
    _("EffectTicoS",          AstroEffectObj),
    _("EffectTicoL",          AstroEffectObj),
    _("WaterfallL",           EffectObjR1000F50),
    _("GCaptureTarget",       GCaptureTarget),
    _("FountainBig",          FountainBig),
    _("WarpPod",              WarpPod),
];

export function getActorNameObjFactory(objName: string): NameObjFactory | null {
    const entry = ActorTable.find((entry) => entry.objName === objName);
    if (entry !== undefined)
        return entry.factory;
    return null;
}
