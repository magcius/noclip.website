
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { BSPFileVariant } from "./BSPFile";
import { LooseMount, SourceFileSystem, SourceLoadContext } from "./Main";
import { createScene } from "./Scenes";

class Left4Dead2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/left4dead2/pak01`),
            ]);
            return filesystem;
        });

        filesystem.loose.push(new LooseMount(`${pathBase}/left4dead2`, [
            `materials/correction/zombieintro.raw`,
            `materials/correction/cc_c1_main.raw`,
            `materials/correction/cc_c1_mall.raw`,
            `materials/correction/cc_c2_main.raw`,
            `materials/correction/cc_c2_tol.raw`,
            `materials/correction/cc_c3_main.raw`,
            `materials/correction/cc_c3_morning.raw`,
            `materials/correction/cc_c4_main.raw`,
            `materials/correction/cc_c4_return.raw`,
            `materials/correction/cc_c5_main.raw`,
            `materials/correction/cc_checkpoint.raw`,
            `materials/correction/cc_smoke.raw`,
            `materials/correction/checkpoint.raw`,
            `materials/correction/ghost.raw`,
            `materials/correction/infected.raw`,
            `materials/correction/off.raw`,
            `materials/correction/thirdstrike.raw`,
        ]));

        const loadContext = new SourceLoadContext(filesystem);
        loadContext.bspFileVariant = BSPFileVariant.Left4Dead2;
        return createScene(context, loadContext, this.id, `${pathBase}/left4dead2/maps/${this.id}.bsp`);
    }
}

const pathBase = `Left4Dead2`;

const id = 'Left4Dead2';
const name = 'Left 4 Dead 2';
const sceneDescs = [
    new Left4Dead2SceneDesc("tutorial_standards_vs"),
    new Left4Dead2SceneDesc("c1m1_hotel"),
    new Left4Dead2SceneDesc("c1m2_streets"),
    new Left4Dead2SceneDesc("c1m3_mall"),
    new Left4Dead2SceneDesc("c1m4_atrium"),
    new Left4Dead2SceneDesc("c2m1_highway"),
    new Left4Dead2SceneDesc("c2m2_fairgrounds"),
    new Left4Dead2SceneDesc("c2m3_coaster"),
    new Left4Dead2SceneDesc("c2m4_barns"),
    new Left4Dead2SceneDesc("c2m5_concert"),
    new Left4Dead2SceneDesc("c3m1_plankcountry"),
    new Left4Dead2SceneDesc("c3m2_swamp"),
    new Left4Dead2SceneDesc("c3m3_shantytown"),
    new Left4Dead2SceneDesc("c3m4_plantation"),
    new Left4Dead2SceneDesc("c4m1_milltown_a"),
    new Left4Dead2SceneDesc("c4m2_sugarmill_a"),
    new Left4Dead2SceneDesc("c4m3_sugarmill_b"),
    new Left4Dead2SceneDesc("c4m4_milltown_b"),
    new Left4Dead2SceneDesc("c4m5_milltown_escape"),
    new Left4Dead2SceneDesc("c5m1_waterfront"),
    new Left4Dead2SceneDesc("c5m1_waterfront_sndscape"),
    new Left4Dead2SceneDesc("c5m2_park"),
    new Left4Dead2SceneDesc("c5m3_cemetery"),
    new Left4Dead2SceneDesc("c5m4_quarter"),
    new Left4Dead2SceneDesc("c5m5_bridge"),
    new Left4Dead2SceneDesc("credits"),
    new Left4Dead2SceneDesc("curling_stadium"),
    new Left4Dead2SceneDesc("tutorial_standards"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
