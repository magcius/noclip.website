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
};

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
};

// Maybe these should be some object type instead of a bunch of maps?

export const STAGE_TO_BG_MAP = {
    [StageId.St001_Plain]: BgType.Jungle,
    [StageId.St002_Diamond]: BgType.Jungle,
    [StageId.St003_Hairpin]: BgType.Jungle,
    [StageId.St004_WideBridge]: BgType.Jungle,
    [StageId.St005_Slopes]: BgType.Sunset,
    [StageId.St006_Steps]: BgType.Sunset,
    [StageId.St007_Blocks]: BgType.Sunset,
    [StageId.St008_JumpSingle]: BgType.Sunset,
    [StageId.St009_ExamA]: BgType.Sunset,
};

export const BG_TO_FILENAME_MAP = {
    [BgType.Jungle]: 'bg_jun',
    [BgType.Water]: 'bg_wat',
    [BgType.Night]: 'bg_nig',
    [BgType.Sunset]: 'bg_sun',
    [BgType.Space]: 'bg_spa',
    [BgType.Sand]: 'bg_snd',
    [BgType.Ice]: 'bg_ice',
    [BgType.Storm]: 'bg_stm',
    [BgType.Bonus]: 'bg_bns',
    [BgType.Master]: 'bg_mst',
};
