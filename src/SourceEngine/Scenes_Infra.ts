
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem, SourceLoadContext } from "./Main";
import { createScene } from "./Scenes";

class InfraSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/pak01`),
                filesystem.createVPKMount(`${pathBase}/pak02`),
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `maps/${this.id}.bsp`, true);
    }
}

const pathBase = `Infra`;

const id = 'Infra';
const name = 'Infra';
const sceneDescs = [
    "Main Menu Background",
    new InfraSceneDesc('main_menu'),

    "Preparations",
    new InfraSceneDesc('infra_c1_m1_office'),

    "Just Another Day at Work",
    new InfraSceneDesc('infra_c2_m1_reserve1'),
    new InfraSceneDesc('infra_c2_m2_reserve2'),
    new InfraSceneDesc('infra_c2_m3_reserve3'),

    "Forgotten World",
    new InfraSceneDesc('infra_c3_m1_tunnel'),
    new InfraSceneDesc('infra_c3_m2_tunnel2'),
    new InfraSceneDesc('infra_c3_m3_tunnel3'),
    new InfraSceneDesc('infra_c3_m4_tunnel4'),

    "Heavy Industry of the Past",
    new InfraSceneDesc('infra_c4_m2_furnace'),
    new InfraSceneDesc('infra_c4_m3_tower'),

    "Fresh Water",
    new InfraSceneDesc('infra_c5_m1_watertreatment'),
    new InfraSceneDesc('infra_c5_m2_sewer'),
    new InfraSceneDesc('infra_c5_m2b_sewer2'),

    "Public Transport",
    new InfraSceneDesc('infra_c6_m1_sewer3'),
    new InfraSceneDesc('infra_c6_m2_metro'),
    new InfraSceneDesc('infra_c6_m3_metroride'),
    new InfraSceneDesc('infra_c6_m4_waterplant'),
    new InfraSceneDesc('infra_c6_m5_minitrain'),
    new InfraSceneDesc('infra_c6_m6_central'),

    "Working Overtime",
    new InfraSceneDesc('infra_c7_m1_servicetunnel'),
    new InfraSceneDesc('infra_c7_m1b_skyscraper'),
    new InfraSceneDesc('infra_c7_m2_bunker'),
    new InfraSceneDesc('infra_c7_m3_stormdrain'),
    new InfraSceneDesc('infra_c7_m4_cistern'),
    new InfraSceneDesc('infra_c7_m5_powerstation'),

    "Late for a Meeting",
    new InfraSceneDesc('infra_c8_m1_powerstation2'),
    new InfraSceneDesc('infra_c8_m3_isle1'),
    new InfraSceneDesc('infra_c8_m4_isle2'),
    new InfraSceneDesc('infra_c8_m5_isle3'),
    new InfraSceneDesc('infra_c8_m6_business'),
    new InfraSceneDesc('infra_c8_m7_business2'),
    new InfraSceneDesc('infra_c8_m8_officeblackout'),

    "To Save a City",
    new InfraSceneDesc('infra_c9_m1_rails'),
    new InfraSceneDesc('infra_c9_m2_tenements'),
    new InfraSceneDesc('infra_c9_m3_river'),
    new InfraSceneDesc('infra_c9_m4_villa'),
    new InfraSceneDesc('infra_c9_m5_field'),

    "Redemption",
    new InfraSceneDesc('infra_c10_m1_npp'),
    new InfraSceneDesc('infra_c10_m2_reactor'),
    new InfraSceneDesc('infra_c10_m3_roof'),

    "Epilogue",
    new InfraSceneDesc('infra_c11_ending_1'),
    new InfraSceneDesc('infra_c11_ending_2'),
    new InfraSceneDesc('infra_c11_ending_3'),

    "Easter Eggs",
    new InfraSceneDesc('infra_ee_binary'),
    new InfraSceneDesc('infra_ee_city_gates'),
    new InfraSceneDesc('infra_ee_cubes'),
    new InfraSceneDesc('infra_ee_hallway'),
    new InfraSceneDesc('infra_ee_wasteland'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
