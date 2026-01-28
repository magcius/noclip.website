// scene.ts
// Handles all the levels in Tokyo Mirage Sessions ♯FE

import { parseAPAK, get_file_by_name, get_fres_from_apak, get_animations_from_apak } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers.js";
import { DataFetcher } from "../DataFetcher.js";
import { create_common_gimmicks } from "./gimmick.js";
import { GfxDevice, GfxTexture} from "../gfx/platform/GfxPlatform.js";
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
import { create_d004_03_gimmicks } from "./maps/d004_03.js";
import { create_d005_03_gimmicks } from "./maps/d005_03.js";
import { create_d005_04_gimmicks } from "./maps/d005_04.js";
import { create_d007_01_gimmicks } from "./maps/d007_01.js";
import { create_d007_02_gimmicks } from "./maps/d007_02.js";
import { create_d007_03_gimmicks } from "./maps/d007_03.js";
import { create_d007_04_gimmicks } from "./maps/d007_04.js";
import { create_d007_05_gimmicks } from "./maps/d007_05.js";
import { create_d007_06_gimmicks } from "./maps/d007_06.js";
import { create_d007_07_gimmicks } from "./maps/d007_07.js";
import { create_d007_08_gimmicks } from "./maps/d007_08.js";
import { create_d007_09_gimmicks } from "./maps/d007_09.js";
import { create_d010_01_gimmicks } from "./maps/d010_01.js";
import { create_f002_03_gimmicks } from "./maps/f002_03.js";
import { create_f003_02_gimmicks, create_f003_02_party_gimmicks } from "./maps/f003_02.js";
import { create_f003_06_gimmicks } from "./maps/f003_06.js";
import { create_f003_08_gimmicks } from "./maps/f003_08.js";
import { create_f004_01_gimmicks, create_f004_01_music_fes_gimmicks } from "./maps/f004_01.js";
import { create_f005_01_gimmicks, create_f005_01_music_fes_gimmicks } from "./maps/f005_01.js";
import { create_f006_01_barrier_gimmicks } from "./maps/f006_01.js";
import { create_f010_01_music_fes_gimmicks } from "./maps/f010_01.js";

/**
 * Defines a single level from Tokyo Mirage Sessions ♯FE
 */
class TMSFESceneDesc implements SceneDesc
{
    /**
     * @param id Identifier for each map. Displayed in the URL.
     * @param name The map's display name in the UI
     * @param level_file_names which bfres files in model.apak to load
     * @param map_gimmick_function per map function that spawns interactable objects
     * @param gate_type it's currently unknown how the game chooses which gate model to use. currently just hard coding it
     * @param is_d018_03 this map has some hardcoded behavior, and using a bool is faster than a string compare
     * @param special_skybox this map has a small skybox mesh that follows the camera
     * @param has_battle_audience whether to spawn the audience
     */
    constructor
    (
        public id: string,
        public name: string,
        public model_file_names: string[],
        public animation_file_names: string[],
        public map_gimmick_function?: (layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice) => Promise<gimmick[]>,
        public gate_type?: number | undefined,
        public is_d018_03?: boolean | undefined,
        public special_skybox?: boolean | undefined,
        public has_battle_audience?: boolean | undefined,
    ) {}

    /**
     * When a map is selected from the list, load the map's data and create the scene
     */
    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx>
    {
        // Load the map file
        const dataFetcher = context.dataFetcher;
        const apak = parseAPAK(await dataFetcher.fetchData(`TokyoMirageSessionsSharpFE/maps/${this.id}/model.apak`));
        
        if (this.gate_type == undefined) { this.gate_type = 1 };
        if (this.is_d018_03 == undefined) { this.is_d018_03 = false };
        if (this.special_skybox == undefined) { this.special_skybox = false };

        // get model files
        let level_models: level_model[] = [];
        let model_fres: FRES;
        let animation_fres: FRES | undefined = undefined;
        for (let i = 0; i < this.model_file_names.length; i++)
        {
            const model_file_name = `${this.model_file_names[i]}.bfres`
            const model_bfres_data = get_file_by_name(apak, model_file_name);
            if (model_bfres_data != undefined)
            {
                model_fres = parseBFRES(model_bfres_data);
            }
            else
            {
                console.error(`file ${model_file_name} not found`);
                throw("whoops");
            }

            // get animation file if it exists
            if (this.animation_file_names[i] != "")
            {
                const animation_file_name = `${this.animation_file_names[i]}.anm`
                const animation_bfres_data = get_file_by_name(apak, animation_file_name);
                if (animation_bfres_data != undefined)
                {
                    animation_fres = parseBFRES(animation_bfres_data);
                }
                else
                {
                    console.error(`file ${animation_file_name} not found`);
                    throw("whoops");
                }
            }

            level_models.push({ model_fres, animation_fres });
        }

        if (this.has_battle_audience)
        {
            // add the audience models
            const audience_00_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience00/skin/00/model.apak", "audience00_00.bfres", dataFetcher);
            const audience_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience01/skin/00/model.apak", "audience01_00.bfres", dataFetcher);
            const audience_02_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience02/skin/00/model.apak", "audience02_00.bfres", dataFetcher);
            const audience_00_animation_fres = await get_animations_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience00/skin/00/model_common.apak", dataFetcher);
            level_models.push({ model_fres: audience_00_fres, animation_fres: audience_00_animation_fres[0] });
            level_models.push({ model_fres: audience_01_fres, animation_fres: audience_00_animation_fres[0] });
            level_models.push({ model_fres: audience_02_fres, animation_fres: audience_00_animation_fres[0] });
        }

        // get dynamic advertisement textures
        const notice_bntx_buffer = await dataFetcher.fetchData("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/notice_tex094.gtx");
        const notice_bntx = BNTX.parse(notice_bntx_buffer);
        const notice_gfx_texture = deswizzle_and_upload_bntx_textures(notice_bntx, device)[0];

        let scene = new TMSFEScene(device, level_models, this.special_skybox, notice_gfx_texture);

        // add gimmicks (only if this level has a maplayout.layout file)
        const maplayout_data = get_file_by_name(apak, "maplayout.layout");
        if (maplayout_data != undefined)
        {
            const layout = parseLayout(maplayout_data);
            scene.common_gimmicks = await create_common_gimmicks(layout, this.gate_type, this.is_d018_03, dataFetcher, device);
            if (this.map_gimmick_function != undefined)
            {
                scene.map_gimmicks = await this.map_gimmick_function(layout, dataFetcher, device);
            }
        }

        return scene;
    }
}

export interface level_model
{
    model_fres: FRES;
    animation_fres: FRES | undefined;
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
    "Daitama Observatory",
    new TMSFESceneDesc("d002_01", "Illusory Daitama", ["d002_01", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], create_d002_01_gimmicks),
    new TMSFESceneDesc("d002_02", "Illusory Daitama Blue Observatory", ["d002_02"], [""]),
    new TMSFESceneDesc("d002_03", "Illusory Daitama Red Observatory", ["d002_03"], [""]),
    new TMSFESceneDesc("f002_01", "Daitama Observatory Prologue", ["f002_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    new TMSFESceneDesc("f002_02", "Daitama Observatory Prologue 2", ["f002_02", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    new TMSFESceneDesc("f002_03", "Daitama Observatory", ["f002_03", "obj01", "obj02", "obj12", "sky"], ["", "", "obj02", "obj12", ""], create_f002_03_gimmicks),
    "Tokyo",
    new TMSFESceneDesc("f003_02", "Fortuna Office", ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"], ["", "obj10", "obj11", "obj12", "obj13", "", "sky"], create_f003_02_gimmicks),
    // new TMSFESceneDesc("f003_02", "Fortuna Office Fifth Anniversary Party", ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"], ["", "obj10", "obj11", "obj12", "obj13", "", "sky"], create_f003_02_party_gimmicks),
    new TMSFESceneDesc("f001_01", "Shibuya 1", ["f001_01", "obj01", "obj02", "obj10", "sky"], ["", "obj01", "obj02", "obj10", "sky"]),
    new TMSFESceneDesc("f001_02", "Shibuya 2", ["f001_02", "obj01", "obj02", "obj04", "obj10", "sky"], ["", "obj01", "obj02", "obj04", "obj10", ""]),
    new TMSFESceneDesc("f001_03", "Shibuya 3", ["f001_03", "obj01", "obj02", "obj04", "obj10", "sky"], ["", "obj01", "obj02", "obj04", "obj10", "sky"]),
    new TMSFESceneDesc("f001_04", "Shibuya Music Fes", ["f001_04", "obj01", "obj02", "obj10", "obj11", "obj12", "sky"], ["", "obj01", "obj02", "obj10", "obj11", "", "sky"]),
    new TMSFESceneDesc("f001_05", "Shibuya 5", ["f001_05", "obj01", "obj02", "obj10", "sky"], ["", "obj01", "obj02", "obj10", "sky"]),
    new TMSFESceneDesc("f001_06", "Shibuya 6", ["f001_06", "obj01", "obj02", "obj04", "obj10", "sky"], ["", "obj01", "obj02", "obj04", "obj10", ""]),
    new TMSFESceneDesc("f001_07", "Shibuya Epilogue", ["f001_07", "obj01", "obj02", "obj10", "sky"], ["", "obj01", "obj02", "obj10", "sky"]),
    new TMSFESceneDesc("f010_01", "Toubu Rooftop", ["f010_01", "sky"], ["", "sky"]),
    new TMSFESceneDesc("f010_01", "Toubu Rooftop Music Fes", ["f010_01", "sky"], ["", "sky"], create_f010_01_music_fes_gimmicks),
    new TMSFESceneDesc("f010_02", "Classroom Film Set", ["f010_02", "sky"], ["", ""]),
    new TMSFESceneDesc("f007_01", "Harajuku", ["f007_01", "sky"], ["", "sky"]),
    new TMSFESceneDesc("d008_01", "Illusory Urahara Arena", ["d008_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    "Shops",
    new TMSFESceneDesc("f003_01", "Hee Ho Mart 1", ["f003_01"], [""]),
    new TMSFESceneDesc("f003_09", "Hee Ho Mart 2", ["f003_09"], [""]),
    new TMSFESceneDesc("f003_04", "Carabia", ["f003_04", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("f003_06", "Café Seiren", ["f003_06", "sky"], ["", ""], create_f003_06_gimmicks),
    // new TMSFESceneDesc("f003_10", "Café Seiren 2", ["f003_10", "sky"], ["", ""]), // not a wii u file, but the map layout file is big endian, which causes it to fail to load. maybe load the wii u version instead?
    new TMSFESceneDesc("f003_08", "Anzu", ["f003_08"], [""], create_f003_08_gimmicks),
    "Illusory 106",
    new TMSFESceneDesc("d003_01", "Illusory 106 1F to 3F", ["d003_01", "obj01", "obj02"], ["", "obj01", "obj02"], create_d003_01_gimmicks, 2),
    new TMSFESceneDesc("d003_04", "Illusory 106 4F", ["d003_04"], [""]),
    new TMSFESceneDesc("d003_02", "Illusory 106 5F to 7F", ["d003_02", "obj01"], ["", "obj01"], create_d003_02_gimmicks),
    new TMSFESceneDesc("d003_06", "Illusory 106 Outside", ["d003_06", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("d003_03", "Illusory 106 B1F to B3F", ["d003_03", "obj01"], ["", "obj01"], create_d003_03_gimmicks),
    new TMSFESceneDesc("d003_07", "Illusory 106 B4F", ["d003_07"], [""]),
    new TMSFESceneDesc("d003_08", "Illusory 106 Outside 2", ["d003_08", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"]),
    "Illusory Shibuya",
    new TMSFESceneDesc("d004_01", "Illusory Shibuya Block 1", ["d004_01", "obj01", "sky"], ["", "obj01", "sky"], create_d004_01_gimmicks),
    new TMSFESceneDesc("d004_02", "Illusory Shibuya Block 2", ["d004_02", "obj01", "sky"], ["", "obj01", "sky"], create_d004_02_gimmicks),
    new TMSFESceneDesc("d004_03", "Illusory Shibuya Block 3", ["d004_03", "obj01", "sky"],  ["", "obj01", "sky"], create_d004_03_gimmicks),
    new TMSFESceneDesc("d004_04", "Illusory Shibuya Circular Square", ["d004_04", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("d004_05", "Illusory Shibuya Central Square", ["d004_05", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"]),
    "Daitou TV",
    new TMSFESceneDesc("f004_01", "Daitou TV 1", ["f004_01"], [""], create_f004_01_gimmicks, 5),
    new TMSFESceneDesc("f004_01", "Daitou TV 1 Music Fes", ["f004_01"], [""], create_f004_01_music_fes_gimmicks, 5),
    new TMSFESceneDesc("f004_02", "Daitou TV 2", ["f004_02", "obj01"], ["", "obj01"], create_f004_01_gimmicks, 5),
    new TMSFESceneDesc("d005_01", "Illusory Daitou TV Film Set A: Outdoors", ["d005_01", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("d005_03", "Illusory Daitou TV Film Set A: Indoors", ["d005_03"], [""], create_d005_03_gimmicks),
    new TMSFESceneDesc("d005_02", "Illusory Daitou TV Film Set B: Outdoors", ["d005_02", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("d005_04", "Illusory Daitou TV Film Set B: Indoors", ["d005_04"], [""], create_d005_04_gimmicks),
    new TMSFESceneDesc("d005_05", "Illusory Daitou TV Main Stage 1", ["d005_05", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("d005_06", "Illusory Daitou TV Main Stage 2", ["d005_06", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("d005_07", "Illusory Daitou TV Main Stage 3", ["d005_07", "obj01", "sky"], ["", "obj01", "sky"]),
    "Daiba Studio",
    new TMSFESceneDesc("f005_01", "Daiba Studio", ["f005_01"], [""], create_f005_01_gimmicks),
    new TMSFESceneDesc("f005_01", "Daiba Studio Music Fes", ["f005_01"], [""], create_f005_01_music_fes_gimmicks),
    new TMSFESceneDesc("f005_02", "Daiba Studio 2", ["f005_02", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_10", "Illusory Daiba Studio Entrance", ["d006_10", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_01", "Illusory Daiba Studio Monitor Room", ["d006_01", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_02", "Illusory Daiba Studio Main Hallway", ["d006_02", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_03", "Illusory Daiba Studio LCD Panels", ["d006_03", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    new TMSFESceneDesc("d006_04", "Illusory Daiba Studio Back Monitor Room", ["d006_04", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_05", "Illusory Daiba Studio Back Alley", ["d006_05"], [""]),
    new TMSFESceneDesc("d006_06", "Illusory Daiba Studio Film Location A", ["d006_06", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_07", "Illusory Daiba Studio Film Location B", ["d006_07", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_08", "Illusory Daiba Studio Film Location C", ["d006_08", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("d006_09", "Illusory Daiba Studio Film Location D", ["d006_09", "obj01"], ["", "obj01"]),
    "Bloom Palace",
    new TMSFESceneDesc("f003_03", "Bloom Palace", ["f003_03", "obj01", "sky"], ["", "obj", "sky"]),
    new TMSFESceneDesc("d010_01", "Illusory Area of Memories Great Corridor", ["d010_01", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], create_d010_01_gimmicks, 6),
    new TMSFESceneDesc("d010_02", "Illusory Area of Memories Warrior's Hall", ["d010_02"], [""]),
    new TMSFESceneDesc("d010_03", "Illusory Area of Memories Leader's Hall", ["d010_03"], [""]),
    new TMSFESceneDesc("d010_04", "Illusory Area of Memories Hero's Hall", ["d010_04"], [""]),
    new TMSFESceneDesc("d018_01", "Illusory Area of Aspirations 1F to 2F", ["d018_01", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, 7, false, true),
    new TMSFESceneDesc("d018_02", "Illusory Area of Aspirations 3F", ["d018_02", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, undefined, false, true),
    new TMSFESceneDesc("d018_03", "Illusory Area of Aspirations 4F to 5F", ["d018_03", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, undefined, true, true),
    new TMSFESceneDesc("d018_04", "Illusory Area of Aspirations The Nexus", ["d018_04", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, undefined, false, true),
    new TMSFESceneDesc("d015_01", "Training Area", ["d015_01", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", ""]),
    new TMSFESceneDesc("d015_02", "Training Area Fighter's Hall", ["d015_02"], [""]),
    "Cosmic Egg",
    new TMSFESceneDesc("f006_01", "Cosmic Egg", ["f006_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"]),
    new TMSFESceneDesc("f006_01", "Cosmic Egg Barrier", ["f006_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"], create_f006_01_barrier_gimmicks),
    new TMSFESceneDesc("f006_02", "Cosmic Egg 2", ["f006_02", "obj03"], ["", "obj03"]),
    new TMSFESceneDesc("d007_01", "Illusory Dolhr Altitude 48m to Altitude 54m", ["d007_01", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], create_d007_01_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_05", "Illusory Dolhr Altitude 88m", ["d007_05", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], create_d007_05_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_02", "Illusory Dolhr Altitude 122m to Altitude 146m", ["d007_02", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], create_d007_02_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_06", "Illusory Dolhr Altitude 180m", ["d007_06", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], create_d007_06_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_03", "Illusory Dolhr Altitude 232m to Altitude 238m", ["d007_03", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], create_d007_03_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_07", "Illusory Dolhr Altitude 333m", ["d007_07", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], create_d007_07_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_04", "Illusory Dolhr Altitude 428m to Altitude 434m", ["d007_04", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], create_d007_04_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_08", "Illusory Dolhr Altitude 525m", ["d007_08", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], create_d007_08_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_09", "Illusory Dolhr Altitude 634m", ["d007_09", "obj00", "obj01", "obj02", "obj03", "sky"], ["", "obj00", "obj01", "obj02", "obj03", "sky"], create_d007_09_gimmicks, undefined, false, true),
    new TMSFESceneDesc("d007_10", "Illusory Dolhr Shadow Stage", ["d007_10", "d007_10_obj01", "d007_10_obj02", "sky"], ["", "d007_10_obj01", "d007_10_obj02", "sky"]),
    "Battle Maps",
    new TMSFESceneDesc("b002_01", "b002_01", ["b002_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b003_01", "b003_01", ["b003_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b004_01", "b004_01", ["b004_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b005_01", "b005_01", ["b005_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b006_01", "b006_01", ["b006_01", "obj01", "obj02", "obj03", "obj04"], ["", "obj01", "obj02", "obj03", "obj04"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b007_01", "b007_01", ["b007_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b008_01", "b008_01", ["b008_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b009_01", "b009_01", ["b009_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b010_01", "b010_01", ["b010_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b011_01", "b011_01", ["b011_01", "obj01", "obj02", "obj03", "obj04"], ["", "obj01", "obj02", "obj03", ""]),
    new TMSFESceneDesc("b012_01", "b012_01", ["b012_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b013_01", "b013_01", ["b013_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b014_01", "b014_01", ["b014_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b015_01", "b015_01", ["b015_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    new TMSFESceneDesc("b016_01", "b016_01", ["b016_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, undefined, undefined, undefined, true),
    "Cutscene Maps",
    new TMSFESceneDesc("f003_05", "Uzume Lesson Studio", ["f003_05"], [""]),
    new TMSFESceneDesc("f010_03", "Masqueraider Raiga", ["f010_03", "sky"], ["", ""]),
    // new TMSFESceneDesc("f010_04", "Hot Spring"), wii u file
    new TMSFESceneDesc("f010_05", "Microwavin' with Mamorin Set", ["f010_05"], [""]),
    new TMSFESceneDesc("f010_06", "Dressing Room", ["f010_06"], [""]),
    new TMSFESceneDesc("f010_07", "Fashion Show Runway", ["f010_07", "f010_07_obj01", "f010_07_obj02"], ["", "f010_07_obj01", "f010_07_obj02"]),
    new TMSFESceneDesc("guambeach_00", "Guam Beach Day", ["guambeach_00"], [""]),
    new TMSFESceneDesc("guambeach_02", "Guam Beach Sunset", ["guambeach_02"], [""]),
    "Extra",
    // new TMSFESceneDesc("d002_04", "d003_02_PLAN_TEST_STAND", ["d002_04", "sky"], ["", "sky"]), wii u file v3.4.0.2
    // new TMSFESceneDesc("d003_05", "d003_05_PLAN", ["d003_05", "sky"], ["", "sky"]), wii u file v3.4.0.2
    // new TMSFESceneDesc("d004_06", "Central Square 2"), wii u file
    // new TMSFESceneDesc("b000_00", "b000_00"), wii u file
    // new TMSFESceneDesc("b001_01", "b001_01"), wii u file
    new TMSFESceneDesc("f003_07", "???", ["f003_07", "sky"], ["", ""]),
    new TMSFESceneDesc("f007_02", "????", ["f007_02", "sky"], ["", ""]),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
