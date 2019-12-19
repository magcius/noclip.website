
import { SceneDesc } from './render';
import { SceneGroup } from '../viewer';

const id = "zelview";
const name = "The Legend of Zelda: Ocarina of Time";
const sceneDescs: SceneDesc[] = [
  {
    filename: "ydan_scene",
    label: "Inside the Deku Tree",
  },
  {
    filename: "ddan_scene",
    label: "Dodongo's Cavern",
  },
  {
    filename: "bdan_scene",
    label: "Inside Jabu-Jabu's Belly",
  },
  {
    filename: "Bmori1_scene",
    label: "Forest Temple",
  },
  {
    filename: "HIDAN_scene",
    label: "Fire Temple",
  },
  {
    filename: "MIZUsin_scene",
    label: "Water Temple",
  },
  {
    filename: "jyasinzou_scene",
    label: "Spirit Temple",
  },
  {
    filename: "HAKAdan_scene",
    label: "Shadow Temple",
  },
  {
    filename: "HAKAdanCH_scene",
    label: "Bottom of the Well",
  },
  {
    filename: "ice_doukutu_scene",
    label: "Ice Cavern",
  },
  {
    filename: "ganon_scene",
    label: "Ganon's Castle Tower",
  },
  {
    filename: "men_scene",
    label: "Gerudo Training Grounds",
  },
  {
    filename: "gerudoway_scene",
    label: "Thieves' Hideout",
  },
  {
    filename: "ganontika_scene",
    label: "Ganon's Castle",
  },
  {
    filename: "ganon_sonogo_scene",
    label: "Ganon's Castle Tower (Crumbling)",
  },
  {
    filename: "ganontikasonogo_scene",
    label: "Ganon's Castle (Crumbling)",
  },
  {
    filename: "takaraya_scene",
    label: "Treasure Chest Contest",
  },
  {
    filename: "ydan_boss_scene",
    label: "Inside the Deku Tree (Boss)",
  },
  {
    filename: "ddan_boss_scene",
    label: "Dodongo's Cavern (Boss)",
  },
  {
    filename: "bdan_boss_scene",
    label: "Inside Jabu-Jabu's Belly (Boss)",
  },
  {
    filename: "moribossroom_scene",
    label: "Forest Temple (Boss)",
  },
  {
    filename: "FIRE_bs_scene",
    label: "Fire Temple (Boss)",
  },
  {
    filename: "MIZUsin_bs_scene",
    label: "Water Temple (Boss)",
  },
  {
    filename: "jyasinboss_scene",
    label: "Spirit Temple (Mid-Boss)",
  },
  {
    filename: "HAKAdan_bs_scene",
    label: "Shadow Temple (Boss)",
  },
  {
    filename: "ganon_boss_scene",
    label: "Second-To-Last Boss Ganondorf",
  },
  {
    filename: "ganon_final_scene",
    label: "Ganondorf, Death Scene",
  },
  {
    filename: "entra_scene",
    label: "Market Entrance (Day)",
  },
  {
    filename: "entra_n_scene",
    label: "Market Entrance (Night)",
  },
  {
    filename: "enrui_scene",
    label: "Market Entrance (Adult)",
  },
  {
    filename: "market_alley_scene",
    label: "Back Alley (Day)",
  },
  {
    filename: "market_alley_n_scene",
    label: "Back Alley (Night)",
  },
  {
    filename: "market_day_scene",
    label: "Market (Day)",
  },
  {
    filename: "market_night_scene",
    label: "Market (Night)",
  },
  {
    filename: "market_ruins_scene",
    label: "Market (Adult)",
  },
  {
    filename: "shrine_scene",
    label: "Temple of Time (Outside, Day)",
  },
  {
    filename: "shrine_n_scene",
    label: "Temple of Time (Outside, Night)",
  },
  {
    filename: "shrine_r_scene",
    label: "Temple of Time (Outside, Adult)",
  },
  {
    filename: "kokiri_home_scene",
    label: "Know-it-all Brothers",
  },
  {
    filename: "kokiri_home3_scene",
    label: "House of Twins",
  },
  {
    filename: "kokiri_home4_scene",
    label: "Mido's House",
  },
  {
    filename: "kokiri_home5_scene",
    label: "Saria's House",
  },
  {
    filename: "kakariko_scene",
    label: "Kakariko Village House",
  },
  {
    filename: "kakariko3_scene",
    label: "Back Alley Village House",
  },
  {
    filename: "shop1_scene",
    label: "Kakariko Bazaar",
  },
  {
    filename: "kokiri_shop_scene",
    label: "Kokiri Shop",
  },
  {
    filename: "golon_scene",
    label: "Goron Shop",
  },
  {
    filename: "zoora_scene",
    label: "Zora Shop",
  },
  {
    filename: "drag_scene",
    label: "Kakariko Potion Shop",
  },
  {
    filename: "alley_shop_scene",
    label: "Market Potion Shop",
  },
  {
    filename: "night_shop_scene",
    label: "Bombchu Shop",
  },
  {
    filename: "face_shop_scene",
    label: "Happy Mask Shop",
  },
  {
    filename: "link_home_scene",
    label: "Link's House",
  },
  {
    filename: "impa_scene",
    label: "Puppy Woman's House",
  },
  {
    filename: "malon_stable_scene",
    label: "Stables",
  },
  {
    filename: "labo_scene",
    label: "Impa's House",
  },
  {
    filename: "hylia_labo_scene",
    label: "Lakeside Laboratory",
  },
  {
    filename: "tent_scene",
    label: "Carpenter's Tent",
  },
  {
    filename: "hut_scene",
    label: "Dampé's Hut",
  },
  {
    filename: "daiyousei_izumi_scene",
    label: "Great Fairy Fountain",
  },
  {
    filename: "yousei_izumi_tate_scene",
    label: "Small Fairy Fountain",
  },
  {
    filename: "yousei_izumi_yoko_scene",
    label: "Magic Fairy Fountain",
  },
  {
    filename: "kakusiana_scene",
    label: "Grottos",
  },
  {
    filename: "hakaana_scene",
    label: "Grave (1)",
  },
  {
    filename: "hakaana2_scene",
    label: "Grave (2)",
  },
  {
    filename: "hakaana_ouke_scene",
    label: "Royal Family's Tomb",
  },
  {
    filename: "syatekijyou_scene",
    label: "Shooting Gallery",
  },
  {
    filename: "tokinoma_scene",
    label: "Temple of Time Inside",
  },
  {
    filename: "kenjyanoma_scene",
    label: "Chamber of Sages",
  },
  {
    filename: "hairal_niwa_scene",
    label: "Castle Courtyard (Day)",
  },
  {
    filename: "hairal_niwa_n_scene",
    label: "Castle Courtyard (Night)",
  },
  {
    filename: "hiral_demo_scene",
    label: "Cutscene Map",
  },
  {
    filename: "hakasitarelay_scene",
    label: "Dampé's Grave & Kakariko Windmill",
  },
  {
    filename: "turibori_scene",
    label: "Fishing Pond",
  },
  {
    filename: "nakaniwa_scene",
    label: "Zelda's Courtyard",
  },
  {
    filename: "bowling_scene",
    label: "Bombchu Bowling Alley",
  },
  {
    filename: "souko_scene",
    label: "Talon's House",
  },
  {
    filename: "miharigoya_scene",
    label: "Lots'o Pots",
  },
  {
    filename: "mahouya_scene",
    label: "Granny's Potion Shop",
  },
  {
    filename: "ganon_demo_scene",
    label: "Final Battle against Ganon",
  },
  {
    filename: "kinsuta_scene",
    label: "Skulltula House",
  },
  {
    filename: "spot00_scene",
    label: "Hyrule Field",
  },
  {
    filename: "spot01_scene",
    label: "Kakariko Village",
  },
  {
    filename: "spot02_scene",
    label: "Kakariko Graveyard",
  },
  {
    filename: "spot03_scene",
    label: "Zora's River",
  },
  {
    filename: "spot04_scene",
    label: "Kokiri Forest",
  },
  {
    filename: "spot05_scene",
    label: "Sacred Forest Meadow",
  },
  {
    filename: "spot06_scene",
    label: "Lake Hylia",
  },
  {
    filename: "spot07_scene",
    label: "Zora's Domain",
  },
  {
    filename: "spot08_scene",
    label: "Zora's Fountain",
  },
  {
    filename: "spot09_scene",
    label: "Gerudo Valley",
  },
  {
    filename: "spot10_scene",
    label: "Lost Woods",
  },
  {
    filename: "spot11_scene",
    label: "Desert Colossus",
  },
  {
    filename: "spot12_scene",
    label: "Gerudo's Fortress",
  },
  {
    filename: "spot13_scene",
    label: "Haunted Wasteland",
  },
  {
    filename: "spot15_scene",
    label: "Hyrule Castle",
  },
  {
    filename: "spot16_scene",
    label: "Death Mountain",
  },
  {
    filename: "spot17_scene",
    label: "Death Mountain Crater",
  },
  {
    filename: "spot18_scene",
    label: "Goron City",
  },
  {
    filename: "spot20_scene",
    label: "Lon Lon Ranch",
  },
  {
    filename: "ganon_tou_scene",
    label: "Ganon's Tower (Outside)",
  },
  {
    filename: "test01_scene",
    label: "Collision Testing Area",
  },
  {
    filename: "besitu_scene",
    label: "Besitu / Treasure Chest Warp",
  },
  {
    filename: "depth_test_scene",
    label: "Depth Test",
  },
  {
    filename: "syotes_scene",
    label: "Stalfos Middle Room",
  },
  {
    filename: "syotes2_scene",
    label: "Stalfos Boss Room",
  },
  {
    filename: "sutaru_scene",
    label: "Dark Link Testing Area",
  },
  {
    filename: "hairal_niwa2_scene",
    label: "Beta Castle Courtyard",
  },
  {
    filename: "sasatest_scene",
    label: "Action Testing Room",
  },
  {
    filename: "testroom_scene",
    label: "Item Testing Room",
  },
].map((entry) => {
    const path = `data/zelview/${entry.filename}.zelview0`;
    return new SceneDesc(entry.label, path);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
