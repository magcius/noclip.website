
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem, SourceLoadContext } from "./Main";
import { createScene } from "./Scenes";

class HalfLife2DMSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/hl2mp_pak`),
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `HalfLife2DM`;

const id = 'HalfLife2DM';
const name = 'Half-Life 2: Deathmatch';
const sceneDescs = [
    new HalfLife2DMSceneDesc('dm_lockdown'),
    new HalfLife2DMSceneDesc('dm_overwatch'),
    new HalfLife2DMSceneDesc('dm_powerhouse'),
    new HalfLife2DMSceneDesc('dm_resistance'),
    new HalfLife2DMSceneDesc('dm_runoff'),
    new HalfLife2DMSceneDesc('dm_steamlab'),
    new HalfLife2DMSceneDesc('dm_underpass'),
    new HalfLife2DMSceneDesc('halls3'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
