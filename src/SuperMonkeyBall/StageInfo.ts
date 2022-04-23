import { Color, colorNewFromRGBA8 } from "../Color";
import { assertExists } from "../util";
import {
    BackgroundConstructor,
    BgBonus,
    BgIce,
    BgJungle,
    BgMaster,
    BgNight,
    BgSand,
    BgSpace,
    BgStorm,
    BgSunset,
    BgWater,
} from "./Background";

export const enum StageId {
    St001_Plain = 1,
    St002_Diamond = 2,
    St003_Hairpin = 3,
    St004_WideBridge = 4,
    St005_Slopes = 5,
    St006_Steps = 6,
    St007_Blocks = 7,
    St008_JumpSingle = 8,
    St009_ExamA = 9,
    St023_Jumpies = 23,
    St035_Labyrinth = 35,
}

export const enum BgType {
    Jungle = 13,
    Water = 14,
    Night = 15,
    Sunset = 16,
    Space = 17,
    Sand = 18,
    Ice = 19,
    Storm = 20,
    Bonus = 21,
    Master = 26,
}

export type BgInfo = {
    fileName: string;
    clearColor: Color;
    bgConstructor: BackgroundConstructor;
};

export type StageInfo = {
    bgInfo: BgInfo;
    // TODO(complexplane): Next stage
};

export const BG_INFO_MAP: Map<BgType, BgInfo> = new Map([
    [BgType.Jungle, { fileName: "bg_jun", clearColor: colorNewFromRGBA8(0xffffffff), bgConstructor: BgJungle }],
    [BgType.Water, { fileName: "bg_wat", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgWater }],
    [BgType.Night, { fileName: "bg_nig", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgNight }],
    [BgType.Sunset, { fileName: "bg_sun", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgSunset }],
    [BgType.Space, { fileName: "bg_spa", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgSpace }],
    [BgType.Sand, { fileName: "bg_snd", clearColor: colorNewFromRGBA8(0xd8bc77ff), bgConstructor: BgSand }],
    [BgType.Ice, { fileName: "bg_ice", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgIce }],
    [BgType.Storm, { fileName: "bg_stm", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgStorm }],
    [BgType.Bonus, { fileName: "bg_bns", clearColor: colorNewFromRGBA8(0x000000ff), bgConstructor: BgBonus }],
    [BgType.Master, { fileName: "bg_mst", clearColor: colorNewFromRGBA8(0xffffcdff), bgConstructor: BgMaster }],
]);

export const STAGE_INFO_MAP: Map<StageId, StageInfo> = new Map([
    [StageId.St001_Plain, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Jungle)) }],
    [StageId.St002_Diamond, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Jungle)) }],
    [StageId.St003_Hairpin, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Jungle)) }],
    [StageId.St004_WideBridge, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Jungle)) }],
    [StageId.St005_Slopes, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Sunset)) }],
    [StageId.St006_Steps, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Sunset)) }],
    [StageId.St007_Blocks, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Sunset)) }],
    [StageId.St008_JumpSingle, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Sunset)) }],
    [StageId.St009_ExamA, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Sunset)) }],
    [StageId.St023_Jumpies, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Night)) }],
    [StageId.St035_Labyrinth, { bgInfo: assertExists(BG_INFO_MAP.get(BgType.Water)) }],
]);
