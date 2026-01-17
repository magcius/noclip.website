// scene.ts
// Handles all the levels in Tokyo Mirage Sessions ♯FE

import { parseAPAK, get_file_by_name } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import { DataFetcher } from "../DataFetcher.js";
import { create_common_gimmicks } from "./gimmick.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { gimmick } from "./gimmick.js";
import { MapLayout, parseLayout } from "./maplayout.js";
import { TMSFEScene } from "./render.js"
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { SceneGfx, SceneGroup } from "../viewer.js";

import { create_d002_01_gimmicks } from "./maps/d002_01.js";
import { create_d003_01_gimmicks } from "./maps/d003_01.js";
import { create_d003_02_gimmicks } from "./maps/d003_02.js";
import { create_d003_03_gimmicks } from "./maps/d003_03.js";
import { create_d004_01_gimmicks } from "./maps/d004_01.js";
import { create_d004_02_gimmicks } from "./maps/d004_02.js";

/**
 * Defines a single level from Tokyo Mirage Sessions ♯FE
 */
class TMSFESceneDesc implements SceneDesc
{
    /**
     * @param id Identifier for each map. Displayed in the URL. Also used for loading files.
     * @param name The map's display name in the UI
     * @param level_file_names which bfres files in model.apak to load
     * @param map_gimmick_function per map function that spawns interactable objects
     * @param gate_type it's currently unknown how the game chooses which gate model to use. currently just hard coding it
     * @param is_d018_03 this map has some hardcoded behavior, and using a bool is faster than a string compare
     */
    constructor
    (
        public id: string,
        public name: string,
        public level_file_names: string[],
        public map_gimmick_function?: (layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice) => Promise<gimmick[]>,
        public gate_type?: number | undefined,
        public is_d018_03?: boolean | undefined,
    ) {}

    /**
     * When a map is selected from the list, load the map's data and create the scene
     */
    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx>
    {
        // Load the map file
        const dataFetcher = context.dataFetcher;
        const apak = parseAPAK(await dataFetcher.fetchData(`TokyoMirageSessionsSharpFE/maps/${this.id}/model.apak`));
        
        let fres_files: FRES[] = [];
        if (this.gate_type == undefined) { this.gate_type = 1 };
        if (this.is_d018_03 == undefined) { this.is_d018_03 = false };

        // get bfres files
        for (let i = 0; i < this.level_file_names.length; i++)
        {
            const file_name = `${this.level_file_names[i]}.bfres`
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
            renderer.common_gimmicks = await create_common_gimmicks(layout, this.gate_type, this.is_d018_03, dataFetcher, device);
            if (this.map_gimmick_function != undefined)
            {
                renderer.map_gimmicks = await this.map_gimmick_function(layout, dataFetcher, device);
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
    new TMSFESceneDesc("d002_01", "Illusory Daitama", ["d002_01", "obj01", "obj02", "obj03", "sky"], create_d002_01_gimmicks),
    new TMSFESceneDesc("d002_02", "Blue Observatory", ["d002_02", "sky"]),
    new TMSFESceneDesc("d002_03", "Red Observatory", ["d002_03", "sky"]),
    "Illusory 106",
    new TMSFESceneDesc("d003_01", "1F to 3F", ["d003_01", "obj01", "obj02", "sky"], create_d003_01_gimmicks, 2),
    new TMSFESceneDesc("d003_04", "4F", ["d003_04", "sky"]),
    new TMSFESceneDesc("d003_02", "5F to 7F", ["d003_02", "obj01", "sky"], create_d003_02_gimmicks),
    new TMSFESceneDesc("d003_06", "Outside", ["d003_06", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d003_03", "B1F to B3F", ["d003_03", "obj01", "sky"], create_d003_03_gimmicks),
    new TMSFESceneDesc("d003_07", "B4F", ["d003_07", "sky"]),
    new TMSFESceneDesc("d003_08", "Outside 2", ["d003_08", "obj01", "obj02", "sky"]),
    "Illusory Shibuya",
    new TMSFESceneDesc("d004_01", "Block 1", ["d004_01", "obj01", "sky"], create_d004_01_gimmicks),
    new TMSFESceneDesc("d004_02", "Block 2", ["d004_02", "obj01", "sky"], create_d004_02_gimmicks),
    new TMSFESceneDesc("d004_03", "Block 3", ["d004_03", "obj01", "sky"]),
    new TMSFESceneDesc("d004_04", "Circular Square", ["d004_04", "obj01", "sky"]),
    new TMSFESceneDesc("d004_05", "Central Square", ["d004_05", "obj01", "obj02", "sky"]),
    // new TMSFESceneDesc("d004_06", "Central Square 2"), wii u file
    "Illusory Daitou TV",
    new TMSFESceneDesc("d005_01", "Film Set A: Outdoors", ["d005_01", "obj01", "sky"]),
    new TMSFESceneDesc("d005_03", "Film Set A: Indoors", ["d005_03", "sky"]),
    new TMSFESceneDesc("d005_02", "Film Set B: Outdoors", ["d005_02", "obj01", "sky"]),
    new TMSFESceneDesc("d005_04", "Film Set B: Indoors", ["d005_04", "sky"]),
    new TMSFESceneDesc("d005_05", "Main Stage 1", ["d005_05", "obj01", "sky"]),
    new TMSFESceneDesc("d005_06", "Main Stage 2", ["d005_06", "obj01", "sky"]),
    new TMSFESceneDesc("d005_07", "Main Stage 3", ["d005_07", "obj01", "sky"]),
    "Illusory Daiba Studio",
    new TMSFESceneDesc("d006_10", "Entrance", ["d006_10", "obj01", "sky"]),
    new TMSFESceneDesc("d006_01", "Monitor Room", ["d006_01", "obj01", "sky"]),
    new TMSFESceneDesc("d006_02", "Main Hallway", ["d006_02", "obj01", "sky"]),
    new TMSFESceneDesc("d006_03", "LCD Panels", ["d006_03", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("d006_04", "Back Monitor Room", ["d006_04", "obj01", "sky"]),
    new TMSFESceneDesc("d006_05", "Back Alley", ["d006_05", "sky"]),
    new TMSFESceneDesc("d006_06", "Film Location A", ["d006_06", "obj01", "sky"]),
    new TMSFESceneDesc("d006_07", "Film Location B", ["d006_07", "obj01", "sky"]),
    new TMSFESceneDesc("d006_08", "Film Location C", ["d006_08", "obj01", "sky"]),
    new TMSFESceneDesc("d006_09", "Film Location D", ["d006_09", "obj01", "sky"]),
    "Illusory Area of Memories",
    new TMSFESceneDesc("d010_01", "Great Corridor", ["d010_01", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d010_02", "Warrior's Hall", ["d010_02", "sky"]),
    new TMSFESceneDesc("d010_03", "Leader's Hall", ["d010_03", "sky"]),
    new TMSFESceneDesc("d010_04", "Hero's Hall", ["d010_04", "sky"]),
    "Illusory Dolhr",
    new TMSFESceneDesc("d007_01", "Altitude 48m to Altitude 54m", ["d007_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("d007_05", "Altitude 88m", ["d007_05", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d007_02", "Altitude 122m to Altitude 146m", ["d007_02", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("d007_06", "Altitude 180m", ["d007_06", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d007_03", "Altitude 232m to Altitude 238m", ["d007_03", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d007_07", "Altitude 333m", ["d007_07", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d007_04", "Altitude 428m to Altitude 434m", ["d007_04", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("d007_08", "Altitude 525m", ["d007_08", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d007_09", "Altitude 634m", ["d007_09", "obj00", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("d007_10", "Shadow Stage", ["d007_10", "sky"]),
    "Illusory Urahara",
    new TMSFESceneDesc("d008_01", "Arena", ["d008_01", "obj01", "obj02", "obj03", "sky"]),
    "Illusory Area of Aspirations",
    new TMSFESceneDesc("d018_01", "1F to 2F", ["d018_01", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d018_02", "3F", ["d018_02", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d018_03", "4F to 5F", ["d018_03", "obj01", "obj02", "sky"], undefined, 7, true),
    new TMSFESceneDesc("d018_04", "The Nexus", ["d018_04", "obj01", "obj02", "sky"]),
    "Training Area",
    new TMSFESceneDesc("d015_01", "Training Area", ["d015_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("d015_02", "Fighter's Hall", ["d015_02", "sky"]),
    "Battle Maps",
    // new TMSFESceneDesc("b000_00", "b000_00"), wii u file
    // new TMSFESceneDesc("b001_01", "b001_01"), wii u file
    new TMSFESceneDesc("b002_01", "b002_01", ["b002_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b003_01", "b003_01", ["b003_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b004_01", "b004_01", ["b004_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b005_01", "b005_01", ["b005_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b006_01", "b006_01", ["b006_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b007_01", "b007_01", ["b007_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b008_01", "b008_01", ["b008_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b009_01", "b009_01", ["b009_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b010_01", "b010_01", ["b010_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b011_01", "b011_01", ["b011_01", "obj01", "obj02", "obj03", "obj04", "sky"]),
    new TMSFESceneDesc("b012_01", "b012_01", ["b012_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b013_01", "b013_01", ["b013_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b014_01", "b014_01", ["b014_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b015_01", "b015_01", ["b015_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("b016_01", "b016_01", ["b016_01", "obj01", "obj02", "obj03", "sky"]),
    "Tokyo",
    new TMSFESceneDesc("f003_02", "Fortuna Office", ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"]),
    new TMSFESceneDesc("f003_03", "Bloom Palace", ["f003_03", "obj01", "sky"]),
    new TMSFESceneDesc("f001_01", "Shibuya 1", ["f001_01", "obj01", "obj02", "obj10", "sky"]),
    new TMSFESceneDesc("f001_02", "Shibuya 2", ["f001_02", "obj01", "obj02", "obj04", "obj10", "sky"]),
    new TMSFESceneDesc("f001_03", "Shibuya 3", ["f001_03", "obj01", "obj02", "obj04", "obj10", "sky"]),
    new TMSFESceneDesc("f001_04", "Shibuya 4", ["f001_04", "obj01", "obj02", "obj10", "obj11", "obj12", "sky"]),
    new TMSFESceneDesc("f001_05", "Shibuya 5", ["f001_05", "obj01", "obj02", "obj10", "sky"]),
    new TMSFESceneDesc("f001_06", "Shibuya 6", ["f001_06", "obj01", "obj02", "obj04", "obj10", "sky"]),
    new TMSFESceneDesc("f001_07", "Shibuya 7", ["f001_07", "obj01", "obj02", "obj10", "sky"]),
    new TMSFESceneDesc("f003_01", "Hee Ho Mart 1", ["f003_01", "sky"]),
    new TMSFESceneDesc("f003_09", "Hee Ho Mart 2", ["f003_09", "sky"]),
    new TMSFESceneDesc("f003_04", "Carabia", ["f003_04", "obj01", "sky"]),
    new TMSFESceneDesc("f003_05", "Uzume Lesson Studio", ["f003_05", "sky"]),
    new TMSFESceneDesc("f003_06", "Café Seiren", ["f003_06", "sky"]),
    new TMSFESceneDesc("f003_10", "Café Seiren 2", ["f003_10", "sky"]),
    new TMSFESceneDesc("f003_07", "???", ["f003_07", "sky"]),
    new TMSFESceneDesc("f003_08", "Anzu", ["f003_08", "sky"]),
    new TMSFESceneDesc("f005_01", "Daiba Studio", ["f005_01", "sky"]),
    new TMSFESceneDesc("f005_02", "Daiba Studio 2", ["f005_02", "obj01", "sky"]),
    new TMSFESceneDesc("f002_01", "Daitama Observatory 1", ["f002_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("f002_02", "Daitama Observatory 2", ["f002_02", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("f002_03", "Daitama Observatory 3", ["f002_03", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("f004_01", "Daitou TV 1", ["f004_01", "sky"]),
    new TMSFESceneDesc("f004_02", "Daitou TV 2", ["f004_02", "obj01", "sky"]),
    new TMSFESceneDesc("f006_01", "Cosmic Egg 1", ["f006_01", "obj01", "obj02", "obj03", "sky"]),
    new TMSFESceneDesc("f006_02", "Cosmic Egg 2", ["f006_02", "sky"]),
    new TMSFESceneDesc("f010_01", "Toubu Rooftop", ["f010_01", "sky"]),
    new TMSFESceneDesc("f010_02", "Classroom Film Set", ["f010_02", "sky"]),
    new TMSFESceneDesc("f007_01", "Harajuku", ["f007_01", "sky"]),
    new TMSFESceneDesc("f007_02", "????", ["f007_02", "sky"]),
    new TMSFESceneDesc("f010_03", "Masqueraider Raiga", ["f010_03", "sky"]),
    // new TMSFESceneDesc("f010_04", "Hot Spring"), wii u file
    new TMSFESceneDesc("f010_05", "Microwavin' with Mamorin Set", ["f010_05", "sky"]),
    new TMSFESceneDesc("f010_06", "Dressing Room", ["f010_06", "sky"]),
    new TMSFESceneDesc("f010_07", "Fashion Show Runway", ["f010_07", "f010_07_obj01", "f010_07_obj02", "sky"]),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
