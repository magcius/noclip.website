export interface OrigamiModelConfig {
    shapeWhitelist?: string[];
    shapeBlacklist?: string[];
    materialWhitelist?: string[];
    materialBlacklist?: string[];
}

const ORIGAMI_MODEL_CONFIGS: Map<string, OrigamiModelConfig> = new Map<string, OrigamiModelConfig>([
    ["Mobj_WoodBoxA", { shapeWhitelist: ["Box__Mt_WoodBoxA", "Wire__Mt_Wire"] }],
    ["Mobj_WoodBoxB", { shapeWhitelist: ["Box__Mt_WoodBoxB", "Wire__Mt_Wire"] }],
    ["Mobj_BlockHatena", {
        materialWhitelist: ["Mt_HatenaBis", "Mt_HatenaBlock"],
        shapeBlacklist: ["HatenaBis2__Mt_HatenaBis", "HatenaBis3__Mt_HatenaBis"]
    }],
    ["Mobj_BlockTomeiHatena", {
        materialWhitelist: ["Mt_Hatena", "Mt_HatenaBis", "Mt_HatenaBlock"],
        shapeWhitelist: ["HatenaBlock__Mt_HatenaBlock", "Hatena1__Mt_Hatena", "HatenaBis1__Mt_HatenaBis", "HatenaBlockTop__Mt_HatenaBlock"]
    }],
    ["Mobj_BlockSave", { shapeWhitelist: ["Box__Mt_Block", "Font_S1_13__Mt_Font", "Rivet1__Mt_Rivet", "BoxTop__Mt_Block"] }],
    ["Mobj_TreeDeku", {
        materialBlacklist: ["Mt_TreeDeku2", "Mt_TreeDeku3_scroll"],
        shapeWhitelist: ["TreeDeku1_Face1_Eye_L__Mt_TreeDeku1", "TreeDeku1_Face1_Eye_R__Mt_TreeDeku1", "TreeDeku1_Face2_Beard_L__Mt_TreeDeku1", "TreeDeku1_Face2_Beard_R__Mt_TreeDeku1",
            "TreeDeku1_Face2_EyeBrow_L__Mt_TreeDeku1", "TreeDeku1_Face2_EyeBrow_R__Mt_TreeDeku1", "TreeDeku1_Bark__Mt_TreeDeku1", "TreeDeku1_Body__Mt_TreeDeku1", "TreeDeku1_Body2__Mt_TreeDeku1",
            "TreeDeku1_HandTop__Mt_TreeDeku1", "TreeDeku1_SubTop__Mt_TreeDeku1", "TreeDeku1_Top1__Mt_TreeDeku1"]
    }],
    ["Mobj_GrassH", { shapeWhitelist: ["LeafAll__Mt_GrassH"] }],
    ["Mobj_GrassC", { shapeWhitelist: ["LeafAll__Mt_GrassC"] }],
    ["Mobj_IndoorPlantB", { materialBlacklist: ["Mt_Ink"], shapeBlacklist: ["PotInk__Mt_Ink", "LeafAInk__Mt_Ink", "LeafBInk__Mt_Ink", "LeafCInk__Mt_Ink", "LeafDInk__Mt_Ink"] }],
    ["Mobj_RubbleA", { materialBlacklist: ["Mt_ColorPattern"], shapeWhitelist: ["Rubble__Mt_Rubble", "Wire__Mt_Wire"] }],
    ["Mobj_PotA", { shapeWhitelist: ["Pot__Mt_Pot", "Wire__Mt_Wire"] }],
    ["Mobj_WoodBoxAWaterWay", { materialBlacklist: ["Mt_BG", "lambert1"], shapeWhitelist: ["Box__Mt_WoodBoxA", "Wire__Mt_Wire"] }],
    ["Mobj_RockA", { materialBlacklist: ["Mt_ColorPattern"], shapeWhitelist: ["PaperAlpha__Mt_RockA", "Wire__Mt_Wire"] }],
    ["Mobj_RockB", { materialBlacklist: ["Mt_ColorPattern"], shapeWhitelist: ["Paper__Mt_Rock", "Wire__Mt_Wire"] }],
    ["Mobj_RockC", { shapeWhitelist: ["PaperStatic__Mt_RockC", "WireStatic__Mt_Wire"] }],
    ["Mobj_BoatA", { shapeWhitelist: ["Boat__Mt_Boat"] }],
    ["Mobj_BlockPow", { shapeWhitelist: ["BlockL__Mt_PowBlock"] }],
    ["Mobj_WaterCaveBoxA", { materialWhitelist: ["Mt_WaterCaveBoxA", "Mt_Wire"], shapeWhitelist: ["BoxBase__Mt_WaterCaveBoxA", "WireBase__Mt_Wire"] }],
    ["W4C1_StoreRoom", { shapeBlacklist: ["PipeFlameB__Mt_Pipe"] }],
    ["Mobj_GrassF", { materialBlacklist: ["Mt_ColorPattern"], shapeWhitelist: ["Grass__Mt_Grass"] }],
    ["Mobj_HugeRockA", { materialWhitelist: ["Mt_HugeRockA"], shapeWhitelist: ["Rock__Mt_HugeRockA"] }],
    ["Mojb_PotB", { shapeWhitelist: ["Pot__Mt_PotB", "Wire__Mt_Wire"] }],
    ["Mobj_StallObjectA", { materialBlacklist: ["Mt_ColorPattern"], shapeWhitelist: ["Box__Mt_Box"] }],
    ["Mobj_CoffinA", { shapeBlacklist: ["MarkG__Mt_OrnamentGold", "MarkA__Mt_OrnamentGold", "MarkB__Mt_OrnamentGold", "MarkC__Mt_OrnamentGold", "MarkD__Mt_OrnamentGold", "MarkE__Mt_OrnamentGold"] }],
    ["Mobj_BarrelA", { shapeWhitelist: ["Wood1__Mt_Wood", "Wire1__Mt_Wire", "Metal1__Mt_Metal"] }],
    ["Mobj_StatueBody", {
        materialBlacklist: ["Mt_EyeLight", "Mt_ColorPattern"],
        shapeBlacklist: ["TextOff__Mt_Statue", "TextOn__Mt_Statue", "PedestalC__Mt_Statue", "PedestalA__Mt_Statue", "ColorPattern__Mt_ColorPattern"]
    }],
    ["Mobj_BarrelKNP", { shapeWhitelist: ["EdgeA__Mt_Edge", "Metal1__Mt_Metal", "Wood1__Mt_Wood"] }]
]);

/**
 * Temporary configs for shape/material whitelists/blacklists to show only the default or idle parts of the model
 */
export function getOrigamiModelConfig(id: string): OrigamiModelConfig | undefined {
    return ORIGAMI_MODEL_CONFIGS.get(id);
}
