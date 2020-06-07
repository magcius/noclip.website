
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

class HalfLife2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await filesystem.createVPKMount(`${pathBase}/hl2_textures`);
            await filesystem.createVPKMount(`${pathBase}/hl2_misc`);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `HalfLife2`;

const id = 'HalfLife2';
const name = 'Half-Life 2';
// https://developer.valvesoftware.com/wiki/Half-Life_2_map_reference
const sceneDescs = [
    "Main Menu Backgrounds",
    new HalfLife2SceneDesc('background01'),
    new HalfLife2SceneDesc('background02'),
    new HalfLife2SceneDesc('background03'),
    new HalfLife2SceneDesc('background04'),
    new HalfLife2SceneDesc('background05'),

    "Point Insertion",
    new HalfLife2SceneDesc('d1_trainstation_01'),
    new HalfLife2SceneDesc('d1_trainstation_02'),
    new HalfLife2SceneDesc('d1_trainstation_03'),
    new HalfLife2SceneDesc('d1_trainstation_04'),

    "A Red Letter Day",
    new HalfLife2SceneDesc('d1_trainstation_05'),
    new HalfLife2SceneDesc('d1_trainstation_06'),

    "Route Kanal",
    new HalfLife2SceneDesc('d1_canals_01'),
    new HalfLife2SceneDesc('d1_canals_01a'),
    new HalfLife2SceneDesc('d1_canals_02'),
    new HalfLife2SceneDesc('d1_canals_03'),
    new HalfLife2SceneDesc('d1_canals_05'),

    "Water Hazard",
    new HalfLife2SceneDesc('d1_canals_06'),
    new HalfLife2SceneDesc('d1_canals_07'),
    new HalfLife2SceneDesc('d1_canals_08'),
    new HalfLife2SceneDesc('d1_canals_09'),
    new HalfLife2SceneDesc('d1_canals_10'),
    new HalfLife2SceneDesc('d1_canals_11'),
    new HalfLife2SceneDesc('d1_canals_12'),
    new HalfLife2SceneDesc('d1_canals_13'),

    "Black Mesa East",
    new HalfLife2SceneDesc('d1_eli_01'),
    new HalfLife2SceneDesc('d1_eli_02'),

    "We Don't Go To Ravenholm",
    new HalfLife2SceneDesc('d1_town_01'),
    new HalfLife2SceneDesc('d1_town_01a'),
    new HalfLife2SceneDesc('d1_town_02'),
    new HalfLife2SceneDesc('d1_town_03'),
    new HalfLife2SceneDesc('d1_town_02a'),
    new HalfLife2SceneDesc('d1_town_04'),
    new HalfLife2SceneDesc('d1_town_05'),

    "Highway 17",
    new HalfLife2SceneDesc('d2_coast_01'),
    new HalfLife2SceneDesc('d2_coast_03'),
    new HalfLife2SceneDesc('d2_coast_04'),
    new HalfLife2SceneDesc('d2_coast_05'),
    new HalfLife2SceneDesc('d2_coast_07'),
    new HalfLife2SceneDesc('d2_coast_08'),

    "Sandtraps",
    new HalfLife2SceneDesc('d2_coast_09'),
    new HalfLife2SceneDesc('d2_coast_10'),
    new HalfLife2SceneDesc('d2_coast_11'),
    new HalfLife2SceneDesc('d2_coast_12'),
    new HalfLife2SceneDesc('d2_prison_01'),

    "Nova Prospekt",
    new HalfLife2SceneDesc('d2_prison_02'),
    new HalfLife2SceneDesc('d2_prison_03'),
    new HalfLife2SceneDesc('d2_prison_04'),
    new HalfLife2SceneDesc('d2_prison_05'),

    "Entanglement",
    new HalfLife2SceneDesc('d2_prison_06'),
    new HalfLife2SceneDesc('d2_prison_07'),
    new HalfLife2SceneDesc('d2_prison_08'),
    new HalfLife2SceneDesc('d3_c17_01'),

    "Anticitizen One",
    new HalfLife2SceneDesc('d3_c17_02'),
    new HalfLife2SceneDesc('d3_c17_03'),
    new HalfLife2SceneDesc('d3_c17_04'),
    new HalfLife2SceneDesc('d3_c17_05'),
    new HalfLife2SceneDesc('d3_c17_06a'),
    new HalfLife2SceneDesc('d3_c17_06b'),
    new HalfLife2SceneDesc('d3_c17_07'),
    new HalfLife2SceneDesc('d3_c17_08'),

    "\"Follow Freeman!\"",
    new HalfLife2SceneDesc('d3_c17_09'),
    new HalfLife2SceneDesc('d3_c17_10a'),
    new HalfLife2SceneDesc('d3_c17_10b'),
    new HalfLife2SceneDesc('d3_c17_11'),
    new HalfLife2SceneDesc('d3_c17_12'),
    new HalfLife2SceneDesc('d3_c17_12b'),
    new HalfLife2SceneDesc('d3_c17_13'),

    "Our Benefactors",
    new HalfLife2SceneDesc('d3_citadel_01'),
    new HalfLife2SceneDesc('d3_citadel_02'),
    new HalfLife2SceneDesc('d3_citadel_03'),
    new HalfLife2SceneDesc('d3_citadel_04'),
    new HalfLife2SceneDesc('d3_citadel_05'),

    "Dark Energy",
    new HalfLife2SceneDesc('d3_breen_01'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
