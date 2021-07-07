
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

const hl2PathBase = `HalfLife2`;
const ep1PathBase = `HalfLife2Ep1`;
const ep2PathBase = `HalfLife2Ep2`;

class HalfLife2Ep2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${ep2PathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${ep2PathBase}/ep2_pak`),
                filesystem.createVPKMount(`${ep1PathBase}/ep1_pak`),
                filesystem.createVPKMount(`${hl2PathBase}/hl2_textures`),
                filesystem.createVPKMount(`${hl2PathBase}/hl2_misc`),
            ]);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${ep2PathBase}/maps/${this.id}.bsp`);
    }
}

const id = 'HalfLife2Ep2';
const name = 'Half-Life 2: Episode Two';
const sceneDescs = [
    new HalfLife2Ep2SceneDesc("ep2_background01"),
    new HalfLife2Ep2SceneDesc("ep2_background02"),
    new HalfLife2Ep2SceneDesc("ep2_background02a"),
    new HalfLife2Ep2SceneDesc("ep2_background03"),

    new HalfLife2Ep2SceneDesc("ep2_outland_01"),
    new HalfLife2Ep2SceneDesc("ep2_outland_01a"),
    new HalfLife2Ep2SceneDesc("ep2_outland_02"),
    new HalfLife2Ep2SceneDesc("ep2_outland_03"),
    new HalfLife2Ep2SceneDesc("ep2_outland_04"),
    new HalfLife2Ep2SceneDesc("ep2_outland_05"),
    new HalfLife2Ep2SceneDesc("ep2_outland_06"),
    new HalfLife2Ep2SceneDesc("ep2_outland_06a"),
    new HalfLife2Ep2SceneDesc("ep2_outland_07"),
    new HalfLife2Ep2SceneDesc("ep2_outland_08"),
    new HalfLife2Ep2SceneDesc("ep2_outland_09"),
    new HalfLife2Ep2SceneDesc("ep2_outland_10"),
    new HalfLife2Ep2SceneDesc("ep2_outland_10a"),
    new HalfLife2Ep2SceneDesc("ep2_outland_11"),
    new HalfLife2Ep2SceneDesc("ep2_outland_11a"),
    new HalfLife2Ep2SceneDesc("ep2_outland_11b"),
    new HalfLife2Ep2SceneDesc("ep2_outland_12"),
    new HalfLife2Ep2SceneDesc("ep2_outland_12a"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
