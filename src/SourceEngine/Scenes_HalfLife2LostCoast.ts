
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SourceFileSystem, SourceLoadContext } from "./Main.js";
import { createScene } from "./Scenes.js";

const pathRoot = `HalfLife2_2024`;
const pathHL2 = `${pathRoot}/hl2`;
const pathLostCoast = `${pathRoot}/lostcoast`;

class HalfLife2LostCoastSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathLostCoast}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathLostCoast}/lostcoast_pak`),
                filesystem.createVPKMount(`${pathHL2}/hl2_textures`),
                filesystem.createVPKMount(`${pathHL2}/hl2_misc`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathLostCoast}/maps/${this.id}.bsp`);
    }
}

const id = 'HalfLife2LostCoast';
const name = 'Half-Life 2: Lost Coast';
const sceneDescs = [
    new HalfLife2LostCoastSceneDesc('background01'),
    new HalfLife2LostCoastSceneDesc('d2_lostcoast'),

    new HalfLife2LostCoastSceneDesc('vst_lostcoast'),
    new HalfLife2LostCoastSceneDesc('test_hardware'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
