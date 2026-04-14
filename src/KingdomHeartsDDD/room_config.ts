export interface DreamDropRoomConfig {
    skyBoxIds?: number[];
    additiveBlendTextures?: string[];
}

// ids of PMOs by room id that are rendered as the skybox
// some skyboxes are already big enough with their srt, but most aren't
const SKYBOX_IDS: Map<string, number[]> = new Map([
    ["di_01", [48, 47]], ["di_02", [0, 1]], ["di_03", [43, 44, 45]], ["di_05", [0]],
    ["yt_02", [41, 42, 43, 44, 45, 46]], ["yt_04", [38, 39, 40, 41, 42]],
    ["yt_06", [4, 5, 6, 7, 8]], ["yt_60", [2, 3, 4]], ["tw_01", [79, 80, 81, 82]],
    ["tw_02", [21, 22, 23, 97, 98]], ["tw_03", [37, 38]], ["tw_04", [159]], ["tw_05", [204, 269, 270]],
    ["tw_06", [353]], ["tw_08", [120, 121, 122, 200, 201]], ["tw_09", [105]], ["tw_10", [286, 419, 420]],
    ["tw_11", [299]], ["tw_12", [99]], ["tw_13", [106]], ["tw_14", [95, 96]], ["tw_60", [0, 1]],
    ["tw_61", [0, 1]], ["tm_04", [177, 178]], ["tm_05", [0]], ["tm_06", [0]], ["tm_08", [30]],
    ["tm_09", [0]], ["tm_15", [47]], ["tm_60", [0]], ["tm_61", [0]], ["fa_01", [87, 88, 89]],
    ["fa_02", [0]], ["fa_03", [0]], ["fa_05", [94]], ["fa_06", [0]], ["fa_07", [0, 1, 2, 3]],
    ["fa_09", [0, 1, 2, 3, 4, 5, 6]], ["fa_10", [148, 149, 150, 151]], ["fa_11", [0]],
    ["fa_60", [0]], ["fa_61", [0]], ["fa_62", [145, 146, 147, 148]], ["pi_01", [0, 1, 2]],
    ["pi_02", [68]], ["pi_03", [58]], ["pi_05", [14, 15, 16, 17]], ["pi_11", [88, 89, 90]],
    ["pi_13", [0]], ["pi_14", [1]], ["pi_15", [149]], ["pi_17", [0, 1, 2, 3]], ["pi_19", [51]],
    ["pi_60", [4, 5]], ["pi_61", [4, 5]], ["rg_02", [413, 414]], ["rg_03", [377, 378, 379]],
    ["rg_04", [758, 759, 760, 761, 762, 763]], ["rg_05", [57]], ["rg_06", [456, 457, 458, 459, 460]],
    ["rg_08", [12, 13, 14, 15, 16, 20]], ["nd_01", [94]], ["nd_02", [97]], ["nd_04", [167]],
    ["nd_05", [162]], ["nd_07", [80]], ["nd_10", [0]], ["nd_11", [118, 119, 120]], ["nd_12", [0]],
    ["nd_13", [77, 78, 79]], ["nd_14", [80]], ["nd_15", [119]], ["nd_16", [171]], ["nd_17", [0, 1, 2]],
    ["nd_18", [0, 1, 2]], ["nd_19", [95]], ["nd_60", [0]], ["nd_61", [0]], ["tl_01", [0, 1, 2]],
    ["tl_02", [0, 1, 2]], ["tl_06", [61]], ["tl_07", [8]], ["tl_08", [68, 69]],
    ["tl_09", [32, 33, 34, 35, 36, 37, 38]], ["tl_10", [26, 27, 28, 29, 30]], ["tl_11", [12, 13, 14, 15]],
    ["tl_15", [0, 4]], ["tl_16", [12, 13, 14, 15]], ["tl_17", [0, 1, 2]], ["tl_18", [62, 66]],
    ["tl_60", [0]], ["tl_61", [0]], ["eh_02", [0, 1, 2, 3]], ["eh_03", [0]], ["eh_12", [0]],
    ["eh_20", [134]], ["eh_06", [0, 1, 2, 3, 4]], ["eh_07", [115, 116, 117, 118, 119, 120, 121]],
    ["eh_09", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]], ["eh_10", [0]], ["eh_13", [146]],
    ["eh_14", [10, 62, 63]], ["eh_60", [0]], ["eh_61", [0]], ["wm_01", [11, 12]]
]);

const ROOM_CONFIGS: Map<string, DreamDropRoomConfig> = new Map([
    // ["di_01", { additiveBlendTextures: ["nizi"] }],
    // ["tw_03", { additiveBlendTextures: ["efe_tw3a", "efe_tw3b", "efe_tw3c", "efe_tw3d", "efe_tw3e", "efe_tw3f", "efe_tw3g", "efe_tw3h", "glw02"] }],
    // ["tw_14", { additiveBlendTextures: ["glw02"] }],
    // ["pi_04", { additiveBlendTextures: ["pi_04_022"] }],
    // ["pi_16", { additiveBlendTextures: ["pi_04_022"] }],
    // ["pi_02", { additiveBlendTextures: ["pi_nami_a", "pi_nami_b", "pi_sry_a", "pi_sry_b", "pi_sry_c", "pi_sry_d"] }],
    // ["pi_03", { additiveBlendTextures: ["pi_sry_a", "pi_sry_b", "pi_sry_b2", "pi_sry_c", "pi_sry_d"] }],
    // ["pi_19", { additiveBlendTextures: ["pi_sry_a", "pi_sry_b", "pi_sry_c", "pi_sry_d"] }],
    // ["tm_11", { additiveBlendTextures: ["tm_11yaji"] }],
    // ["eh_03", { additiveBlendTextures: ["eh1_col59a"] }],
    // ["eh_12", { additiveBlendTextures: ["eh1_col59a"] }],
    // ["eh_20", { additiveBlendTextures: ["eh1_col59a"] }],
    // ["wm_01", { additiveBlendTextures: ["wm_bg08"] }],
]);

export function dreamDropGetRoomConfig(roomId: string): DreamDropRoomConfig | undefined {
    let config = ROOM_CONFIGS.get(roomId);
    if (config) {
        const skyBoxIds = SKYBOX_IDS.get(roomId);
        if (skyBoxIds) {
            config.skyBoxIds = skyBoxIds;
        }
    } else if (SKYBOX_IDS.has(roomId)) {
        config = { skyBoxIds: SKYBOX_IDS.get(roomId) };
    }
    return config;
}
