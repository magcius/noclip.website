// scene.ts
// Handles all the levels in Tokyo Mirage Sessions ♯FE

import { parseAPAK, get_file_by_name } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import { create_common_gimmicks } from "./gimmick.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { parseLayout } from "./maplayout.js";
import { TMSFEScene } from "./render.js"
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { SceneGfx, SceneGroup } from "../viewer.js";

import { create_d003_01_gimmicks } from "./maps/d003_01.js";

/**
 * Defines a single level from Tokyo Mirage Sessions ♯FE
 */
class TMSFESceneDesc implements SceneDesc
{
    /**
     * @param id Identifier for each map. Displayed in the URL. Also used for loading files.
     * @param name The map's display name in the UI
     */
    constructor(public id: string, public name: string) {}

    // When a map is selected from the list, load the map's data and create the scene
    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx>
    {
        // Load the map file
        const dataFetcher = context.dataFetcher;
        const apak = parseAPAK(await dataFetcher.fetchData(`TokyoMirageSessionsSharpFE/maps/${this.id}/model.apak`));
        
        let fres_files: FRES[] = [];
        let level_file_names: string[] = [];
        let map_gimmick_function;
        let gate_type = 1;
        let is_d018_03 = false;

        switch(this.id)
        {
            case "d002_01":
                level_file_names = ["d002_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d002_02":
                level_file_names = ["d002_02", "sky"];
                break;
            
            case "d002_03":
                level_file_names = ["d002_03", "sky"];
                break;
            
            case "d003_01":
                level_file_names = ["d003_01", "obj01", "obj02", "sky"];
                map_gimmick_function = create_d003_01_gimmicks;
                gate_type = 2;
                break;
            
            case "d003_02":
                level_file_names = ["d003_02", "obj01", "sky"];
                break;
            
            case "d003_03":
                level_file_names = ["d003_03", "obj01", "sky"];
                break;

            case "d003_04":
                level_file_names = ["d003_04", "sky"];
                break;

            case "d003_06":
                level_file_names = ["d003_06", "obj02", "sky"]; // obj01 isn't normally there? not sure whats up with it
                break;

            case "d003_07":
                level_file_names = ["d003_07", "sky"];
                break;

            case "d003_08":
                level_file_names = ["d003_08", "obj02", "sky"]; //same as d003_06
                break;

            case "d004_01":
                level_file_names = ["d004_01", "obj01", "sky"];
                break;

            case "d004_02":
                level_file_names = ["d004_02", "obj01", "sky"];
                break;

            case "d004_03":
                level_file_names = ["d004_03", "obj01", "sky"];
                break;

            case "d004_04":
                level_file_names = ["d004_04", "obj01", "sky"];
                break;

            case "d004_05":
                level_file_names = ["d004_05", "obj01", "obj02", "sky"];
                break;

            case "d005_01":
                level_file_names = ["d005_01", "obj01", "sky"];
                break;

            case "d005_02":
                level_file_names = ["d005_02", "obj01", "sky"];
                break;

            case "d005_03":
                level_file_names = ["d005_03", "sky"];
                break;

            case "d005_04":
                level_file_names = ["d005_04", "sky"];
                break;

            case "d005_05":
                level_file_names = ["d005_05", "obj01", "sky"];
                break;

            case "d005_06":
                level_file_names = ["d005_06", "obj01", "sky"];
                break;

            case "d005_07":
                level_file_names = ["d005_07", "obj01", "sky"];
                break;

            case "d006_01":
                level_file_names = ["d006_01", "obj01", "sky"];
                break;

            case "d006_02":
                level_file_names = ["d006_02", "obj01", "sky"];
                break;

            case "d006_03":
                level_file_names = ["d006_03", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d006_04":
                level_file_names = ["d006_04", "obj01", "sky"];
                break;

            case "d006_05":
                level_file_names = ["d006_05", "sky"];
                break;

            case "d006_06":
                level_file_names = ["d006_06", "obj01", "sky"];
                break;

            case "d006_07":
                level_file_names = ["d006_07", "obj01", "sky"];
                break;

            case "d006_08":
                level_file_names = ["d006_08", "obj01", "sky"];
                break;

            case "d006_09":
                level_file_names = ["d006_09", "obj01", "sky"];
                break;

            case "d006_10":
                level_file_names = ["d006_10", "obj01", "sky"];
                break;

            case "d007_01":
                level_file_names = ["d007_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d007_02":
                level_file_names = ["d007_02", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d007_03":
                level_file_names = ["d007_03", "obj01", "obj02", "sky"];
                break;

            case "d007_04":
                level_file_names = ["d007_04", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d007_05":
                level_file_names = ["d007_05", "obj01", "obj02", "sky"];
                break;

            case "d007_06":
                level_file_names = ["d007_06", "obj01", "obj02", "sky"];
                break;

            case "d007_07":
                level_file_names = ["d007_07", "obj01", "obj02", "sky"];
                break;

            case "d007_08":
                level_file_names = ["d007_08", "obj01", "obj02", "sky"];
                break;

            case "d007_09":
                level_file_names = ["d007_09", "obj00", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d007_10":
                level_file_names = ["d007_10", "sky"];
                break;

            case "d008_01":
                level_file_names = ["d008_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d010_01":
                level_file_names = ["d010_01", "obj01", "obj02", "sky"];
                break;

            case "d010_02":
                level_file_names = ["d010_02", "sky"];
                break;

            case "d010_03":
                level_file_names = ["d010_03", "sky"];
                break;

            case "d010_04":
                level_file_names = ["d010_04", "sky"];
                break;

            case "d015_01":
                level_file_names = ["d015_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "d015_02":
                level_file_names = ["d015_02", "sky"];
                break;

            case "d018_01":
                level_file_names = ["d018_01", "obj01", "obj02", "sky"];
                break;

            case "d018_02":
                level_file_names = ["d018_02", "obj01", "obj02", "sky"];
                break;

            case "d018_03":
                level_file_names = ["d018_03", "obj01", "obj02", "sky"];
                break;

            case "d018_04":
                level_file_names = ["d018_04", "obj01", "obj02", "sky"];
                break;

            case "b002_01":
                level_file_names = ["b002_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b003_01":
                level_file_names = ["b003_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b004_01":
                level_file_names = ["b004_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b005_01":
                level_file_names = ["b005_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b006_01":
                level_file_names = ["b006_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b007_01":
                level_file_names = ["b007_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b008_01":
                level_file_names = ["b008_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b009_01":
                level_file_names = ["b009_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b010_01":
                level_file_names = ["b010_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b011_01":
                level_file_names = ["b011_01", "obj01", "obj02", "obj03", "obj04", "sky"];
                break;

            case "b012_01":
                level_file_names = ["b012_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b013_01":
                level_file_names = ["b013_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b014_01":
                level_file_names = ["b014_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b015_01":
                level_file_names = ["b015_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "b016_01":
                level_file_names = ["b016_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "f001_01":
                level_file_names = ["f001_01", "obj01", "obj02", "obj10", "sky"];
                break;

            case "f001_02":
                level_file_names = ["f001_02", "obj01", "obj02", "obj04", "obj10", "sky"];
                break;

            case "f001_03":
                level_file_names = ["f001_03", "obj01", "obj02", "obj04", "obj10", "sky"];
                break;

            case "f001_04":
                level_file_names = ["f001_04", "obj01", "obj02", "obj10", "obj11", "obj12", "sky"];
                break;

            case "f001_05":
                level_file_names = ["f001_05", "obj01", "obj02", "obj10", "sky"];
                break;

            case "f001_06":
                level_file_names = ["f001_06", "obj01", "obj02", "obj04", "obj10", "sky"];
                break;

            case "f001_07":
                level_file_names = ["f001_07", "obj01", "obj02", "obj10", "sky"];
                break;

            case "f002_01":
                level_file_names = ["f002_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "f002_02":
                level_file_names = ["f002_02", "obj01", "obj02", "obj03", "sky"];
                break;

            case "f002_03":
                level_file_names = ["f002_03", "obj01", "obj02", "sky"];
                break;

            case "f003_01":
                level_file_names = ["f003_01", "sky"];
                break;

            case "f003_02":
                level_file_names = ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"];
                break;

            case "f003_03":
                level_file_names = ["f003_03", "obj01", "sky"];
                break;

            case "f003_04":
                level_file_names = ["f003_04", "obj01", "sky"];
                break;

            case "f003_05":
                level_file_names = ["f003_05", "sky"];
                break;

            case "f003_06":
                level_file_names = ["f003_06", "sky"];
                break;

            case "f003_07":
                level_file_names = ["f003_07", "sky"];
                break;

            case "f003_08":
                level_file_names = ["f003_08", "sky"];
                break;

            case "f003_09":
                level_file_names = ["f003_09", "sky"];
                break;

            case "f003_10":
                level_file_names = ["f003_10", "sky"];
                break;

            case "f004_01":
                level_file_names = ["f004_01", "sky"];
                break;

            case "f004_02":
                level_file_names = ["f004_02", "obj01", "sky"];
                break;

            case "f005_01":
                level_file_names = ["f005_01", "sky"];
                break;

            case "f005_02":
                level_file_names = ["f005_02", "obj01", "sky"];
                break;

            case "f006_01":
                level_file_names = ["f006_01", "obj01", "obj02", "obj03", "sky"];
                break;

            case "f006_02":
                level_file_names = ["f006_02", "sky"];
                break;

            case "f007_01":
                level_file_names = ["f007_01", "sky"];
                break;

            case "f007_02":
                level_file_names = ["f007_02", "sky"];
                break;

            case "f010_01":
                level_file_names = ["f010_01", "sky"];
                break;

            case "f010_02":
                level_file_names = ["f010_02", "sky"];
                break;

            case "f010_03":
                level_file_names = ["f010_03", "sky"];
                break;

            case "f010_05":
                level_file_names = ["f010_05", "sky"];
                break;

            case "f010_06":
                level_file_names = ["f010_06", "sky"];
                break;

            case "f010_07":
                level_file_names = ["f010_07", "f010_07_obj01", "f010_07_obj02", "sky"];
                break;

            default:
                console.error(`level id ${this.id} not found`);
                throw("whoops");
        }

        // get bfres files
        for (let i = 0; i < level_file_names.length; i++)
        {
            const file_name = `${level_file_names[i]}.bfres`
            const bfres_data = get_file_by_name(apak, file_name);
            if (bfres_data != undefined)
            {
                fres_files.push(parseBFRES(bfres_data));
            }
            else
            {
                console.error(`file ${file_name} not found`);
            }
        }

        let renderer = new TMSFEScene(device, fres_files);

        // add gimmicks (only if this level has a maplayout.layout file)
        const maplayout_data = get_file_by_name(apak, "maplayout.layout");
        if (maplayout_data != undefined)
        {
            const layout = parseLayout(maplayout_data);
            console.log(layout);
            renderer.common_gimmicks = await create_common_gimmicks(layout, gate_type, is_d018_03, dataFetcher, device);
            if (map_gimmick_function != undefined)
            {
                renderer.map_gimmicks = await map_gimmick_function(layout, dataFetcher, device);
            }
        }

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
    // new TMSFESceneDesc("d004_06", "Central Square 2"), wii u file
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
    // new TMSFESceneDesc("b000_00", "b000_00"), wii u file
    // new TMSFESceneDesc("b001_01", "b001_01"), wii u file
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
    new TMSFESceneDesc("f003_04", "Carabia"),
    new TMSFESceneDesc("f003_05", "Uzume Lesson Studio"),
    new TMSFESceneDesc("f003_06", "Café Seiren"),
    new TMSFESceneDesc("f003_10", "Café Seiren 2"),
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
    // new TMSFESceneDesc("f010_04", "Hot Spring"), wii u file
    new TMSFESceneDesc("f010_05", "Microwavin' with Mamorin Set"),
    new TMSFESceneDesc("f010_06", "Dressing Room"),
    new TMSFESceneDesc("f010_07", "Fashion Show Runway"),

];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
