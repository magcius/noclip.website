
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

const hl2PathBase = `HalfLife2`;
const ep1PathBase = `HalfLife2Ep1`;

class HalfLife2Ep1SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${ep1PathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${ep1PathBase}/ep1_pak`),
                filesystem.createVPKMount(`${hl2PathBase}/hl2_textures`),
                filesystem.createVPKMount(`${hl2PathBase}/hl2_misc`),
            ]);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${ep1PathBase}/maps/${this.id}.bsp`);
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

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
