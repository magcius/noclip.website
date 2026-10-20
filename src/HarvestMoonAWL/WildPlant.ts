// Forgeables placed throughout the world. Change with season

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as U8 from "../rres/u8.js";
import { OqtInstance, allInstances, oqtTypeId } from "./Oqt.js";

//#region Seasons and Item Catalogue

export const ITEM_NAMES: readonly (readonly [number, string])[] = [
    [1075, "Mugwort"], [1076, "Royal Fern"], [1077, "Bracken"], [1078, "Sorrel"],
    [1079, "Hackberry"], [1080, "Matsutake"], [1081, "Shiitake"], [1082, "Toyflower"],
    [1083, "Mist Moon"], [1084, "Trick Blue"], [1085, "Amorous"], [1086, "Goddess Drop"],
    [1087, "Happy Lamp"], [1088, "Gemsoil"], [1089, "Upseed"], [1331, "Welcomush"],
];

export function nameForBlock(block: number): string {
    return ITEM_NAMES[block]?.[1] ?? `block${block}`;
}

//#endregion

//#region Placements

export interface WildPlantPlacement {
    block: number;
    inst: OqtInstance;
}

export function parsePlacements(arcData: ArrayBufferSlice): WildPlantPlacement[][] {
    const arc = U8.parse(arcData);
    return arc.root.files.map((file) =>
        allInstances(file.buffer).map((inst) => ({ block: oqtTypeId(inst), inst })),
    );
}

//#endregion
