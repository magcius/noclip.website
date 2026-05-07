/*
 * Main list of LocoRoco levels/scenes
 *
 * petton-svn, 2026.
 */

import * as Viewer from "../viewer.js";
import { LocoRocoLevelSceneDesc } from "./LocoRocoLevelSceneDesc.js";

function scene(clv_basename: string, name: string) {
  return new LocoRocoLevelSceneDesc(
    clv_basename,
    `${name} (${clv_basename})`,
    `${clv_basename}.clv`,
  );
}

const id = "locoroco";
const name = "LocoRoco";
const sceneDescs = [
  "World 1",
  scene("st_flower01", "World 1 Level 1"),
  scene("st_yama03", "World 1 Level 2"),
  scene("st_bigtree01", "World 1 Level 3"),
  scene("st_snow01", "World 1 Level 4"),
  scene("st_kinoko01", "World 1 Level 5"),
  scene("st_tainai03", "World 1 Level 6"),
  scene("st_iseki01", "World 1 Level 7"),
  scene("st_nightmare03", "World 1 Level 8"),

  "World 2",
  scene("st_flower02", "World 2 Level 1"),
  scene("st_africa01", "World 2 Level 2"),
  scene("st_jungle02", "World 2 Level 3"),
  scene("st_snow02", "World 2 Level 4"),
  scene("st_island02", "World 2 Level 5"),
  scene("st_star02", "World 2 Level 6"),
  scene("st_tainai04", "World 2 Level 7"),
  scene("st_nightmare04", "World 2 Level 8"),

  "World 3",
  scene("st_africa02", "World 3 Level 1"),
  scene("st_kinoko03", "World 3 Level 2"),
  scene("st_island03", "World 3 Level 3"),
  scene("st_snow04", "World 3 Level 4"),
  scene("st_tainai01", "World 3 Level 5"),
  scene("st_iseki04", "World 3 Level 6"),
  scene("st_bigtree02", "World 3 Level 7"),
  scene("st_nightmare01", "World 3 Level 8"),

  "World 4",
  scene("st_island01", "World 4 Level 1"),
  scene("st_yama02", "World 4 Level 2"),
  scene("st_star03", "World 4 Level 3"),
  scene("st_iseki02", "World 4 Level 4"),
  scene("st_snow03", "World 4 Level 5"),
  scene("st_tainai02", "World 4 Level 6"),
  scene("st_africa03", "World 4 Level 7"),
  scene("st_nightmare02", "World 4 Level 8"),

  "World 5",
  scene("st_flower03", "World 5 Level 1"),
  scene("st_yama01", "World 5 Level 2"),
  scene("st_bigtree03", "World 5 Level 3"),
  scene("st_snow05", "World 5 Level 4"),
  scene("st_star01", "World 5 Level 5"),
  scene("st_kinoko02", "World 5 Level 6"),
  scene("st_jungle01", "World 5 Level 7"),
  scene("lastboss_demo01", "Final Boss Demo 1"),
  scene("lastboss_demo02", "Final Boss Demo 2"),
  scene("st_bombmuch", "World 5 Level 8"),

  "Minigames",
  scene("chuppagame_test", "Chuppa Game"),
  scene("crane_test", "Crane Game"),

  "Menus & UI",
  scene("title_miyano_en", "Title Screen"),
  scene("gameshow_en", "Trial 1"),
  scene("trial02_en", "Trial 2"),
  scene("trial03", "Trial 3"),
  scene("trial04", "Trial 4"),
  scene("staffroll", "Staff Roll"),

  scene("game_stage_en", "Loco Editor"),
  scene("lhl_flower_en", "LocoRoco House L"),
  scene("lhm_flower_en", "LocoRoco House M"),
  scene("lhs_flower_en", "LocoRoco House S"),

  // TODO: load_demo (inside system.arc)
  // TODO: stageclear (inside system.arc)
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
