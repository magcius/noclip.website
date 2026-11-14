// Seasonal colour changes to foliage

import { clamp } from "../MathHelpers.js";
import { wrapMod } from "./Util.js";

//#region Sheet table and Calendar

export const SHEET_TABLE: number[] = [
    0, 1, 2, 2, 2, 2, 2, 2, 3, 4,               // spring
    5, 6, 7, 7, 7, 7, 7, 7, 8, 9,               // summer
    10, 11, 12, 12, 12, 12, 12, 12, 13, 14,     // autumn
    15, 16, 17, 17, 17, 17, 17, 17, 18, 19,     // winter
];

export const DAYS_PER_SEASON = 10;
export const SEASON_COUNT = 4;
export const BANK_COUNT = 6;

export const DEFAULT_DAY = 2;

export function bankForYear(year: number): number {
    return clamp(year | 0, 0, BANK_COUNT - 1) + 1;
}

export const BANK = bankForYear(0);

export function sheetForDay(season: number, day: number): number {
    const s = wrapMod(season, SEASON_COUNT);
    const d = wrapMod(day, DAYS_PER_SEASON);
    return SHEET_TABLE[d + s * DAYS_PER_SEASON] + 1;
}

//#endregion

//#region File names

export function mapobjSheetFileName(sheet: number, bank: number = BANK): string {
    return `image.mapobj_s${sheet}b${bank}.tpl`;
}

export function groundSheetFileName(sheet: number): string {
    return `image.jimen-L_s${sheet}.tpl`;
}

export function sheetVariantName(sheet: number): string {
    return `sheet${sheet}`;
}

//#endregion
