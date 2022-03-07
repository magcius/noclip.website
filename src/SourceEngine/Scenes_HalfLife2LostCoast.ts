
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

const pathBase = `HalfLife2LostCoast`;

class HalfLife2LostCoastSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/lostcoast_pak`),
                filesystem.createVPKMount(`HalfLife2/hl2_textures`),
                filesystem.createVPKMount(`HalfLife2/hl2_misc`),
            ]);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/maps/${this.id}.bsp`);
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
