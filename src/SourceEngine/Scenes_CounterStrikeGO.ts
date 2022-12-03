
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem, SourceLoadContext } from "./Main";
import { createScene } from "./Scenes";

class CounterStrikeGOSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`${pathBase}/pak01`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const pathBase = `CounterStrikeGO`;

const id = 'CounterStrikeGO';
const name = 'Counter-Strike: Global Offensive';
const sceneDescs = [
    new CounterStrikeGOSceneDesc('de_dust2'),
    new CounterStrikeGOSceneDesc('de_prime'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
