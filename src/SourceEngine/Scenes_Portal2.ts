
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { BaseEntity, EntityFactoryRegistry, EntitySystem } from "./EntitySystem";
import { BSPRenderer, SourceFileSystem, SourceRenderContext } from "./Main";
import { createScene } from "./Scenes";
import { BSPEntity } from "./VMT";

class prop_button extends BaseEntity {
    public static classname = 'prop_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.setModelName(renderContext, 'models/props/switch001.mdl');
    }
}

class prop_under_button extends prop_button {
    public static classname = 'prop_under_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.setModelName(renderContext, 'models/props_underground/underground_testchamber_button.mdl');
    }
}

class prop_under_floor_button extends prop_button {
    public static classname = 'prop_under_floor_button';

    constructor(entitySystem: EntitySystem, renderContext: SourceRenderContext, bspRenderer: BSPRenderer, entity: BSPEntity) {
        super(entitySystem, renderContext, bspRenderer, entity);
        this.setModelName(renderContext, 'models/props_underground/underground_floor_button.mdl');
    }
}

class Portal2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    private registerEntityFactories(registry: EntityFactoryRegistry): void {
        registry.registerFactory(prop_button);
        registry.registerFactory(prop_under_button);
        registry.registerFactory(prop_under_floor_button);
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createZipMount(`${pathBase}/platform.zip`),
                filesystem.createVPKMount(`${pathBase}/portal2/pak01`),
            ]);
            return filesystem;
        });

        const renderContext = new SourceRenderContext(context.device, filesystem);
        this.registerEntityFactories(renderContext.entityFactoryRegistry);
        return createScene(context, filesystem, this.id, `${pathBase}/portal2/maps/${this.id}.bsp`, renderContext);
    }
}

const pathBase = `Portal2`;

const id = 'Portal2';
const name = 'Portal 2';
const sceneDescs = [
    "Single Player",
    new Portal2SceneDesc("sp_a1_intro1"),
    new Portal2SceneDesc("sp_a1_intro2"),
    new Portal2SceneDesc("sp_a1_intro3"),
    new Portal2SceneDesc("sp_a1_intro4"),
    new Portal2SceneDesc("sp_a1_intro5"),
    new Portal2SceneDesc("sp_a1_intro6"),
    new Portal2SceneDesc("sp_a1_intro7"),
    new Portal2SceneDesc("sp_a1_wakeup"),
    new Portal2SceneDesc("sp_a2_bridge_intro"),
    new Portal2SceneDesc("sp_a2_bridge_the_gap"),
    new Portal2SceneDesc("sp_a2_bts1"),
    new Portal2SceneDesc("sp_a2_bts2"),
    new Portal2SceneDesc("sp_a2_bts3"),
    new Portal2SceneDesc("sp_a2_bts4"),
    new Portal2SceneDesc("sp_a2_bts5"),
    new Portal2SceneDesc("sp_a2_bts6"),
    new Portal2SceneDesc("sp_a2_catapult_intro"),
    new Portal2SceneDesc("sp_a2_column_blocker"),
    new Portal2SceneDesc("sp_a2_core"),
    new Portal2SceneDesc("sp_a2_dual_lasers"),
    new Portal2SceneDesc("sp_a2_fizzler_intro"),
    new Portal2SceneDesc("sp_a2_intro"),
    new Portal2SceneDesc("sp_a2_laser_chaining"),
    new Portal2SceneDesc("sp_a2_laser_intro"),
    new Portal2SceneDesc("sp_a2_laser_over_goo"),
    new Portal2SceneDesc("sp_a2_laser_relays"),
    new Portal2SceneDesc("sp_a2_laser_stairs"),
    new Portal2SceneDesc("sp_a2_laser_vs_turret"),
    new Portal2SceneDesc("sp_a2_pit_flings"),
    new Portal2SceneDesc("sp_a2_pull_the_rug"),
    new Portal2SceneDesc("sp_a2_ricochet"),
    new Portal2SceneDesc("sp_a2_sphere_peek"),
    new Portal2SceneDesc("sp_a2_triple_laser"),
    new Portal2SceneDesc("sp_a2_trust_fling"),
    new Portal2SceneDesc("sp_a2_turret_blocker"),
    new Portal2SceneDesc("sp_a2_turret_intro"),
    new Portal2SceneDesc("sp_a3_00"),
    new Portal2SceneDesc("sp_a3_01"),
    new Portal2SceneDesc("sp_a3_03"),
    new Portal2SceneDesc("sp_a3_bomb_flings"),
    new Portal2SceneDesc("sp_a3_crazy_box"),
    new Portal2SceneDesc("sp_a3_end"),
    new Portal2SceneDesc("sp_a3_jump_intro"),
    new Portal2SceneDesc("sp_a3_portal_intro"),
    new Portal2SceneDesc("sp_a3_speed_flings"),
    new Portal2SceneDesc("sp_a3_speed_ramp"),
    new Portal2SceneDesc("sp_a3_transition01"),
    new Portal2SceneDesc("sp_a4_finale1"),
    new Portal2SceneDesc("sp_a4_finale2"),
    new Portal2SceneDesc("sp_a4_finale3"),
    new Portal2SceneDesc("sp_a4_finale4"),
    new Portal2SceneDesc("sp_a4_intro"),
    new Portal2SceneDesc("sp_a4_jump_polarity"),
    new Portal2SceneDesc("sp_a4_laser_catapult"),
    new Portal2SceneDesc("sp_a4_laser_platform"),
    new Portal2SceneDesc("sp_a4_speed_tb_catch"),
    new Portal2SceneDesc("sp_a4_stop_the_box"),
    new Portal2SceneDesc("sp_a4_tb_catch"),
    new Portal2SceneDesc("sp_a4_tb_intro"),
    new Portal2SceneDesc("sp_a4_tb_polarity"),
    new Portal2SceneDesc("sp_a4_tb_trust_drop"),
    new Portal2SceneDesc("sp_a4_tb_wall_button"),
    new Portal2SceneDesc("sp_a5_credits"),
    "Multi-Player",
    new Portal2SceneDesc("mp_coop_catapult_1"),
    new Portal2SceneDesc("mp_coop_catapult_2"),
    new Portal2SceneDesc("mp_coop_catapult_wall_intro"),
    new Portal2SceneDesc("mp_coop_come_along"),
    new Portal2SceneDesc("mp_coop_credits"),
    new Portal2SceneDesc("mp_coop_doors"),
    new Portal2SceneDesc("mp_coop_fan"),
    new Portal2SceneDesc("mp_coop_fling_1"),
    new Portal2SceneDesc("mp_coop_fling_3"),
    new Portal2SceneDesc("mp_coop_fling_crushers"),
    new Portal2SceneDesc("mp_coop_infinifling_train"),
    new Portal2SceneDesc("mp_coop_laser_2"),
    new Portal2SceneDesc("mp_coop_laser_crusher"),
    new Portal2SceneDesc("mp_coop_lobby_2"),
    new Portal2SceneDesc("mp_coop_multifling_1"),
    new Portal2SceneDesc("mp_coop_paint_bridge"),
    new Portal2SceneDesc("mp_coop_paint_come_along"),
    new Portal2SceneDesc("mp_coop_paint_longjump_intro"),
    new Portal2SceneDesc("mp_coop_paint_red_racer"),
    new Portal2SceneDesc("mp_coop_paint_redirect"),
    new Portal2SceneDesc("mp_coop_paint_speed_catch"),
    new Portal2SceneDesc("mp_coop_paint_speed_fling"),
    new Portal2SceneDesc("mp_coop_paint_walljumps"),
    new Portal2SceneDesc("mp_coop_race_2"),
    new Portal2SceneDesc("mp_coop_rat_maze"),
    new Portal2SceneDesc("mp_coop_start"),
    new Portal2SceneDesc("mp_coop_tbeam_catch_grind_1"),
    new Portal2SceneDesc("mp_coop_tbeam_drill"),
    new Portal2SceneDesc("mp_coop_tbeam_end"),
    new Portal2SceneDesc("mp_coop_tbeam_laser_1"),
    new Portal2SceneDesc("mp_coop_tbeam_maze"),
    new Portal2SceneDesc("mp_coop_tbeam_polarity"),
    new Portal2SceneDesc("mp_coop_tbeam_polarity2"),
    new Portal2SceneDesc("mp_coop_tbeam_polarity3"),
    new Portal2SceneDesc("mp_coop_tbeam_redirect"),
    new Portal2SceneDesc("mp_coop_teambts"),
    new Portal2SceneDesc("mp_coop_turret_ball"),
    new Portal2SceneDesc("mp_coop_turret_walls"),
    new Portal2SceneDesc("mp_coop_wall_2"),
    new Portal2SceneDesc("mp_coop_wall_5"),
    new Portal2SceneDesc("mp_coop_wall_block"),
    new Portal2SceneDesc("mp_coop_wall_intro"),
    "Super 8 Interactive Teaser",
    new Portal2SceneDesc("e1912"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
