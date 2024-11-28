
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SourceFileSystem, SourceLoadContext } from "./Main.js";
import { createScene } from "./Scenes.js";

const pathRoot = `HalfLife2_2024`;
const pathHL2 = `${pathRoot}/hl2`;
const pathEp1 = `${pathRoot}/episodic`;
const pathEp2 = `${pathRoot}/ep2`;

class HalfLife2Ep2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathEp2}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathEp2}/ep2_pak`),
                filesystem.createVPKMount(`${pathEp1}/ep1_pak`),
                filesystem.createVPKMount(`${pathHL2}/hl2_textures`),
                filesystem.createVPKMount(`${pathHL2}/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathEp2}/maps/${this.id}.bsp`);
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

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
