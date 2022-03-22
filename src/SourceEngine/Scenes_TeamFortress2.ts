
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem, SourceLoadContext } from "./Main";
import { createScene } from "./Scenes";
import { createKitchenSinkSourceFilesytem } from "./Scenes_FileDrops";

const pathBase = `TeamFortress2`;

class TeamFortress2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            // According to gameinfo.txt, it first mounts TF2 and then HL2.
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/tf/tf2_textures`),
                filesystem.createVPKMount(`${pathBase}/tf/tf2_misc`),
                filesystem.createVPKMount(`${pathBase}/hl2/hl2_textures`),
                filesystem.createVPKMount(`${pathBase}/hl2/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/tf/maps/${this.id}.bsp`);
    }
}

class GarrysModSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const gmPathBase = `GarrysMod`;

        const filesystem = await context.dataShare.ensureObject(`${gmPathBase}/SourceFileSystem`, async () => {
            return createKitchenSinkSourceFilesytem(context.dataFetcher);
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${gmPathBase}/maps/${this.id}.bsp`);
    }
}

const id = 'TeamFortress2';
const name = 'Team Fortress 2';
const sceneDescs = [
    "Arena",
    new TeamFortress2SceneDesc('arena_badlands'),
    new TeamFortress2SceneDesc('arena_byre'),
    new TeamFortress2SceneDesc('arena_granary'),
    new TeamFortress2SceneDesc('arena_lumberyard'),
    new TeamFortress2SceneDesc('arena_nucleus'),
    new TeamFortress2SceneDesc('arena_offblast_final'),
    new TeamFortress2SceneDesc('arena_ravine'),
    new TeamFortress2SceneDesc('arena_sawmill'),
    new TeamFortress2SceneDesc('arena_watchtower'),
    new TeamFortress2SceneDesc('arena_well'),
    "Control Point (Symmetric)",
    new TeamFortress2SceneDesc('cp_5gorge'),
    new TeamFortress2SceneDesc('cp_badlands'),
    new TeamFortress2SceneDesc('cp_coldfront'),
    new TeamFortress2SceneDesc('cp_fastlane'),
    new TeamFortress2SceneDesc('cp_cloak'),
    new TeamFortress2SceneDesc('cp_foundry'),
    new TeamFortress2SceneDesc('cp_freight_final1'),
    new TeamFortress2SceneDesc('cp_granary'),
    new TeamFortress2SceneDesc('cp_gullywash_final1'),
    new TeamFortress2SceneDesc('cp_metalworks'),
    new TeamFortress2SceneDesc('cp_powerhouse'),
    new TeamFortress2SceneDesc('cp_process_final'),
    new TeamFortress2SceneDesc('cp_snakewater_final1'),
    new TeamFortress2SceneDesc('cp_snowplow'),
    new TeamFortress2SceneDesc('cp_standin_final'),
    new TeamFortress2SceneDesc('cp_sunshine'),
    new TeamFortress2SceneDesc('cp_sunshine_event'),
    new TeamFortress2SceneDesc('cp_vanguard'),
    new TeamFortress2SceneDesc('cp_well'),
    new TeamFortress2SceneDesc('cp_yukon_final'),
    "Control Point (Attack / Defense)",
    new TeamFortress2SceneDesc('cp_degrootkeep'),
    new TeamFortress2SceneDesc('cp_dustbowl'),
    new TeamFortress2SceneDesc('cp_egypt_final'),
    new TeamFortress2SceneDesc('cp_gorge'),
    new TeamFortress2SceneDesc('cp_gorge_event'),
    new TeamFortress2SceneDesc('cp_gravelpit'),
    new TeamFortress2SceneDesc('cp_junction_final'),
    new TeamFortress2SceneDesc('cp_manor_event'),
    new TeamFortress2SceneDesc('cp_mercenarypark'),
    new TeamFortress2SceneDesc('cp_mossrock'),
    new TeamFortress2SceneDesc('cp_mountainlab'),
    new TeamFortress2SceneDesc('cp_steel'),
    "Capture the Flag",
    new TeamFortress2SceneDesc('ctf_2fort'),
    new TeamFortress2SceneDesc('ctf_2fort_invasion'),
    new TeamFortress2SceneDesc('ctf_doublecross'),
    new TeamFortress2SceneDesc('ctf_landfall'),
    new TeamFortress2SceneDesc('ctf_sawmill'),
    new TeamFortress2SceneDesc('ctf_snowfall_final'),
    new TeamFortress2SceneDesc('ctf_turbine'),
    new TeamFortress2SceneDesc('ctf_well'),
    "King of the Hill",
    new TeamFortress2SceneDesc('koth_badlands'),
    new TeamFortress2SceneDesc('koth_bagel_event'),
    new TeamFortress2SceneDesc('koth_brazil'),
    new TeamFortress2SceneDesc('koth_harvest_event'),
    new TeamFortress2SceneDesc('koth_harvest_final'),
    new TeamFortress2SceneDesc('koth_highpass'),
    new TeamFortress2SceneDesc('koth_king'),
    new TeamFortress2SceneDesc('koth_lakeside_event'),
    new TeamFortress2SceneDesc('koth_lakeside_final'),
    new TeamFortress2SceneDesc('koth_lazarus'),
    new TeamFortress2SceneDesc('koth_maple_ridge_event'),
    new TeamFortress2SceneDesc('koth_megalo'),
    new TeamFortress2SceneDesc('koth_moonshine_event'),
    new TeamFortress2SceneDesc('koth_nucleus'),
    new TeamFortress2SceneDesc('koth_probed'),
    new TeamFortress2SceneDesc('koth_sawmill'),
    new TeamFortress2SceneDesc('koth_slasher'),
    new TeamFortress2SceneDesc('koth_slaughter_event'),
    new TeamFortress2SceneDesc('koth_suijin'),
    new TeamFortress2SceneDesc('koth_undergrove_event'),
    new TeamFortress2SceneDesc('koth_viaduct'),
    new TeamFortress2SceneDesc('koth_viaduct_event'),
    "Mann Vs. Machine",
    new TeamFortress2SceneDesc('mvm_bigrock'),
    new TeamFortress2SceneDesc('mvm_coaltown'),
    new TeamFortress2SceneDesc('mvm_decoy'),
    new TeamFortress2SceneDesc('mvm_ghost_town'),
    new TeamFortress2SceneDesc('mvm_mannhattan'),
    new TeamFortress2SceneDesc('mvm_mannworks'),
    new TeamFortress2SceneDesc('mvm_rottenburg'),
    "Mannpower",
    new TeamFortress2SceneDesc('ctf_foundry'),
    new TeamFortress2SceneDesc('ctf_gorge'),
    new TeamFortress2SceneDesc('ctf_hellfire'),
    new TeamFortress2SceneDesc('ctf_thundermountain'),
    "PASS Time",
    new TeamFortress2SceneDesc('pass_brickyard'),
    new TeamFortress2SceneDesc('pass_district'),
    new TeamFortress2SceneDesc('pass_timbertown'),
    "Payload",
    new TeamFortress2SceneDesc('pl_badwater'),
    new TeamFortress2SceneDesc('pl_barnblitz'),
    new TeamFortress2SceneDesc('pl_bloodwater'),
    new TeamFortress2SceneDesc('pl_borneo'),
    new TeamFortress2SceneDesc('pl_cactuscanyon'),
    new TeamFortress2SceneDesc('pl_enclosure_final'),
    new TeamFortress2SceneDesc('pl_fifthcurve_event'),
    new TeamFortress2SceneDesc('pl_frontier_final'),
    new TeamFortress2SceneDesc('pl_goldrush'),
    new TeamFortress2SceneDesc('pl_hasslecastle'),
    new TeamFortress2SceneDesc('pl_hoodoo_final'),
    new TeamFortress2SceneDesc('pl_millstone_event'),
    new TeamFortress2SceneDesc('pl_pier'),
    new TeamFortress2SceneDesc('pl_precipice_event_final'),
    new TeamFortress2SceneDesc('pl_rumble_event'),
    new TeamFortress2SceneDesc('pl_snowycoast'),
    new TeamFortress2SceneDesc('pl_swiftwater_final1'),
    new TeamFortress2SceneDesc('pl_thundermountain'),
    new TeamFortress2SceneDesc('pl_upward'),
    new TeamFortress2SceneDesc('pl_wutville_event'),
    "Payload Race",
    new TeamFortress2SceneDesc('plr_bananabay'),
    new TeamFortress2SceneDesc('plr_hightower'),
    new TeamFortress2SceneDesc('plr_hightower_event'),
    new TeamFortress2SceneDesc('plr_nightfall_final'),
    new TeamFortress2SceneDesc('plr_pipeline'),
    "Player Destruction",
    new TeamFortress2SceneDesc('pd_cursed_cove_event'),
    new TeamFortress2SceneDesc('pd_monster_bash'),
    new TeamFortress2SceneDesc('pd_pit_of_death_event'),
    new TeamFortress2SceneDesc('pd_snowville_event'),
    new TeamFortress2SceneDesc('pd_watergate'),
    "Other Gamemodes",
    new TeamFortress2SceneDesc('rd_asteroid'),
    new TeamFortress2SceneDesc('sd_doomsday'),
    new TeamFortress2SceneDesc('sd_doomsday_event'),
    new TeamFortress2SceneDesc('tc_hydro'),
    new TeamFortress2SceneDesc('tr_dustbowl'),
    new TeamFortress2SceneDesc('tr_target'),
    "Miscellaneous",
    new TeamFortress2SceneDesc('background01'),
    new TeamFortress2SceneDesc('itemtest'),
    "Garry's Mod",
    new GarrysModSceneDesc('gm_construct'),
    new GarrysModSceneDesc('gm_fork'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
