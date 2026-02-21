// scene.ts
// Handles all the levels in Tokyo Mirage Sessions ♯FE

import * as d002_01 from "./maps/d002_01.js";
import * as d003_01 from "./maps/d003_01.js";
import * as d003_02 from "./maps/d003_02.js";
import * as d003_03 from "./maps/d003_03.js";
import * as d004_01 from "./maps/d004_01.js";
import * as d004_02 from "./maps/d004_02.js";
import * as d004_03 from "./maps/d004_03.js";
import * as d005_01 from "./maps/d005_01.js";
import * as d005_02 from "./maps/d005_02.js";
import * as d005_03 from "./maps/d005_03.js";
import * as d005_04 from "./maps/d005_04.js";
import * as d006_02 from "./maps/d006_02.js";
import * as d006_03 from "./maps/d006_03.js";
import * as d007_01 from "./maps/d007_01.js";
import * as d007_02 from "./maps/d007_02.js";
import * as d007_03 from "./maps/d007_03.js";
import * as d007_04 from "./maps/d007_04.js";
import * as d007_05 from "./maps/d007_05.js";
import * as d007_06 from "./maps/d007_06.js";
import * as d007_07 from "./maps/d007_07.js";
import * as d007_08 from "./maps/d007_08.js";
import * as d007_09 from "./maps/d007_09.js";
import * as d010_01 from "./maps/d010_01.js";
import * as f001_01 from "./maps/f001_01.js";
import * as f001_02 from "./maps/f001_02.js";
import * as f001_03 from "./maps/f001_03.js";
import * as f001_04 from "./maps/f001_04.js";
import * as f001_05 from "./maps/f001_05.js";
import * as f002_03 from "./maps/f002_03.js";
import * as f003_01 from "./maps/f003_01.js";
import * as f003_02 from "./maps/f003_02.js";
import * as f003_04 from "./maps/f003_04.js";
import * as f003_06 from "./maps/f003_06.js";
import * as f003_08 from "./maps/f003_08.js";
import * as f003_09 from "./maps/f003_09.js";
import * as f003_10 from "./maps/f003_10.js";
import * as f004_01 from "./maps/f004_01.js";
import * as f005_01 from "./maps/f005_01.js";
import * as f006_01 from "./maps/f006_01.js";
import * as f007_01 from "./maps/f007_01.js";
import * as f010_01 from "./maps/f010_01.js";
import * as f010_07 from "./maps/f010_07.js";

import * as APAK from "./apak.js";
import * as BFRES from "../fres_nx/bfres.js";
import * as bfres_helpers from "./bfres_helpers.js";
import { DataFetcher } from "../DataFetcher.js";
import { create_common_gimmicks } from "./gimmick.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { gimmick } from "./gimmick.js";
import { LightmapTexture, parse_atlm } from "./lightmap.js";
import { Light, parseLights } from "./lights.js";
import { MapLayout, parseLayout } from "./maplayout.js";
import { TMSFEScene } from "./render.js"
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { SceneGfx, SceneGroup } from "../viewer.js";
import { replacement_texture_group } from "./render_fmdl_texture_replace.js";

/**
 * Defines a single level from Tokyo Mirage Sessions ♯FE
 */
class TMSFESceneDesc implements SceneDesc
{
    /**
     * @param path path to the levels' model.apak without the file extension
     * @param id Identifier for each map. Displayed in the URL.
     * @param name The map's display name in the UI
     * @param model_file_names which model files in model.apak to load
     * @param animation_file_names which animation files in model.apak to load, the order matches model_file_names
     * @param map_gimmick_function per map function that spawns objects in a level
     * @param is_d018_03 this map has some hardcoded behavior, and using a bool is faster than a string compare
     * @param special_skybox this map has a small skybox mesh that follows the camera
     * @param has_battle_audience whether to add the audience models
     * @param replacement_texture_function per map function that loads replacement textures for dynamic elements such as posters, tvs, and advertisements
     */
    constructor
    (
        private path: string,
        public id: string,
        public name: string,
        private model_file_names: string[],
        private animation_file_names: string[],
        private map_gimmick_function?: (layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice) => Promise<gimmick[]>,
        private is_d018_03?: boolean | undefined,
        private special_skybox?: boolean | undefined,
        private has_battle_audience?: boolean | undefined,
        private replacement_texture_function?: (data_fetcher: DataFetcher, device: GfxDevice) => Promise<replacement_texture_group[]>,
    ) {}

    /**
     * When a map is selected from the list, load the map's data and create the scene
     */
    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx>
    {
        const dataFetcher = context.dataFetcher;

        if (this.is_d018_03 === undefined) { this.is_d018_03 = false };
        if (this.special_skybox === undefined) { this.special_skybox = false };

        const apak = APAK.parseAPAK(await dataFetcher.fetchData(`TokyoMirageSessionsSharpFE/${this.path}/model.zip`));

        // get model files
        let level_models: level_model[] = [];
        let model_fres: BFRES.FRES;
        let animation_fres: BFRES.FRES | undefined = undefined;
        for (let i = 0; i < this.model_file_names.length; i++)
        {
            const model_file_name = `${this.model_file_names[i]}.bfres`
            const model_bfres_data = APAK.get_file_by_name(apak, model_file_name);
            if (model_bfres_data !== undefined)
            {
                model_fres = bfres_helpers.parse_bfres(model_bfres_data);
            }
            else
            {
                console.error(`file ${model_file_name} not found`);
                throw("whoops");
            }

            // get animation file
            if (this.animation_file_names[i] !== "")
            {
                const animation_file_name = `${this.animation_file_names[i]}.anm`
                const animation_bfres_data = APAK.get_file_by_name(apak, animation_file_name);
                if (animation_bfres_data !== undefined)
                {
                    animation_fres = bfres_helpers.parse_bfres(animation_bfres_data);
                }
                else
                {
                    console.error(`file ${animation_file_name} not found`);
                    throw("whoops");
                }
            }

            level_models.push({ model_fres, animation_fres, lightmaps: undefined });
        }

        if (this.has_battle_audience)
        {
            // add the audience models
            const audience_00_fres = await APAK.get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience00/skin/00/model", "audience00_00.bfres", dataFetcher);
            const audience_01_fres = await APAK.get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience01/skin/00/model", "audience01_00.bfres", dataFetcher);
            const audience_02_fres = await APAK.get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience02/skin/00/model", "audience02_00.bfres", dataFetcher);
            const audience_00_animation_fres = await APAK.get_animations_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience00/skin/00/model_common", dataFetcher);
            level_models.push({ model_fres: audience_00_fres, animation_fres: audience_00_animation_fres[0], lightmaps: undefined });
            level_models.push({ model_fres: audience_01_fres, animation_fres: audience_00_animation_fres[0], lightmaps: undefined });
            level_models.push({ model_fres: audience_02_fres, animation_fres: audience_00_animation_fres[0], lightmaps: undefined });
        }

        let replacement_texture_groups: replacement_texture_group[] = [];
        if (this.replacement_texture_function !== undefined)
        {
            replacement_texture_groups = await this.replacement_texture_function(dataFetcher, device);
        }
        
        let layout = undefined;
        let common_gimmicks: gimmick[] = [];
        let map_gimmicks: gimmick[] = [];
        const maplayout_data = APAK.get_file_by_name(apak, "maplayout.layout");
        if (maplayout_data !== undefined)
        {
            layout = parseLayout(maplayout_data);
            common_gimmicks = await create_common_gimmicks(layout, this.is_d018_03, dataFetcher, device);
            if (this.map_gimmick_function !== undefined)
            {
                map_gimmicks = await this.map_gimmick_function(layout, dataFetcher, device);
            }
        }
        else if (this.id === "f010_07")
        {
            // this map has no maplayout.layout file
            map_gimmicks = await f010_07.create_gimmicks(dataFetcher, device);
        }
        
        let lights: Light[] = [];
        const light_data = APAK.get_file_by_name(apak, `${this.id}.lig`);
        if (light_data !== undefined)
        {
            lights = parseLights(light_data);
        }

        const lightmap_file_name = `${this.id}.atlm`
        const lightmap_data = APAK.get_file_by_name(apak, lightmap_file_name);
        if (lightmap_data !== undefined)
        {
            // only the main model for each level has lightmap textures
            level_models[0].lightmaps = parse_atlm(lightmap_data, device);
        }

        let scene = new TMSFEScene(device, level_models, this.special_skybox, replacement_texture_groups, layout, common_gimmicks, map_gimmicks, lights);
        return scene;
    }
}

export interface level_model
{
    model_fres: BFRES.FRES;
    animation_fres: BFRES.FRES | undefined;
    lightmaps: LightmapTexture[] | undefined;
}

// sceneGroup
// Collection of all the levels
// id: Identifier for this game. It is displayed in the URL.
// name: The game's display name in the UI
// sceneDescs: List of all the levels that are a part of this game. They are grouped into separate categories
const id = `TokyoMirageSessionsSharpFE`;
const name = "Tokyo Mirage Sessions ♯FE";
const sceneDescs =
[
    "Daitama Observatory",
    new TMSFESceneDesc("Map/field/f002/f002_01", "f002_01", "Daitama Observatory (Prologue)", ["f002_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    new TMSFESceneDesc("Map/field/f002/f002_02", "f002_02", "Daitama Observatory (Dead)", ["f002_02", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    new TMSFESceneDesc("Map/field/f002/f002_03", "f002_03", "Daitama Observatory", ["f002_03", "obj01", "obj02", "obj12", "sky"], ["", "", "obj02", "obj12", ""], f002_03.create_gimmicks, false, true, false, f002_03.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d002/d002_01", "d002_01", "Illusory Daitama", ["d002_01", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], d002_01.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d002/d002_02", "d002_02", "Illusory Daitama Blue Observatory", ["d002_02"], [""]),
    new TMSFESceneDesc("Map/dungeon/d002/d002_03", "d002_03", "Illusory Daitama Red Observatory", ["d002_03"], [""]),
    "Tokyo",
    new TMSFESceneDesc("Map/field/f001/f001_01", "f001_01", "Shibuya", ["f001_01", "obj01", "obj02", "obj10", "sky"], ["", "obj01", "obj02", "obj10", "sky"], undefined, false, false, false, f001_01.replacement_textures),
    new TMSFESceneDesc("Map/field/f001/f001_02", "f001_02", "Shibuya (Dead)", ["f001_02", "obj01", "obj02", "obj04", "obj10", "sky"], ["", "obj01", "obj02", "obj04", "obj10", ""], undefined, false, false, false, f001_02.replacement_textures),
    new TMSFESceneDesc("Map/field/f001/f001_03", "f001_03", "Shibuya (Half Dead)", ["f001_03", "obj01", "obj02", "obj04", "obj10", "sky"], ["", "obj01", "obj02", "obj04", "obj10", "sky"], f001_03.create_half_dead_gimmicks, false, false, false, f001_03.replacement_textures),
    new TMSFESceneDesc("Map/field/f001/f001_04", "f001_04", "Shibuya (Music Fes)", ["f001_04", "obj01", "obj02", "obj10", "obj11", "obj12", "sky"], ["", "obj01", "obj02", "obj10", "obj11", "", "sky"], undefined, false, false, false, f001_04.replacement_textures),
    new TMSFESceneDesc("Map/field/f001/f001_05", "f001_05", "Shibuya (SIV-LIVE)", ["f001_05", "obj01", "obj02", "obj10", "sky"], ["", "obj01", "obj02", "obj10", "sky"], undefined, false, false, false, f001_05.replacement_textures),
    new TMSFESceneDesc("Map/field/f003/f003_02", "f003_02", "Fortuna Office", ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"], ["", "obj10", "obj11", "obj12", "obj13", "", "sky"], f003_02.create_gimmicks, false, false, false, f003_02.replacement_textures),
    new TMSFESceneDesc("Map/field/f003/f003_02", "f003_02_party", "Fortuna Office (Fifth Anniversary Party)", ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"], ["", "obj10", "obj11", "obj12", "obj13", "", "sky"], f003_02.create_party_gimmicks, false, false, false, f003_02.replacement_textures),
    new TMSFESceneDesc("Map/field/f010/f010_01", "f010_01", "Toubo Rooftop", ["f010_01", "sky"], ["", "sky"], undefined, false, false, false, f010_01.replacement_textures),
    new TMSFESceneDesc("Map/field/f010/f010_01", "f010_01_fes", "Toubo Rooftop (Music Fes)", ["f010_01", "sky"], ["", "sky"], f010_01.create_music_fes_gimmicks, false, false, false, f010_01.replacement_textures),
    new TMSFESceneDesc("Map/field/f010/f010_02", "f010_02", "Classroom Film Set", ["f010_02", "sky"], ["", ""]),
    new TMSFESceneDesc("Map/field/f007/f007_01", "f007_01", "Harajuku", ["f007_01", "sky"], ["", "sky"], undefined, false, false, false, f007_01.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d008/d008_01", "d008_01", "Illusory Urahara Arena", ["d008_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"]),
    "Shops",
    new TMSFESceneDesc("Map/field/f003/f003_01", "f003_01", "Hee Ho Mart", ["f003_01"], [""], f003_01.create_gimmicks, false, false, false, f003_01.replacement_textures),
    new TMSFESceneDesc("Map/field/f003/f003_09", "f003_09", "Hee Ho Mart (Dead)", ["f003_09"], [""], f003_09.create_gimmicks, false, false, false, f003_09.replacement_textures),
    new TMSFESceneDesc("Map/field/f003/f003_04", "f003_04", "Jewelry Carabia", ["f003_04", "obj01"], ["", "obj01"], f003_04.create_gimmicks),
    new TMSFESceneDesc("Map/field/f003/f003_06", "f003_06", "Café Seiren", ["f003_06", "sky"], ["", ""], f003_06.create_gimmicks),
    new TMSFESceneDesc("Map/field/f003/f003_10", "f003_10", "Café Seiren (Dead)", ["f003_10", "sky"], ["", ""], f003_10.create_gimmicks),
    new TMSFESceneDesc("Map/field/f003/f003_08", "f003_08", "Anzu", ["f003_08"], [""], f003_08.create_gimmicks),
    "Illusory 106",
    new TMSFESceneDesc("Map/dungeon/d003/d003_01", "d003_01", "Illusory 106 1F to 3F", ["d003_01", "obj01", "obj02"], ["", "obj01", "obj02"], d003_01.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d003/d003_04", "d003_04", "Illusory 106 4F", ["d003_04"], [""]),
    new TMSFESceneDesc("Map/dungeon/d003/d003_02", "d003_02", "Illusory 106 5F to 7F", ["d003_02", "obj01"], ["", "obj01"], d003_02.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d003/d003_06", "d003_06", "Illusory 106 Outside", ["d003_06", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"]),
    new TMSFESceneDesc("Map/dungeon/d003/d003_03", "d003_03", "Illusory 106 B1F to B3F", ["d003_03", "obj01"], ["", "obj01"], d003_03.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d003/d003_07", "d003_07", "Illusory 106 B4F", ["d003_07"], [""]),
    "Illusory Shibuya",
    new TMSFESceneDesc("Map/dungeon/d004/d004_01", "d004_01", "Illusory Shibuya Block 1", ["d004_01", "obj01", "sky"], ["", "obj01", "sky"], d004_01.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d004/d004_02", "d004_02", "Illusory Shibuya Block 2", ["d004_02", "obj01", "sky"], ["", "obj01", "sky"], d004_02.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d004/d004_03", "d004_03", "Illusory Shibuya Block 3", ["d004_03", "obj01", "sky"],  ["", "obj01", "sky"], d004_03.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d004/d004_04", "d004_04", "Illusory Shibuya Circular Square", ["d004_04", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("Map/dungeon/d004/d004_05", "d004_05", "Illusory Shibuya Central Square", ["d004_05", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"]),
    "Daitou TV",
    new TMSFESceneDesc("Map/field/f004/f004_01", "f004_01", "Daitou TV", ["f004_01"], [""], f004_01.create_gimmicks),
    new TMSFESceneDesc("Map/field/f004/f004_01", "f004_01_fes", "Daitou TV (Music Fes)", ["f004_01"], [""], f004_01.create_music_fes_gimmicks),
    new TMSFESceneDesc("Map/field/f004/f004_02", "f004_02", "Daitou TV (Dead)", ["f004_02", "obj01"], ["", "obj01"], f004_01.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d005/d005_01", "d005_01", "Illusory Daitou TV Film Set A: Outdoors", ["d005_01", "obj01", "sky"], ["", "obj01", "sky"], undefined, false, false, false, d005_01.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d005/d005_03", "d005_03", "Illusory Daitou TV Film Set A: Indoors", ["d005_03"], [""], d005_03.create_gimmicks, false, false, false, d005_03.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d005/d005_02", "d005_02", "Illusory Daitou TV Film Set B: Outdoors", ["d005_02", "obj01", "sky"], ["", "obj01", "sky"], undefined, false, false, false, d005_02.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d005/d005_04", "d005_04", "Illusory Daitou TV Film Set B: Indoors", ["d005_04"], [""], d005_04.create_gimmicks, false, false, false, d005_04.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d005/d005_05", "d005_05", "Illusory Daitou TV Main Stage 1", ["d005_05", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("Map/dungeon/d005/d005_06", "d005_06", "Illusory Daitou TV Main Stage 2", ["d005_06", "obj01", "sky"], ["", "obj01", "sky"]),
    new TMSFESceneDesc("Map/dungeon/d005/d005_07", "d005_07", "Illusory Daitou TV Main Stage 3", ["d005_07", "obj01", "sky"], ["", "obj01", "sky"]),
    "Daiba Studio",
    new TMSFESceneDesc("Map/field/f005/f005_01", "f005_01", "Daiba Studio", ["f005_01"], [""], f005_01.create_gimmicks),
    new TMSFESceneDesc("Map/field/f005/f005_01", "f005_01_fes", "Daiba Studio (Music Fes)", ["f005_01"], [""], f005_01.create_music_fes_gimmicks),
    new TMSFESceneDesc("Map/field/f005/f005_02", "f005_02", "Daiba Studio (Dead)", ["f005_02", "obj01"], ["", "obj01"], f005_01.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d006/d006_10", "d006_10", "Illusory Daiba Studio Entrance", ["d006_10", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_01", "d006_01", "Illusory Daiba Studio Monitor Room", ["d006_01", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_02", "d006_02", "Illusory Daiba Studio Main Hallway", ["d006_02", "obj01"], ["", "obj01"], undefined, false, false, false, d006_02.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d006/d006_03", "d006_03", "Illusory Daiba Studio LCD Panels", ["d006_03", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, false, d006_03.replacement_textures),
    new TMSFESceneDesc("Map/dungeon/d006/d006_04", "d006_04", "Illusory Daiba Studio Back Monitor Room", ["d006_04", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_05", "d006_05", "Illusory Daiba Studio Back Alley", ["d006_05"], [""]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_06", "d006_06", "Illusory Daiba Studio Film Location A", ["d006_06", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_07", "d006_07", "Illusory Daiba Studio Film Location B", ["d006_07", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_08", "d006_08", "Illusory Daiba Studio Film Location C", ["d006_08", "obj01"], ["", "obj01"]),
    new TMSFESceneDesc("Map/dungeon/d006/d006_09", "d006_09", "Illusory Daiba Studio Film Location D", ["d006_09", "obj01"], ["", "obj01"]),
    "Bloom Palace",
    new TMSFESceneDesc("Map/field/f003/f003_03", "f003_03", "Bloom Palace", ["f003_03", "obj01", "sky"], ["", "obj", "sky"]),
    new TMSFESceneDesc("Map/dungeon/d010/d010_01", "d010_01", "Area of Memories Great Corridor", ["d010_01", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], d010_01.create_gimmicks),
    new TMSFESceneDesc("Map/dungeon/d010/d010_02", "d010_02", "Area of Memories Warrior's Hall", ["d010_02"], [""]),
    new TMSFESceneDesc("Map/dungeon/d010/d010_03", "d010_03", "Area of Memories Leader's Hall", ["d010_03"], [""]),
    new TMSFESceneDesc("Map/dungeon/d010/d010_04", "d010_04", "Area of Memories Hero's Hall", ["d010_04"], [""]),
    new TMSFESceneDesc("Map/dungeon/d018/d018_01", "d018_01", "Area of Aspirations 1F to 2F", ["d018_01", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, false, true),
    new TMSFESceneDesc("Map/dungeon/d018/d018_02", "d018_02", "Area of Aspirations 3F", ["d018_02", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, false, true),
    new TMSFESceneDesc("Map/dungeon/d018/d018_03", "d018_03", "Area of Aspirations 4F to 5F", ["d018_03", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, true, true),
    new TMSFESceneDesc("Map/dungeon/d018/d018_04", "d018_04", "Area of Aspirations The Nexus", ["d018_04", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], undefined, false, true),
    new TMSFESceneDesc("Map/dungeon/d015/d015_01", "d015_01", "Training Area", ["d015_01", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", ""]),
    new TMSFESceneDesc("Map/dungeon/d015/d015_02", "d015_02", "Training Area Fighter's Hall", ["d015_02"], [""]),
    "Cosmic Egg",
    new TMSFESceneDesc("Map/field/f006/f006_01", "f006_01", "Cosmic Egg (Dead)", ["f006_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"]),
    new TMSFESceneDesc("Map/field/f006/f006_01", "f006_01_barrier", "Cosmic Egg (Barrier)", ["f006_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"], f006_01.create_barrier_gimmicks),
    new TMSFESceneDesc("Map/field/f006/f006_02", "f006_02", "Cosmic Egg", ["f006_02", "obj03"], ["", "obj03"]),
    new TMSFESceneDesc("Map/dungeon/d007/d007_01", "d007_01", "Illusory Dolhr Altitude 48m to Altitude 54m", ["d007_01", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], d007_01.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_05", "d007_05", "Illusory Dolhr Altitude 88m", ["d007_05", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], d007_05.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_02", "d007_02", "Illusory Dolhr Altitude 122m to Altitude 146m", ["d007_02", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], d007_02.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_06", "d007_06", "Illusory Dolhr Altitude 180m", ["d007_06", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], d007_06.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_03", "d007_03", "Illusory Dolhr Altitude 232m to Altitude 238m", ["d007_03", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], d007_03.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_07", "d007_07", "Illusory Dolhr Altitude 333m", ["d007_07", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], d007_07.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_04", "d007_04", "Illusory Dolhr Altitude 428m to Altitude 434m", ["d007_04", "obj01", "obj02", "obj03", "sky"], ["", "obj01", "obj02", "obj03", "sky"], d007_04.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_08", "d007_08", "Illusory Dolhr Altitude 525m", ["d007_08", "obj01", "obj02", "sky"], ["", "obj01", "obj02", "sky"], d007_08.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_09", "d007_09", "Illusory Dolhr Altitude 634m", ["d007_09", "obj00", "obj01", "obj02", "obj03", "sky"], ["", "obj00", "obj01", "obj02", "obj03", "sky"], d007_09.create_gimmicks, false, true),
    new TMSFESceneDesc("Map/dungeon/d007/d007_10", "d007_10", "Illusory Dolhr Shadow Stage", ["d007_10", "d007_10_obj01", "d007_10_obj02", "sky"], ["", "d007_10_obj01", "d007_10_obj02", "sky"]),
    "Battle Maps",
    new TMSFESceneDesc("Map/battle/b002/b002_01", "b002_01", "Illusory Daitama Battle", ["b002_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b009/b009_01", "b009_01", "Boss Fight", ["b009_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b003/b003_01", "b003_01", "Illusory 106 Battle", ["b003_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b015/b015_01", "b015_01", "Aversa Fight", ["b015_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b004/b004_01", "b004_01", "Illusory Shibuya Battle", ["b004_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b010/b010_01", "b010_01", "Bloom Palace Battle", ["b010_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b005/b005_01", "b005_01", "Illusory Daitou TV Battle", ["b005_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b006/b006_01", "b006_01", "Illusory Daiba Studio Battle", ["b006_01", "obj01", "obj02", "obj03", "obj04"], ["", "obj01", "obj02", "obj03", "obj04"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b012/b012_01", "b012_01", "Area of Memories Battle", ["b012_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b013/b013_01", "b013_01", "Gharnef Fight", ["b013_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b007/b007_01", "b007_01", "Illusory Dohlr Battle", ["b007_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b011/b011_01", "b011_01", "Medeus Fight", ["b011_01", "obj01", "obj02", "obj03", "obj04"], ["", "obj01", "obj02", "obj03", ""]),
    new TMSFESceneDesc("Map/battle/b008/b008_01", "b008_01", "Illusory Urahara Battle", ["b008_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b014/b014_01", "b014_01", "Training Area Battle", ["b014_01", "obj01", "obj02", "obj03"], ["", "obj01", "", "obj03"], undefined, false, false, true),
    new TMSFESceneDesc("Map/battle/b016/b016_01", "b016_01", "Area of Aspirations Battle", ["b016_01", "obj01", "obj02", "obj03"], ["", "obj01", "obj02", "obj03"], undefined, false, false, true),
    "Cutscene Maps",
    new TMSFESceneDesc("Map/field/f003/f003_05", "f003_05", "Uzume Lesson Studio", ["f003_05"], [""]),
    new TMSFESceneDesc("Map/field/f010/f010_03", "f010_03", "Quarry", ["f010_03", "sky"], ["", ""]),
    new TMSFESceneDesc("Map/field/f010/f010_05", "f010_05", "Kitchen Set", ["f010_05"], [""]),
    new TMSFESceneDesc("Map/field/f010/f010_06", "f010_06", "Dressing Room", ["f010_06"], [""]),
    new TMSFESceneDesc("Map/field/f010/f010_07", "f010_07", "Tokyo Millennium Collection Venue", ["f010_07", "f010_07_obj01", "f010_07_obj02"], ["", "f010_07_obj01", "f010_07_obj02"]),
    new TMSFESceneDesc("Character/prop/guambeach/skin/00", "guambeach_00", "Guam Beach (Day)", ["guambeach_00"], [""]),
    new TMSFESceneDesc("Character/prop/guambeach/skin/02", "guambeach_02", "Guam Beach (Sunset)", ["guambeach_02"], [""]),
    "Unused",
    new TMSFESceneDesc("Map/field/f003/f003_07", "f003_07", "Office Storage", ["f003_07", "sky"], ["", ""]),
    new TMSFESceneDesc("Map/field/f007/f007_02", "f007_02", "Izuhara Entertainment Agency", ["f007_02", "sky"], ["", ""]),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
