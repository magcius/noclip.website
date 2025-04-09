
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SourceFileSystem, SourceLoadContext } from "./Main.js";
import { createScene } from "./Scenes.js";

const pathRoot = `HalfLife2_2024`;
const pathHL2 = `${pathRoot}/hl2`;
const pathEp1 = `${pathRoot}/episodic`;

class HalfLife2Ep1SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathEp1}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathEp1}/ep1_pak`),
                filesystem.createVPKMount(`${pathHL2}/hl2_textures`),
                filesystem.createVPKMount(`${pathHL2}/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathEp1}/maps/${this.id}.bsp`);
    }
}

const id = 'HalfLife2Ep1';
const name = 'Half-Life 2: Episode One';
const sceneDescs = [
    new HalfLife2Ep1SceneDesc("ep1_background01"),
    new HalfLife2Ep1SceneDesc("ep1_background01a"),
    new HalfLife2Ep1SceneDesc("ep1_background02"),

    new HalfLife2Ep1SceneDesc("ep1_citadel_00"),
    new HalfLife2Ep1SceneDesc("ep1_citadel_00_demo"),
    new HalfLife2Ep1SceneDesc("ep1_citadel_01"),
    new HalfLife2Ep1SceneDesc("ep1_citadel_02"),
    new HalfLife2Ep1SceneDesc("ep1_citadel_02b"),
    new HalfLife2Ep1SceneDesc("ep1_citadel_03"),
    new HalfLife2Ep1SceneDesc("ep1_citadel_04"),
    new HalfLife2Ep1SceneDesc("ep1_c17_00"),
    new HalfLife2Ep1SceneDesc("ep1_c17_00a"),
    new HalfLife2Ep1SceneDesc("ep1_c17_01"),
    new HalfLife2Ep1SceneDesc("ep1_c17_01a"),
    new HalfLife2Ep1SceneDesc("ep1_c17_02"),
    new HalfLife2Ep1SceneDesc("ep1_c17_02a"),
    new HalfLife2Ep1SceneDesc("ep1_c17_02b"),
    new HalfLife2Ep1SceneDesc("ep1_c17_05"),
    new HalfLife2Ep1SceneDesc("ep1_c17_06"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
