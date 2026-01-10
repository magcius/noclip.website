// scene.ts
// Handles all the levels in Tokyo Mirage Sessions ♯FE

import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, SceneGroup } from "../viewer.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
// import * as BFRES from "./bfres_wiiu.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import { TMSFEScene } from "./render.js"

// Defines a single level from Tokyo Mirage Sessions ♯FE
class TMSFESceneDesc implements SceneDesc
{
    // id: Identifier for each map. Displayed in the URL. Also used for loading files.
    // name: The map's display name in the UI 
    constructor(public id: string, public name: string) {}

    // When a map is selected from the list, load the map's data and create the scene
    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx>
    {
        // Load the map file
        const dataFetcher = context.dataFetcher;
        // const apak = dataFetcher.fetchData(`TokyoMirageSessionsSharpFE/maps/${this.id}/model.apak`);
        // const bfres = parseBFRES(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/d008_01.bfres"));
        const bfres_files: FRES[] = [];
        bfres_files.push(parseBFRES(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/b016_01.bfres")));
        bfres_files.push(parseBFRES(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/obj01.bfres")));
        bfres_files.push(parseBFRES(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/obj02.bfres")));
        bfres_files.push(parseBFRES(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/obj03.bfres")));
        bfres_files.push(parseBFRES(await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/sky.bfres")));
        let renderer = new TMSFEScene(device, bfres_files);
        return renderer;
    }
}

// sceneGroup
// Collection of all the levels
// id: Identifier for this game. It is displayed in the URL.
// name: The game's display name in the UI
// sceneDescs: List of all the levels that are a part of this game. They are grouped into separate categories
const id = `TokyoMirageSessionsSharpFE`;
const name = "MOVE THIS LATER Tokyo Mirage Sessions ♯FE";
const sceneDescs =
[
    "Illusory Daitama",
    new TMSFESceneDesc("d002_01", "Illusory Daitama"),
    new TMSFESceneDesc("d002_02", "Blue Observatory"),
    new TMSFESceneDesc("d002_03", "Red Observatory"),
    "Illusory 106",
    new TMSFESceneDesc("d003_01", "1F to 3F"),
    new TMSFESceneDesc("d003_04", "4F"),
    new TMSFESceneDesc("d003_02", "5F to 7F"),
    new TMSFESceneDesc("d003_06", "Outside"),
    new TMSFESceneDesc("d003_03", "B1F to B3F"),
    new TMSFESceneDesc("d003_07", "B4F"),
    new TMSFESceneDesc("d003_08", "Outside 2"),
    "Illusory Shibuya",
    new TMSFESceneDesc("d004_01", "Block 1"),
    new TMSFESceneDesc("d004_02", "Block 2"),
    new TMSFESceneDesc("d004_03", "Block 3"),
    new TMSFESceneDesc("d004_04", "Circular Square"),
    new TMSFESceneDesc("d004_05", "Central Square"),
    new TMSFESceneDesc("d004_06", "Central Square 2"),
    "Illusory Daitou TV",
    new TMSFESceneDesc("d005_01", "Film Set A: Outdoors"),
    new TMSFESceneDesc("d005_03", "Film Set A: Indoors"),
    new TMSFESceneDesc("d005_02", "Film Set B: Outdoors"),
    new TMSFESceneDesc("d005_04", "Film Set B: Indoors"),
    new TMSFESceneDesc("d005_05", "Main Stage 1"),
    new TMSFESceneDesc("d005_06", "Main Stage 2"),
    new TMSFESceneDesc("d005_07", "Main Stage 3"),
    "Illusory Daiba Studio",
    new TMSFESceneDesc("d006_10", "Entrance"),
    new TMSFESceneDesc("d006_01", "Monitor Room"),
    new TMSFESceneDesc("d006_02", "Main Hallway"),
    new TMSFESceneDesc("d006_03", "LCD Panels"),
    new TMSFESceneDesc("d006_04", "Back Monitor Room"),
    new TMSFESceneDesc("d006_05", "Back Alley"),
    new TMSFESceneDesc("d006_06", "Film Location A"),
    new TMSFESceneDesc("d006_07", "Film Location B"),
    new TMSFESceneDesc("d006_08", "Film Location C"),
    new TMSFESceneDesc("d006_09", "Film Location D"),
    "Illusory Area of Memories",
    new TMSFESceneDesc("d010_01", "Great Corridor"),
    new TMSFESceneDesc("d010_02", "Warrior's Hall"),
    new TMSFESceneDesc("d010_03", "Leader's Hall"),
    new TMSFESceneDesc("d010_04", "Hero's Hall"),
    "Illusory Dolhr",
    new TMSFESceneDesc("d007_01", "Altitude 48m to Altitude 54m"),
    new TMSFESceneDesc("d007_05", "Altitude 88m"),
    new TMSFESceneDesc("d007_02", "Altitude 122m to Altitude 146m "),
    new TMSFESceneDesc("d007_06", "Altitude 180m"),
    new TMSFESceneDesc("d007_03", "Altitude 232m to Altitude 238m"),
    new TMSFESceneDesc("d007_07", "Altitude 333m"),
    new TMSFESceneDesc("d007_04", "Altitude 428m to Altitude 434m"),
    new TMSFESceneDesc("d007_08", "Altitude 525m"),
    new TMSFESceneDesc("d007_09", "Altitude 634m"),
    new TMSFESceneDesc("d007_10", "Shadow Stage"),
    "Illusory Urahara",
    new TMSFESceneDesc("d008_01", "Arena"),
    "Illusory Area of Aspirations",
    new TMSFESceneDesc("d018_01", "1F to 2F"),
    new TMSFESceneDesc("d018_02", "3F"),
    new TMSFESceneDesc("d018_03", "4F to 5F"),
    new TMSFESceneDesc("d018_04", "The Nexus"),
    "Training Area",
    new TMSFESceneDesc("d015_01", "Training Area"),
    new TMSFESceneDesc("d015_02", "Fighter's Hall"),
    "Battle Maps",
    new TMSFESceneDesc("b001_01", "b001_01"),
    new TMSFESceneDesc("b002_01", "b002_01"),
    new TMSFESceneDesc("b003_01", "b003_01"),
    new TMSFESceneDesc("b004_01", "b004_01"),
    new TMSFESceneDesc("b005_01", "b005_01"),
    new TMSFESceneDesc("b006_01", "b006_01"),
    new TMSFESceneDesc("b007_01", "b007_01"),
    new TMSFESceneDesc("b008_01", "b008_01"),
    new TMSFESceneDesc("b009_01", "b009_01"),
    new TMSFESceneDesc("b010_01", "b010_01"),
    new TMSFESceneDesc("b011_01", "b011_01"),
    new TMSFESceneDesc("b012_01", "b012_01"),
    new TMSFESceneDesc("b013_01", "b013_01"),
    new TMSFESceneDesc("b014_01", "b014_01"),
    new TMSFESceneDesc("b015_01", "b015_01"),
    new TMSFESceneDesc("b016_01", "b016_01"),
    "Tokyo",
    new TMSFESceneDesc("f003_02", "Fortuna Office"),
    new TMSFESceneDesc("f003_03", "Bloom Palace"),
    new TMSFESceneDesc("f001_01", "Shibuya 1"),
    new TMSFESceneDesc("f001_02", "Shibuya 2"),
    new TMSFESceneDesc("f001_03", "Shibuya 3"),
    new TMSFESceneDesc("f001_04", "Shibuya 4"),
    new TMSFESceneDesc("f001_05", "Shibuya 5"),
    new TMSFESceneDesc("f001_06", "Shibuya 6"),
    new TMSFESceneDesc("f001_07", "Shibuya 7"),
    new TMSFESceneDesc("f003_01", "Hee Ho Mart 1"),
    new TMSFESceneDesc("f003_09", "Hee Ho Mart 2"),
    new TMSFESceneDesc("f003_10", "Hee Ho Mart 3"),
    new TMSFESceneDesc("f003_04", "Carabia"),
    new TMSFESceneDesc("f003_05", "Uzume Lesson Studio"),
    new TMSFESceneDesc("f003_06", "Café Seiren"),
    new TMSFESceneDesc("f003_07", "???"),
    new TMSFESceneDesc("f003_08", "Anzu"),
    new TMSFESceneDesc("f005_01", "Daiba Studio"),
    new TMSFESceneDesc("f005_02", "Daiba Studio 2"),
    new TMSFESceneDesc("f002_01", "Daitama Observatory 1"),
    new TMSFESceneDesc("f002_02", "Daitama Observatory 2"),
    new TMSFESceneDesc("f002_03", "Daitama Observatory 3"),
    new TMSFESceneDesc("f004_01", "Daitou TV 1"),
    new TMSFESceneDesc("f004_02", "Daitou TV 2"),
    new TMSFESceneDesc("f006_01", "Cosmic Egg 1"),
    new TMSFESceneDesc("f006_02", "Cosmic Egg 2"),
    new TMSFESceneDesc("f010_01", "Toubu Rooftop"),
    new TMSFESceneDesc("f010_02", "Classroom Film Set"),
    new TMSFESceneDesc("f007_01", "Harajuku"),
    new TMSFESceneDesc("f007_02", "????"),
    new TMSFESceneDesc("f010_03", "Masqueraider Raiga"),
    new TMSFESceneDesc("f010_04", "Hot Spring"),
    new TMSFESceneDesc("f010_05", "Microwavin' with Mamorin Set"),
    new TMSFESceneDesc("f010_06", "Dressing Room"),
    new TMSFESceneDesc("f010_07", "Fashion Show Runway"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
